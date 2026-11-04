#!/usr/bin/env bash
# Stops the gateway, any Lambda process it left behind, and Postgres.
#   --wipe  also deletes the Postgres volume (the next dev.sh reloads the schema)
#           and the local S3 files, which belong to the diagrams in it
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

wipe=false
[[ "${1:-}" == "--wipe" ]] && wipe=true

if [[ -f "${STATE_DIR}/gateway.pid" ]]; then
  pid="$(cat "${STATE_DIR}/gateway.pid")"
  if kill -0 "${pid}" 2>/dev/null; then
    echo "Stopping the gateway (pid ${pid}) ..."
    kill -TERM "${pid}" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "${pid}" 2>/dev/null || break
      sleep 0.5
    done
    kill -KILL "${pid}" 2>/dev/null || true
  fi
  rm -f "${STATE_DIR}/gateway.pid"
fi

# Lambda processes outlive a gateway that was killed hard; match them by path.
if pgrep -f "${STATE_DIR}/bin/" >/dev/null 2>&1; then
  echo "Stopping leftover Lambda processes ..."
  pkill -f "${STATE_DIR}/bin/" || true
fi
rm -f "${STATE_DIR}/lambda.pids"

# Compose needs the password variable set to parse the file, even to stop.
if [[ -s "${STATE_DIR}/pg_password" ]]; then
  load_secrets
else
  export CLUTTER_DEV_PG_PASSWORD=unused
fi
if ${wipe}; then
  echo "Stopping Postgres and deleting its volume and the local S3 files ..."
  compose down -v
  rm -rf "${STATE_DIR}/s3"
else
  echo "Stopping Postgres (data kept; use --wipe to delete it) ..."
  compose down
fi
