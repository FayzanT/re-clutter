# shellcheck shell=bash disable=SC2034  # sourced: its variables are used by the scripts that source it
# Shared settings for dev.sh, stop.sh and smoke.sh. Sourced, not run.

DEVSERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${DEVSERVER_DIR}/../.." && pwd)"
STATE_DIR="${DEVSERVER_DIR}/.state"
COMPOSE_FILE="${DEVSERVER_DIR}/docker-compose.yml"

API_ADDR="127.0.0.1:8787"
FRONT_ADDR="127.0.0.1:3000"
FRONTEND_UPSTREAM="http://127.0.0.1:3100"
PG_PORT="54329"

# Generates a secret once and keeps it in .state (mode 600).
local_secret() {
  local file="${STATE_DIR}/$1" prefix="$2"
  if [[ ! -s "${file}" ]]; then
    umask 077
    printf '%s%s' "${prefix}" "$(openssl rand -hex 32)" > "${file}"
  fi
  cat "${file}"
}

load_secrets() {
  mkdir -p "${STATE_DIR}"
  chmod 700 "${STATE_DIR}"
  CLUTTER_DEV_PG_PASSWORD="$(local_secret pg_password '')"
  JWT_SECRET="$(local_secret jwt_secret 'devserver-local-')"
  PSQL_CONNECTION_STRING="postgres://clutter:${CLUTTER_DEV_PG_PASSWORD}@127.0.0.1:${PG_PORT}/clutter?sslmode=disable"
  export CLUTTER_DEV_PG_PASSWORD CLUTTER_DEV_PG_PORT="${PG_PORT}"
}

compose() {
  docker compose -f "${COMPOSE_FILE}" "$@"
}
