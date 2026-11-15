#!/usr/bin/env bash
# Verifikasi FINAL dengan secret asli: preflight + valid task (APPROVE + Groth16 proof).
# --data-binary agar body yang dikirim byte-for-byte = body yang di-HMAC.
set -e
SC=/mnt/c/Users/suwajal/AppData/Local/hermes/cache/scratch/ag-hmac-secret.tmp
SECRET=$(tr -d '[:space:]' < "$SC")
[ ${#SECRET} -eq 64 ] || { echo "secret len wrong"; exit 1; }
HOST="https://agent-gatekeeper.bright-owl-gatekeeper.workers.dev"

check_sig() { # $1=label $2=bodyfile $3=resp_sig
  local rt rh
  rt=$(openssl dgst -sha256 -hmac "$SECRET" -hex < "$2" | awk '{print $NF}')
  rh=$(python3 -c "import hmac,hashlib; s=open('$SC','rb').read().strip(); print(hmac.new(bytes.fromhex(s.decode()), open('$2','rb').read(), hashlib.sha256).hexdigest())")
  echo "  $1 resp-sig: text=$([ "$3" = "$rt" ] && echo MATCH || echo no) hexform=$([ "$3" = "$rh" ] && echo MATCH || echo no)"
}

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DEADLINE=$(date -u -d '+60 seconds' +%Y-%m-%dT%H:%M:%SZ)

echo "=== preflight ==="
printf '{"type":"agent-games.preflight.v1","agent_id":"agt_verify","issued_at":"%s","nonce":"fin1"}' "$NOW" > /tmp/pf
SIG=$(openssl dgst -sha256 -hmac "$SECRET" -hex < /tmp/pf | awk '{print $NF}')
CODE=$(curl -s -D /tmp/h -o /tmp/pfb -w '%{http_code}' -m 60 -X POST "$HOST/agent" \
  -H 'content-type: application/json' -H "x-agent-games-signature: $SIG" --data-binary @/tmp/pf)
RSIG=$(tr -d '\r' < /tmp/h | awk 'tolower($1)=="x-agent-games-signature:"{print $2}')
echo "preflight http=$CODE body=$(cat /tmp/pfb)"
check_sig "preflight" /tmp/pfb "$RSIG"
[ "$CODE" = "200" ] || { echo "PREFLIGHT FAIL"; exit 1; }

echo "=== valid task (expect APPROVE + proof) ==="
PTX="0x$(openssl rand -hex 32)"
# printf (no trailing newline) -> body exact
printf '{"type":"agent-games.proof-gatekeeper.v1","task_id":"verify_%s","mode":"practice","issued_at":"%s","deadline_at":"%s","input":{"registered_vk":"0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0","proof_vk":"0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0","minimum":"1000","public_balance":"1460","expiry_block":"8430000","current_block":"8420000","recipient":"0xabcdef1234567890abcdef1234567890abcdef12","condition_recipient":"0xabcdef1234567890abcdef1234567890abcdef12","amount":"500","max_transfer":"1000","proof_tx":"%s"}}' \
  "$(openssl rand -hex 6)" "$NOW" "$DEADLINE" "$PTX" > /tmp/tk
SIG=$(openssl dgst -sha256 -hmac "$SECRET" -hex < /tmp/tk | awk '{print $NF}')
CODE=$(curl -s -D /tmp/h -o /tmp/tkb -w '%{http_code}' -m 90 -X POST "$HOST/agent" \
  -H 'content-type: application/json' -H "x-agent-games-signature: $SIG" --data-binary @/tmp/tk)
RSIG=$(tr -d '\r' < /tmp/h | awk 'tolower($1)=="x-agent-games-signature:"{print $2}')
echo "task http=$CODE"
python3 -c "import json;j=json.load(open('/tmp/tkb'));print('  decision=',j.get('decision'),'reason=',j.get('reason_code'),'has_proof=',('proof' in j),'signals=',len(j.get('public_signals') or []))"
check_sig "task" /tmp/tkb "$RSIG"
[ "$CODE" = "200" ] || { echo "TASK FAIL"; exit 1; }

echo "=== stable subdomain DNS (untuk dashboard) ==="
for h in https://bright-owl-gatekeeper.workers.dev; do
  c=$(curl -s -o /tmp/hh -w '%{http_code}' -m 12 "$h/health" 2>/dev/null) || c=000
  echo "  $h -> $c $(cat /tmp/hh 2>/dev/null | head -c 50)"
done
rm -f /tmp/pf /tmp/pfb /tmp/tk /tmp/tkb /tmp/h /tmp/hh
echo "ALL DONE"
