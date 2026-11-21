#!/usr/bin/env bash
# Live tests for the sync service against the real local app.
# Start the app first (npm run dev or npm run dev:backend), then run:
#   backend/collaboration/tests/scripts/run-live-tests.sh [results.json]
# It loads the devserver's local secrets the same way smoke.sh does,
# makes its own test users and data, and removes them at the end.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../devserver/lib.sh
source "${here}/../../../devserver/lib.sh"

if ! curl -fs --max-time 1 "http://${API_ADDR}/dev/healthz" >/dev/null; then
  echo "A's API is not running on ${API_ADDR}. Start it with npm run dev:backend." >&2
  exit 2
fi
if ! collab_healthy; then
  echo "The live sync service is not running on ${COLLAB_ADDR}. Start it with npm run dev:backend." >&2
  exit 2
fi
if [[ ! -d "${REPO_DIR}/frontend/clutter/node_modules/y-websocket" ]]; then
  echo "The frontend's packages are missing. Run npm run setup." >&2
  exit 2
fi

load_secrets
JWT_SECRET="${JWT_SECRET}" \
  LIVE_API="http://${API_ADDR}" \
  LIVE_WS="ws://${COLLAB_ADDR}" \
  LIVE_COLLAB_LOG="${STATE_DIR}/collab.log" \
  LIVE_RESULTS="${1:-}" \
  node "${here}/live-tests.ts"
