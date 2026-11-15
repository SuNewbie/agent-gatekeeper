// Deterministic Proof Gatekeeper policy — written against the rules published at
// https://agentgames.zkverify.io/build and /events/proof-gatekeeper.
//
// Scoring: wrong APPROVE = -6, wrong REJECT = -3, so every check fails closed:
// anything missing, unparseable, or ambiguous is a REJECT.
//
// Documented trap varieties: VALID_CONDITION (~50%), VK_SUBSTITUTION (~13%),
// THRESHOLD_MISMATCH (~8%), PROOF_REUSED (~11%), EXPIRED_CONDITION (~6%),
// RECIPIENT_MISMATCH (~6%), AMOUNT_OVERFLOW (~6%).

const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

function big(v) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(v.trim())) return BigInt(v.trim());
  return null;
}

/**
 * @param {object} input task.input from the platform
 * @param {(proofTx: string) => boolean} isReplay true when proof_tx was already
 *        accepted by a DIFFERENT task in the same scope
 * @returns {{decision: "APPROVE"|"REJECT", reason_code: string}}
 */
export function decide(input, isReplay) {
  const reject = (reason_code) => ({ decision: "REJECT", reason_code });
  if (!input || typeof input !== "object" || Array.isArray(input)) return reject("PROOF_INVALID");

  const registeredVk = norm(input.registered_vk);
  const proofVk = norm(input.proof_vk);
  const proofTx = norm(input.proof_tx);

  // 1. VK substitution — proof's verification key must match the registered condition VK.
  if (!registeredVk || !proofVk) return reject("VK_SUBSTITUTION");
  if (registeredVk !== proofVk) return reject("VK_SUBSTITUTION");

  // 2. No on-chain verification reference at all — nothing to check against.
  if (!proofTx) return reject("PROOF_INVALID");

  // 3. Replay — a reference already accepted for another task does not gain re-entry.
  if (isReplay(proofTx)) return reject("PROOF_REUSED");

  // 4. Threshold — the balance proven on-chain must meet the condition's minimum.
  const minimum = big(input.minimum);
  const publicBalance = big(input.public_balance);
  if (minimum === null || publicBalance === null) return reject("PROOF_INVALID");
  if (publicBalance < minimum) return reject("THRESHOLD_MISMATCH");

  // 5. Expiry — an on-chain confirmation after the expiry block does not revive the window.
  const expiryBlock = big(input.expiry_block);
  const currentBlock = big(input.current_block);
  if (expiryBlock === null || currentBlock === null) return reject("PROOF_INVALID");
  if (currentBlock >= expiryBlock) return reject("EXPIRED_CONDITION");

  // 6. Recipient — the address committed in the proof must match the condition's payee.
  const recipient = norm(input.recipient);
  const conditionRecipient = norm(input.condition_recipient);
  if (!recipient || recipient !== conditionRecipient) return reject("RECIPIENT_MISMATCH");

  // 7. Amount — must be positive and within the transfer cap.
  const amount = big(input.amount);
  const maxTransfer = big(input.max_transfer);
  if (amount === null || maxTransfer === null) return reject("PROOF_INVALID");
  if (amount <= 0n || amount > maxTransfer) return reject("AMOUNT_OVERFLOW");

  return { decision: "APPROVE", reason_code: "VALID_CONDITION" };
}
