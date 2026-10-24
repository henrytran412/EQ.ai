#!/usr/bin/env bash
# One-time Cloudflare named tunnel for the public site, run on the Jetson after the login step saved
# .cloudflared/cert.pem:  HOME="$PWD" bin/cloudflared tunnel login   (HOME keeps everything in this repo).
# Writes .cloudflared/config.yml (gitignored); scripts/serve_jetson.sh start then runs the tunnel. Safe to re-run.
# Usage from the repo root (~/eq-ai):  scripts/setup_tunnel.sh [hostname]
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${1:-eqai.study}
NAME=eqai
cf() { HOME="$PWD" bin/cloudflared "$@"; }

[ -f .cloudflared/cert.pem ] || { echo "No .cloudflared/cert.pem yet. First run: HOME=\"\$PWD\" bin/cloudflared tunnel login"; exit 1; }
cf tunnel info "$NAME" >/dev/null 2>&1 || cf tunnel create "$NAME"
ID=$(cf tunnel list --output json | python3 -c "import json, sys; print(next(t['id'] for t in json.load(sys.stdin) if t['name'] == '$NAME'))")
cf tunnel route dns --overwrite-dns "$NAME" "$HOST"

cat > .cloudflared/config.yml <<EOF
tunnel: $ID
credentials-file: $PWD/.cloudflared/$ID.json
protocol: http2 # TCP: busy venue Wi-Fi often throttles the default QUIC (UDP)
ingress:
  # Only these paths are public. /signals (emotion labels from perception) stays on the Jetson.
  - hostname: $HOST
    path: ^/ws/
    service: http://127.0.0.1:8001
  - hostname: $HOST
    path: ^/(chat|handoff|voice/token|health)$
    service: http://127.0.0.1:8000
  - hostname: $HOST
    service: http://127.0.0.1:8080
  - service: http_status:404
EOF
cf tunnel ingress validate --config .cloudflared/config.yml
echo "Tunnel $NAME ($ID) -> https://$HOST. Start it with: scripts/serve_jetson.sh start"
