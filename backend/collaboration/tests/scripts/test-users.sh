#!/usr/bin/env bash
# Makes four local test users and their data for the live sync browser tests,
# and writes each user's sign-in files. Start the app first (npm run dev).
#   backend/collaboration/tests/scripts/test-users.sh            make what is missing
#   backend/collaboration/tests/scripts/test-users.sh --reset    also reset the team's diagrams
#   backend/collaboration/tests/scripts/test-users.sh --remove   delete the users and their data
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../devserver/lib.sh
source "${here}/../../../devserver/lib.sh"

if ! curl -fs --max-time 1 "http://${API_ADDR}/dev/healthz" >/dev/null; then
  echo "A's API is not running on ${API_ADDR}. Start the app with npm run dev." >&2
  exit 2
fi

load_secrets
JWT_SECRET="${JWT_SECRET}" \
  LIVE_API="http://${API_ADDR}" \
  LIVE_WS="ws://${COLLAB_ADDR}" \
  LIVE_USERS_DIR="${STATE_DIR}/live-sync-users" \
  node "${here}/test-users.ts" "$@"
