#!/usr/bin/env bash
# Watchdog: keep prover + tunnel alive for as long as WSL is up.
# Run as the long-lived foreground process that also holds the WSL session open.
cd ~/agentgames/prover
set -a; source .env; set +a

# WSL DNS returns IPv6-first for workers.dev but the v6 path is dead; force IPv4
# so the tunnel's register fetch and the prover's outbound calls work.
export NODE_OPTIONS="--dns-result-order=ipv4first"

echo "$(date -u +%FT%TZ) watchdog start"
while true; do
  if ! curl -s -m 3 "http://127.0.0.1:${PROVER_PORT}/health" > /dev/null 2>&1; then
    pkill -f "node server.mjs" 2>/dev/null
    sleep 1
    nohup node server.mjs >> server.log 2>&1 &
    echo "$(date -u +%FT%TZ) server (re)started pid $!"
  fi
  if ! pgrep -f "node tunnel.mjs" > /dev/null 2>&1; then
    pkill -f "cloudflared tunnel" 2>/dev/null
    sleep 1
    nohup node tunnel.mjs >> tunnel.log 2>&1 &
    echo "$(date -u +%FT%TZ) tunnel (re)started pid $!"
  fi
  sleep 30
done
