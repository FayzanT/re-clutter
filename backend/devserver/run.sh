#!/usr/bin/env bash
# Starts System A locally: Postgres in Docker, then the gateway that runs the
# real Lambdas behind an API Gateway stand-in. Development only. No AWS.
# Stop everything with stop.sh.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

for tool in go docker openssl curl; do
  command -v "${tool}" >/dev/null || { echo "run.sh: ${tool} is required" >&2; exit 1; }
done

if [[ -f "${STATE_DIR}/gateway.pid" ]] && kill -0 "$(cat "${STATE_DIR}/gateway.pid")" 2>/dev/null; then
  echo "The devserver is already running (pid $(cat "${STATE_DIR}/gateway.pid")). Run stop.sh first." >&2
  exit 1
fi
for addr in "${API_ADDR}" "${FRONT_ADDR}"; do
  if curl -s -o /dev/null --max-time 1 "http://${addr}/"; then
    echo "run.sh: something already listens on ${addr}. Stop it first (the Next dev server belongs on 3100)." >&2
    exit 1
  fi
done

load_secrets

echo "Starting Postgres on 127.0.0.1:${PG_PORT} ..."
compose up -d --wait postgres >/dev/null

echo "Building the gateway ..."
go -C "${DEVSERVER_DIR}" build -o "${STATE_DIR}/gateway" ./cmd/gateway

echo "Building the local Terraform preview generator ..."
go -C "${REPO_DIR}/backend/api" build -o "${STATE_DIR}/terraform-preview" ./terraform-engine/create/cmd/preview

echo "Building the Lambdas and starting the gateway (log: ${STATE_DIR}/gateway.log) ..."
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
  if curl -fs --max-time 1 "http://${API_ADDR}/dev/healthz" >/dev/null; then
    break
  fi
  if ! kill -0 "$(cat "${STATE_DIR}/gateway.pid")" 2>/dev/null; then
    echo "run.sh: the gateway exited. Last log lines:" >&2
    tail -n 30 "${STATE_DIR}/gateway.log" >&2
    exit 1
  fi
  sleep 0.5
done
curl -fs --max-time 1 "http://${API_ADDR}/dev/healthz" >/dev/null || { echo "run.sh: the gateway did not become ready" >&2; exit 1; }

cat <<EOF

The devserver is up.
  API (stands in for API Gateway):  http://localhost:8787
  Postgres:                         127.0.0.1:${PG_PORT}, database clutter
  Gateway log:                      ${STATE_DIR}/gateway.log

Start the frontend in another terminal (port 3100; the devserver's front door owns 3000):
  NEXT_PUBLIC_API_ENDPOINT=http://localhost:8787 npm --prefix "${REPO_DIR}/frontend/clutter" run dev -- --hostname 127.0.0.1 --port 3100

Then sign in as the dev user:
  http://localhost:3000/dev/login

Smoke test every route:  ${DEVSERVER_DIR}/smoke.sh
Stop everything:         ${DEVSERVER_DIR}/stop.sh        (add --wipe to delete the database)
EOF
