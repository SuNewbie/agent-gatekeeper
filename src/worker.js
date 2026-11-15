// Cloudflare Worker: Agent Games endpoint (preflight + Proof Gatekeeper).
// Register the FULL path on the dashboard, e.g. https://<sub>.workers.dev/agent
//
// - HMAC-SHA256 over the RAW request body, checked BEFORE parsing JSON.
// - task_id is an idempotency key: retries get byte-identical answers (D1).
// - proof_tx replay set is split by scope (practice / competition) and atomic
//   in D1, so two concurrent tasks with the same reference can't both "win".
// - Groth16 proving runs on the remote prover (WSL) via quick tunnel; the
//   Worker only waits (fetch costs no CPU). A missing/slow prover costs the
//   proof (-2), never the answer.
// - Fail closed: any error path returns a schema-valid REJECT.

import { decide } from "./decide.js";
import { requestProof, handleRegister } from "./proverClient.js";

const DEADLINE_GRACE_MS = 2 * 60_000; // refuse envelopes already past deadline+2min
const MAX_AGE_MS = 15 * 60_000;       // refuse envelopes older than 15 min (preflight has no deadline)
const enc = new TextEncoder();

const keyCache = new Map();
// The platform shows the secret as text; it is undocumented whether HMAC is keyed with the
// text bytes or the decoded hex bytes. Accept both, and sign with whichever form verified
// the last accepted request.
let keyForm = "text";

function keyBytes(secret, form) {
  const s = secret.trim();
  if (form === "hex" && /^(0x)?[0-9a-fA-F]+$/.test(s) && s.replace(/^0x/, "").length % 2 === 0) {
    const h = s.replace(/^0x/, "");
    return Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
  }
  return form === "hex" ? null : enc.encode(s);
}

async function hmacKey(secret, form) {
  const id = `${form}:${secret}`;
  if (keyCache.has(id)) return keyCache.get(id);
  const raw = keyBytes(secret, form);
  const key = raw
    ? await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    : null;
  keyCache.set(id, key);
  return key;
}

async function sign(secret, bytes, form = keyForm) {
  const key = await hmacKey(secret, form);
  if (!key) return "";
  const mac = await crypto.subtle.sign("HMAC", key, bytes);
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Response header must be a signature over the RAW response body.
async function send(env, status, obj) {
  const body = enc.encode(JSON.stringify(obj));
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store, no-transform",
      "x-agent-games-signature": await sign(env.AGENT_GAMES_HMAC_SECRET, body),
    },
  });
}

// Time left before the stated deadline, minus headroom for the reply to travel back.
function budget(deadline, headroomMs, capMs) {
  const d = Date.parse(deadline ?? "");
  return Number.isFinite(d) ? Math.max(0, Math.min(d - Date.now() - headroomMs, capMs)) : 0;
}

function staleness(task, now = Date.now()) {
  const deadline = Date.parse(task?.deadline_at ?? task?.deadlineAt ?? "");
  if (Number.isFinite(deadline) && now > deadline + DEADLINE_GRACE_MS) {
    return { past_deadline_ms: now - deadline };
  }
  const issued = Date.parse(task?.issued_at ?? task?.issuedAt ?? "");
  if (Number.isFinite(issued) && now > issued + MAX_AGE_MS) return { age_ms: now - issued };
  return null;
}

async function handleGatekeeper(env, task) {
  const db = env.DB;
  const taskId = String(task.task_id ?? "");

  if (taskId) {
    const cached = await db
      .prepare("SELECT response FROM answers WHERE task_id = ?")
      .bind(taskId)
      .first("response");
    if (cached) return JSON.parse(cached); // platform retry: identical answer
  }

  const input = task.input ?? {};
  const proofTx = typeof input.proof_tx === "string" ? input.proof_tx.trim().toLowerCase() : "";
  const scope = task.mode === "competition" ? "competition" : "practice";

  // Claim the reference atomically, then find out who owns it.
  let owner = taskId;
  if (proofTx) {
    await db
      .prepare("INSERT OR IGNORE INTO proof_refs (scope, proof_tx, task_id, seen_at) VALUES (?, ?, ?, ?)")
      .bind(scope, proofTx, taskId, new Date().toISOString())
      .run();
    owner = await db
      .prepare("SELECT task_id FROM proof_refs WHERE scope = ? AND proof_tx = ?")
      .bind(scope, proofTx)
      .first("task_id");
  }

  let verdict = decide(input, () => owner !== taskId);

  // Replays carry no proof to submit; PROOF_INVALID tasks are not provable either.
  let zk = null;
  if (verdict.reason_code !== "PROOF_REUSED" && verdict.reason_code !== "PROOF_INVALID") {
    zk = await requestProof(
      env,
      "gatekeeper",
      { input, taskId, decision: verdict.decision },
      budget(task.deadline_at, 5_000, 45_000),
      { allowAlternate: true },
    );
    if (zk?.alternate) {
      // The circuit only proves the decision its own rules allow — it is the referee.
      // If our decision cannot be proven, the circuit says so; trust it and flip.
      const flipped = verdict.decision === "APPROVE" ? "REJECT" : "APPROVE";
      console.warn(JSON.stringify({ task_id: taskId, circuit_overrode: verdict, to: flipped }));
      verdict = { decision: flipped, reason_code: flipped === "APPROVE" ? "VALID_CONDITION" : "PROOF_INVALID" };
    }
  }

  const response = { decision: verdict.decision, reason_code: verdict.reason_code };
  if (input.proof_tx) response.proof_tx = input.proof_tx;
  if (zk) {
    response.proof = zk.proof;
    response.public_signals = zk.public_signals;
  }

  if (taskId) {
    await db
      .prepare("INSERT OR IGNORE INTO answers (task_id, mode, response, answered_at) VALUES (?, ?, ?, ?)")
      .bind(taskId, scope, JSON.stringify(response), new Date().toISOString())
      .run();
  }
  console.log(JSON.stringify({ task_id: taskId, mode: task.mode, ...verdict, proved: Boolean(zk) }));
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const agentPath = env.AGENT_PATH ?? "/agent";

    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      return Response.json({ ok: true, ts: new Date().toISOString() });
    }
    // The prover box registers its fresh quick-tunnel URL here (signed with PROVER_TOKEN).
    if (request.method === "POST" && url.pathname === "/prover/register") {
      return handleRegister(request, env);
    }
    // Signed preflight is a POST; an unsigned GET on the agent path answers 200 so a plain
    // reachability probe never reads as "down".
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === agentPath) {
      return Response.json({ ok: true, protocolVersion: "v1" });
    }
    if (request.method !== "POST" || url.pathname !== agentPath) {
      return new Response(null, { status: 404 });
    }

    const secret = env.AGENT_GAMES_HMAC_SECRET;
    if (!secret) return new Response("secret not configured", { status: 500 });

    const raw = new Uint8Array(await request.arrayBuffer());
    const given = (request.headers.get("x-agent-games-signature") ?? "")
      .trim()
      .replace(/^sha256=/i, "")
      .toLowerCase();
    let matched = null;
    for (const form of ["text", "hex"]) {
      if (safeEqual(given, await sign(secret, raw, form))) {
        matched = form;
        break;
      }
    }
    if (!matched) {
      console.warn(`bad signature (secret length ${secret.trim().length}, given length ${given.length})`);
      return send(env, 401, { error: "invalid signature" });
    }
    keyForm = matched;

    let task;
    try {
      task = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return send(env, 400, { error: "invalid json" });
    }

    const stale = staleness(task);
    if (stale) {
      console.warn(JSON.stringify({ refused: "stale request", type: task.type ?? task.eventId, ...stale }));
      return send(env, 410, { error: "request expired" });
    }

    try {
      if (task.type === "agent-games.preflight.v1") {
        return send(env, 200, { ok: true, protocolVersion: "v1" });
      }
      if (task.type === "agent-games.proof-gatekeeper.v1") {
        return send(env, 200, await handleGatekeeper(env, task));
      }
      console.warn("unknown task type", task.type, JSON.stringify(Object.keys(task ?? {})));
      return send(env, 400, { error: "unsupported task type" });
    } catch (err) {
      console.error("handler error:", err?.message);
      // Fail closed: a REJECT costs at most -3; an error earns nothing.
      return send(env, 200, { decision: "REJECT", reason_code: "PROOF_INVALID", proof_tx: task?.input?.proof_tx });
    }
  },
};
