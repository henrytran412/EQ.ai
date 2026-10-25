#!/usr/bin/env bash
# Build the student web app for the public site and copy it to the Jetson (run on the laptop, Git Bash).
# The services and the tunnel keep running; the Jetson's static server picks up the new files at once.
# Usage from the repo root:  scripts/deploy_site.sh [https://eqai.study]
set -euo pipefail
cd "$(dirname "$0")/.."
SITE=${1:-https://eqai.study}
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

(cd apps/student-web && npm test >/dev/null && \
  VITE_API_URL="$SITE" VITE_PERCEPTION_URL="${SITE/https:/wss:}" npx vite build --outDir "$OUT" --emptyOutDir)
# /advisor is the advisor view (a new tab after a handoff), /plain the emotion-off comparison page for the demo video
for route in advisor plain; do mkdir -p "$OUT/$route" && cp "$OUT/index.html" "$OUT/$route/index.html"; done
if grep -rqE "sk[-_](ant|car)[A-Za-z0-9]" "$OUT"; then echo "refusing to deploy: an API key is in the bundle"; exit 1; fi

ssh jetson 'rm -rf ~/eq-ai/apps/student-web/dist.new && mkdir -p ~/eq-ai/apps/student-web/dist.new'
scp -qr "$OUT"/. jetson:eq-ai/apps/student-web/dist.new/
ssh jetson 'cd ~/eq-ai/apps/student-web && rm -rf dist.old && { [ ! -d dist ] || mv dist dist.old; } && mv dist.new dist && rm -rf dist.old'
echo "Deployed $(ls "$OUT/assets" | tr '\n' ' ')to the Jetson for $SITE"
