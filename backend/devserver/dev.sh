#!/usr/bin/env bash
# The one way to start System A locally (`npm run dev` at the repo root). Development only. No AWS.
#   dev.sh                 checks the tools, starts Postgres and the backend, then runs the frontend
#                          in this terminal. Ctrl+C stops everything.
#   dev.sh --backend-only  starts Postgres and the backend, then returns. Stop with stop.sh.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

backend_only=false
case "$*" in
  "") ;;
  --backend-only) backend_only=true ;;
  *) echo "usage: dev.sh [--backend-only]" >&2; exit 2 ;;
esac

need() {
  command -v "$1" >/dev/null || { echo "Missing $1. $2" >&2; exit 1; }
}
need go "Install Go 1.25 or newer: https://go.dev/doc/install"
need docker "Install Docker Desktop: https://www.docker.com/products/docker-desktop"
need openssl "Install OpenSSL with your package manager."
need curl "Install curl with your package manager."
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Open Docker Desktop, wait until it is ready, then run this again." >&2; exit 1; }
if ! ${backend_only}; then
  need node "Install Node 22 or newer: https://nodejs.org"
  [[ -d "${REPO_DIR}/frontend/clutter/node_modules" ]] || { echo "The frontend packages are missing. Run npm install at the repo root first." >&2; exit 1; }
fi

gateway_healthy() {
  curl -fs --max-time 1 "http://${API_ADDR}/dev/healthz" >/dev/null
}
gateway_process_alive() {
  [[ -f "${STATE_DIR}/gateway.pid" ]] && kill -0 "$(cat "${STATE_DIR}/gateway.pid")" 2>/dev/null
}

if gateway_healthy || gateway_process_alive; then
  echo "The backend is already running; restarting it so it picks up your code."
  "${DEVSERVER_DIR}/stop.sh" >/dev/null 2>&1
fi
for addr in "${API_ADDR}" "${FRONT_ADDR}"; do
  if curl -s -o /dev/null --max-time 1 "http://${addr}/"; then
    echo "Something already listens on ${addr}. Stop it first (lsof -nP -iTCP:${addr##*:} -sTCP:LISTEN)." >&2
    exit 1
  fi
done
if ! ${backend_only} && curl -s -o /dev/null --max-time 1 "${FRONTEND_UPSTREAM}/"; then
  echo "Something already listens on ${FRONTEND_UPSTREAM}. Stop it first (lsof -nP -iTCP:3100 -sTCP:LISTEN)." >&2
  exit 1
fi

cleanup() {
  trap '' INT TERM # a second Ctrl+C must not cut the stop short
  trap - EXIT
  echo
  echo "Stopping the backend and database (your data is kept)."
  "${DEVSERVER_DIR}/stop.sh" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'cleanup; exit 0' INT TERM

# Runs a quiet step, and shows its output only when it fails.
quietly() {
  local out
  if ! out="$("$@" 2>&1)"; then
    echo "${out}" >&2
    exit 1
  fi
}

load_secrets

echo "Starting the database and backend (the first run builds the Lambdas and takes a minute or two) ..."
quietly compose up -d --wait postgres
quietly go -C "${DEVSERVER_DIR}" build -o "${STATE_DIR}/gateway" ./cmd/gateway

# A clean environment: no AWS_* or other variables from this shell reach the
# gateway. Go needs PATH and HOME (for its caches).
nohup env -i \
  PATH="${PATH}" HOME="${HOME}" TMPDIR="${TMPDIR:-/tmp}" \
  ${GOPROXY:+GOPROXY="${GOPROXY}"} ${GOFLAGS:+GOFLAGS="${GOFLAGS}"} \
  JWT_SECRET="${JWT_SECRET}" \
  PSQL_CONNECTION_STRING="${PSQL_CONNECTION_STRING}" \
  "${STATE_DIR}/gateway" \
    -api-dir "${REPO_DIR}/backend/api" \
    -state-dir "${STATE_DIR}" \
    -api-addr "${API_ADDR}" \
    -front-addr "${FRONT_ADDR}" \
    -frontend-upstream "${FRONTEND_UPSTREAM}" \
  > "${STATE_DIR}/gateway.log" 2>&1 &
echo $! > "${STATE_DIR}/gateway.pid"

for _ in $(seq 1 240); do
  gateway_healthy && break
  if ! gateway_process_alive; then
    echo "The gateway exited. Last log lines:" >&2
    tail -n 30 "${STATE_DIR}/gateway.log" >&2
    exit 1
  fi
  sleep 0.5
done
if ! gateway_healthy; then
  echo "The gateway did not become ready. Last log lines:" >&2
  tail -n 30 "${STATE_DIR}/gateway.log" >&2
  exit 1
fi

if ${backend_only}; then
  trap - INT TERM EXIT
  cat <<EOF

The backend is up (no frontend).
  API:       http://localhost:8787
  Postgres:  127.0.0.1:${PG_PORT}, database clutter
  Log:       ${STATE_DIR}/gateway.log
  Smoke:     npm run smoke
  Stop:      npm run stop   (add -- --wipe to delete the database)
EOF
  exit 0
fi

cat <<EOF

Clutter is starting.
  Open:   http://localhost:3000/dev/login   (or http://localhost:3000/login for Google)
  Stop:   Ctrl+C here

EOF
# Ctrl+C reaches the frontend too. It may exit before the trap above runs, with
# 130 or 143 (killed by SIGINT or SIGTERM): that is a normal stop, not a failure.
status=0
NEXT_PUBLIC_API_ENDPOINT="http://localhost:8787" npm --prefix "${REPO_DIR}/frontend/clutter" run dev -- --hostname 127.0.0.1 --port 3100 || status=$?
case "${status}" in
  130 | 143) exit 0 ;;
  *) exit "${status}" ;;
esac
