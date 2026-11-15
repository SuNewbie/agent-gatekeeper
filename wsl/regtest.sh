#!/usr/bin/env bash
# Definitive diagnostic: sign a register payload with the CORRECT token from .env
# and POST it to the live worker /prover/register. 200 => route works, only the
# stored secret is stale. 401 => token mismatch (as expected if secret is wrong).
# Prints status + whether the tunnel URL got stored. No secrets echoed.
set -e
D=/home/suwajal/agentgames/prover
TOK=$(grep '^PROVER_TOKEN=' "$D/.env" | cut -d= -f2 | tr -d '[:space:]')
WORKER="https://agent-gatekeeper.bright-owl-gatekeeper.workers.dev"
TUNNEL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$D/tunnel.log" | tail -1)
TS=$(date +%s)000
BODY="{\"url\":\"$TUNNEL\",\"circuits\":[\"gatekeeper\"],\"ts\":$TS}"
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$TOK" -hex | awk '{print $NF}')
echo "tunnel=$TUNNEL  toklen=${#TOK}"
RESP=$(curl -s -w '\n%{http_code}' -m 10 -X POST "$WORKER/prover/register" \
  -H 'content-type: application/json' \
  -H "x-prover-signature: $SIG" \
  --data "$BODY")
echo "http_code=$(echo "$RESP" | tail -1)"
echo "body=$(echo "$RESP" | head -1)"
