#!/usr/bin/env bash
set -e
D=/home/suwajal/agentgames/prover
SECRET="test-secret-e2e-0123456789abcdef"
WORKER="https://agent-gatekeeper.bright-owl-gatekeeper.workers.dev"
VK=0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DEADLINE=$(date -u -d '+60 seconds' +%Y-%m-%dT%H:%M:%SZ)
PTX="0xe2e$(date +%s)00000000000000000000000000000000000000000000000000000000000000"
TASK="{\"type\":\"agent-games.proof-gatekeeper.v1\",\"task_id\":\"e2e_$(date +%s)\",\"mode\":\"practice\",\"issued_at\":\"$NOW\",\"deadline_at\":\"$DEADLINE\",\"input\":{\"registered_vk\":\"$VK\",\"proof_vk\":\"$VK\",\"minimum\":\"1000\",\"public_balance\":\"1460\",\"expiry_block\":\"8430000\",\"current_block\":\"8420000\",\"recipient\":\"0xabcdef1234567890abcdef1234567890abcdef12\",\"condition_recipient\":\"0xabcdef1234567890abcdef1234567890abcdef12\",\"amount\":\"500\",\"max_transfer\":\"1000\",\"proof_tx\":\"$PTX\"}}"
echo "TASK=$TASK"
SIG=$(printf '%s' "$TASK" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')
echo "SIG=$SIG"
RESP=$(curl -s -m 50 -w '\nHTTP=%{http_code}' -X POST "$WORKER/agent" \
  -H 'content-type: application/json' -H "x-agent-games-signature: $SIG" --data "$TASK")
echo "RESP=$RESP"
