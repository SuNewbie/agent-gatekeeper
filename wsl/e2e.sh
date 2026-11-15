#!/usr/bin/env bash
# E2E: send a signed, valid Proof-Gatekeeper task to the live worker and confirm
# it comes back APPROVED with a real Groth16 `proof` produced by the remote prover.
set -e
D=/home/suwajal/agentgames/prover
# test secret must match the worker's AGENT_GAMES_HMAC_SECRET (set to this value)
SECRET="test-secret-e2e-0123456789abcdef"
WORKER="https://agent-gatekeeper.bright-owl-gatekeeper.workers.dev"
TUNNEL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$D/tunnel.log" | tail -1)

VK=0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DEADLINE=$(date -u -d '+60 seconds' +%Y-%m-%dT%H:%M:%SZ)
TASK="{"type":"agent-games.proof-gatekeeper.v1","task_id":"e2e_$(date +%s)","mode":"practice","issued_at":"$NOW","deadline_at":"$DEADLINE","input":{"registered_vk":"$VK","proof_vk":"$VK","minimum":"1000","public_balance":"1460","expiry_block":"8430000","current_block":"8420000","recipient":"0xabcdef1234567890abcdef1234567890abcdef12","condition_recipient":"0xabcdef1234567890abcdef1234567890abcdef12","amount":"500","max_transfer":"1000","proof_tx":"0xe2e$(date +%s)00000000000000000000000000000000000000000000000000000000000000"}}"
SIG=$(printf '%s' "$TASK" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')
RESP=$(curl -s -m 50 -w '\n%{http_code}\n%{time_total}' -X POST "$WORKER/agent" \
  -H 'content-type: application/json' -H "x-agent-games-signature: $SIG" --data "$TASK")
CODE=$(echo "$RESP" | sed -n 2p)
TIME=$(echo "$RESP" | sed -n 3p)
BODY=$(echo "$RESP" | sed -n 1p)
echo "http=$CODE  time_s=$TIME"
# summarize without dumping the big proof
printf '%s' "$BODY" | python3 -c '
import json,sys
r=json.load(sys.stdin)
print("decision:", r.get("decision"))
print("reason_code:", r.get("reason_code"))
print("has_proof:", "proof" in r)
p=r.get("proof") or {}
print("proof_keys:", sorted(p.keys()) if p else None)
print("public_signals_count:", len(r.get("public_signals") or []))
'
echo "prover tunnel used: $TUNNEL"
