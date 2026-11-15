#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -f server.pid ] && kill "$(cat server.pid)" 2>/dev/null
[ -f tunnel.pid ] && kill "$(cat tunnel.pid)" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
rm -f server.pid tunnel.pid
echo stopped
