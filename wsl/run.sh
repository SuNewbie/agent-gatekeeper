#!/usr/bin/env bash
# Start (or restart) prover + quick-tunnel in the background.
set -e
cd "$(dirname "$0")"
set -a; source .env; set +a
[ -n "$WORKER_URL" ] || { echo "WORKER_URL is empty in .env yet (deploy the worker first)"; exit 1; }
pkill -f "node server.mjs" 2>/dev/null || true
pkill -f "node tunnel.mjs" 2>/dev/null || true
sleep 1
nohup node server.mjs > server.log 2>&1 &
echo $! > server.pid
nohup node tunnel.mjs > tunnel.log 2>&1 &
echo $! > tunnel.pid
sleep 3
echo "server pid $(cat server.pid), tunnel pid $(cat tunnel.pid)"
tail -2 server.log || true
