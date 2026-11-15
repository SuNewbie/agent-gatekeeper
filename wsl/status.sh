#!/usr/bin/env bash
cd "$(dirname "$0")"
set -a; source .env 2>/dev/null; set +a
echo -n "prover: "
curl -s -m 3 "http://127.0.0.1:${PROVER_PORT:-8790}/health" || echo DOWN
echo
grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" tunnel.log 2>/dev/null | tail -1 || echo "no tunnel url yet"
echo "---- server.log tail ----"
tail -5 server.log 2>/dev/null
echo "---- tunnel.log tail ----"
tail -5 tunnel.log 2>/dev/null
