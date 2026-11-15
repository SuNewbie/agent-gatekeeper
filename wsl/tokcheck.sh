#!/usr/bin/env bash
# Dump the token length + a 32-char hash for verification without printing the secret.
D=/home/suwajal/agentgames/prover
TOK=$(grep "^PROVER_TOKEN=" "$D/.env" | cut -d= -f2 | tr -d '[:space:]')
echo "len=${#TOK}"
echo "is64hex=$(printf '%s' "$TOK" | grep -cE '^[0-9a-f]{64}$')"
printf '%s' "$TOK" | sha256sum | cut -c1-32
printf '%s' "$TOK" > /tmp/prov_tok
echo "tmp_bytes=$(wc -c < /tmp/prov_tok)"
wc -l "$D/.env"
