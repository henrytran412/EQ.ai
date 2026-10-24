#!/usr/bin/env bash
# Run EQ.ai on the Jetson: dialogue (:8000), perception (:8001), website (:8080) and the Cloudflare tunnel.
# Everything listens on 127.0.0.1; only the tunnel (outbound) connects to the internet, so the public URL
# reaches just the paths routed in .cloudflared/config.yml. Logs go to logs/ (private: never publish them).
# Usage from the repo root (~/eq-ai):  scripts/serve_jetson.sh start|stop|status
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs run

start() {  # name, command... ; restarted 3 s after it exits, so a crash during a demo heals itself
  local name=$1; shift
  if [ -f "run/$name.pid" ] && kill -0 "$(cat "run/$name.pid")" 2>/dev/null; then echo "$name: already running"; return; fi
  nohup setsid bash -c 'while true; do "$@"; echo "serve_jetson: exited with $?, restarting in 3 s"; sleep 3; done' \
    _ "$@" >> "logs/$name.log" 2>&1 &
  echo $! > "run/$name.pid" # the loop leads its own process group (setsid)
  echo "$name: started (pid $!)"
}

stop() {  # by saved process group only, never by name pattern (the Jetson is shared)
  local name=$1
  if [ -f "run/$name.pid" ] && kill -- "-$(cat "run/$name.pid")" 2>/dev/null; then echo "$name: stopped"; else echo "$name: not running"; fi
  rm -f "run/$name.pid"
}

case "${1:-status}" in
  start)
    start dialogue .venv/bin/uvicorn services.dialogue.app:create_app --factory --host 127.0.0.1 --port 8000 --env-file .env
    # CUDA/cuDNN live in pip packages inside .venv (scripts/setup_jetson.sh); without them perception uses the CPU
    nv=$(echo "$PWD"/.venv/lib/python3*/site-packages/nvidia)
    start perception env LD_LIBRARY_PATH="$nv/cu13/lib:$nv/cudnn/lib" \
      .venv/bin/uvicorn services.perception.server:create_app --factory --host 127.0.0.1 --port 8001 --env-file .env \
      --ws-max-size 600000 # largest valid message is a 500 KB camera frame; uvicorn's default is 16 MB
    start website .venv/bin/python -m http.server 8080 --bind 127.0.0.1 --directory apps/student-web/dist
    # HOME=$PWD keeps cloudflared's login cert and tunnel credentials in ./.cloudflared (gitignored)
    if [ -f .cloudflared/config.yml ]; then start tunnel env HOME="$PWD" bin/cloudflared tunnel --config .cloudflared/config.yml run
    else echo "tunnel: no .cloudflared/config.yml, site stays local"; fi ;;
  stop)
    for name in tunnel website perception dialogue; do stop "$name"; done ;;
  status)
    for name in dialogue perception website tunnel; do
      if [ -f "run/$name.pid" ] && kill -0 "$(cat "run/$name.pid")" 2>/dev/null; then echo "$name: running"; else echo "$name: stopped"; fi
    done ;;
  *) echo "usage: $0 start|stop|status"; exit 1 ;;
esac
