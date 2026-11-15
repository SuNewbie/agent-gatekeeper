// End-to-end tests of the Worker handler (Node 26, web APIs + node:crypto).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import worker from "../src/worker.js";
import { makeDB } from "./d1mock.js";
import { decide } from "../src/decide.js";

const SECRET = "0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";
const enc = new TextEncoder();

function signWith(secret, bytes, form = "text") {
  const key =
    form === "hex"
      ? Buffer.from(secret.replace(/^0x/, ""), "hex")
      : enc.encode(secret);
  return createHmac("sha256", key).update(bytes).digest("hex");
}

function envFor() {
  return {
    DB: makeDB(),
    AGENT_GAMES_HMAC_SECRET: SECRET,
    AGENT_PATH: "/agent",
    PROVER_TOKEN: "prover-token-123",
  };
}

async function post(env, bodyObj, { secret = SECRET, form = "text", path = "/agent" } = {}) {
  const raw = enc.encode(JSON.stringify(bodyObj));
  const r = await worker.fetch(
    new Request(`https://agent.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-games-signature": signWith(secret, raw, form) },
      body: raw,
    }),
    env,
  );
  const text = await r.text();
  return { status: r.status, body: JSON.parse(text), sig: r.headers.get("x-agent-games-signature") };
}

function validTask(over = {}) {
  const vk = "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
  const now = Date.now();
  return {
    type: "agent-games.proof-gatekeeper.v1",
    task_id: `gk_${randomBytes(3).toString("hex")}`,
    mode: "practice",
    issued_at: new Date(now).toISOString(),
    deadline_at: new Date(now + 60_000).toISOString(),
    input: {
      registered_vk: vk,
      proof_vk: vk,
      minimum: "1000",
      public_balance: "1460",
      expiry_block: "8430000",
      current_block: "8420000",
      recipient: "0xDe42000000000000000000000000000000009f01",
      condition_recipient: "0xDe42000000000000000000000000000000009f01",
      amount: "500",
      max_transfer: "1000",
      proof_tx: `0x${randomBytes(32).toString("hex")}`,
      ...over,
    },
  };
}

const expectResponseSig = (res, form = "text") => {
  const raw = enc.encode(JSON.stringify(res.body));
  assert.equal(res.sig, signWith(SECRET, raw, form), "response must be signed over its raw body");
};

test("preflight: signed preflight gets ok + protocolVersion, signed reply", async () => {
  const env = envFor();
  const res = await post(env, {
    type: "agent-games.preflight.v1",
    agent_id: "agt_test",
    issued_at: new Date().toISOString(),
    nonce: "abc123",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, protocolVersion: "v1" });
  expectResponseSig(res);
});

test("unsigned / bad-signature request is refused (401)", async () => {
  const env = envFor();
  const raw = enc.encode(JSON.stringify({ type: "agent-games.preflight.v1" }));
  const r = await worker.fetch(
    new Request("https://agent.test/agent", { method: "POST", headers: { "x-agent-games-signature": "deadbeef" }, body: raw }),
    env,
  );
  assert.equal(r.status, 401);
});

test("hex-decoded secret form is also accepted", async () => {
  const env = envFor();
  // signature computed over the DECODED bytes of the hex secret
  const res = await post(env, {
    type: "agent-games.preflight.v1",
    agent_id: "agt_test",
    issued_at: new Date().toISOString(),
    nonce: "n2",
  }, { form: "hex" });
  assert.equal(res.status, 200);
  expectResponseSig(res, "hex"); // replies now signed in the same (hex) form
});

test("valid condition -> APPROVE + VALID_CONDITION, proof_tx echoed, idempotent", async () => {
  const env = envFor();
  const task = validTask();
  const first = await post(env, task);
  assert.equal(first.status, 200);
  assert.equal(first.body.decision, "APPROVE");
  assert.equal(first.body.reason_code, "VALID_CONDITION");
  assert.equal(first.body.proof_tx, task.input.proof_tx);
  expectResponseSig(first);
  // platform retry of the same task: byte-identical answer
  const second = await post(env, task);
  assert.equal(second.status, 200);
  assert.equal(JSON.stringify(second.body), JSON.stringify(first.body));
});

test("each trap variety is rejected with the right reason code", async () => {
  const cases = [
    [{ proof_vk: "0x000000000000000000000000000000000000000000000000000000000000dead" }, "VK_SUBSTITUTION"],
    [{ public_balance: "900" }, "THRESHOLD_MISMATCH"],
    [{ current_block: "8430000" }, "EXPIRED_CONDITION"],
    [{ current_block: "9000000" }, "EXPIRED_CONDITION"],
    [{ recipient: "0xAbCd000000000000000000000000000000009f02" }, "RECIPIENT_MISMATCH"],
    [{ amount: "1500" }, "AMOUNT_OVERFLOW"],
    [{ amount: "0" }, "AMOUNT_OVERFLOW"],
  ];
  for (const [over, want] of cases) {
    const env = envFor();
    const res = await post(env, validTask(over));
    assert.equal(res.status, 200, want);
    assert.equal(res.body.decision, "REJECT", want);
    assert.equal(res.body.reason_code, want);
    expectResponseSig(res);
  }
});

test("missing fields fail closed to REJECT (PROOF_INVALID)", async () => {
  for (const missing of ["amount", "minimum", "proof_tx", "expiry_block", "current_block", "public_balance"]) {
    const env = envFor();
    const task = validTask();
    delete task.input[missing];
    const res = await post(env, task);
    assert.equal(res.body.decision, "REJECT", missing);
    assert.equal(res.body.reason_code, "PROOF_INVALID", missing);
  }
});

test("proof_tx replay in the same scope -> PROOF_REUSED", async () => {
  const env = envFor();
  const tx = `0x${randomBytes(32).toString("hex")}`;
  const first = await post(env, validTask({ proof_tx: tx }));
  assert.equal(first.body.decision, "APPROVE");
  const second = await post(env, validTask({ proof_tx: tx })); // different task_id
  assert.equal(second.body.decision, "REJECT");
  assert.equal(second.body.reason_code, "PROOF_REUSED");
});

test("replay sets are scoped: practice does not poison competition", async () => {
  const env = envFor();
  const tx = `0x${randomBytes(32).toString("hex")}`;
  const p = await post(env, validTask({ proof_tx: tx })); // mode defaults to practice
  assert.equal(p.body.decision, "APPROVE");
  const c = await post(env, { ...validTask({ proof_tx: tx }), mode: "competition" });
  assert.equal(c.body.decision, "APPROVE");
});

test("stale envelope (past deadline) is refused 410", async () => {
  const env = envFor();
  const task = validTask();
  task.issued_at = new Date(Date.now() - 60 * 60_000).toISOString();
  task.deadline_at = new Date(Date.now() - 30 * 60_000).toISOString();
  const res = await post(env, task);
  assert.equal(res.status, 410);
});

test("unsigned GET probes: /health and /agent answer 200, other paths 404", async () => {
  const env = envFor();
  for (const p of ["/health", "/agent"]) {
    const r = await worker.fetch(new Request(`https://agent.test${p}`), env);
    assert.equal(r.status, 200, p);
  }
  const r404 = await worker.fetch(new Request("https://agent.test/nope", { method: "POST", body: "{}" }), env);
  assert.equal(r404.status, 404);
});

test("decide(): unit sanity on the full decision matrix", () => {
  const base = {
    registered_vk: "0x11", proof_vk: "0x11", minimum: "10", public_balance: "20",
    expiry_block: "100", current_block: "90",
    recipient: "0xaa", condition_recipient: "0xaa", amount: "5", max_transfer: "10",
    proof_tx: "0xdead",
  };
  const d = (input, replay = false) => decide(input, () => replay);
  assert.equal(d({ ...base }).decision, "APPROVE");
  assert.equal(d({ ...base, proof_vk: "0x22" }).reason_code, "VK_SUBSTITUTION");
  assert.equal(d({ ...base }, true).reason_code, "PROOF_REUSED");
  assert.equal(d({ ...base, public_balance: "9" }).reason_code, "THRESHOLD_MISMATCH");
  assert.equal(d({ ...base, current_block: "100" }).reason_code, "EXPIRED_CONDITION");
  assert.equal(d({ ...base, recipient: "0xbb" }).reason_code, "RECIPIENT_MISMATCH");
  assert.equal(d({ ...base, amount: "11" }).reason_code, "AMOUNT_OVERFLOW");
});
