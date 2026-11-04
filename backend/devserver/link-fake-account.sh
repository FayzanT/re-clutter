#!/usr/bin/env bash
# Links a fake AWS account to the dev user's organizations, so the diagram
# editor unlocks locally (A opens it only for an organization with a linked
# account). Only Postgres is written; no AWS call is made. Development only.
# Usage: link-fake-account.sh   (with npm run dev already running)
set -euo pipefail
trap 'echo "link-fake-account.sh: a call to the devserver failed (line $LINENO)" >&2' ERR
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

command -v python3 >/dev/null || { echo "link-fake-account.sh: python3 is required" >&2; exit 1; }
curl -fs --max-time 2 "http://${API_ADDR}/dev/healthz" >/dev/null || { echo "link-fake-account.sh: the devserver is not running; start it with npm run dev" >&2; exit 1; }

api="http://${API_ADDR}"
token="$(curl -fs "${api}/dev/login?format=json" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("token") or d["data"]["token"])')"
orgs="$(curl -fs -H "Authorization: ${token}" "${api}/organization" | python3 -c 'import sys,json; print(" ".join(o["id"] for o in json.load(sys.stdin)["data"]))')"
if [[ -z "${orgs}" ]]; then
  echo "No organization yet. Sign in at http://localhost:3000/dev/login, create one, then run this again." >&2
  exit 1
fi

for org in ${orgs}; do
  linked="$(curl -fs -H "Authorization: ${token}" "${api}/organization/${org}/accounts" | python3 -c 'import sys,json; print(len((json.load(sys.stdin).get("data") or {}).get("complete") or []))')"
  if [[ "${linked}" != "0" ]]; then
    echo "org ${org}: already has a linked account"
    continue
  fi
  stack="$(curl -fs -H "Authorization: ${token}" "${api}/cloudformation-stack-url/${org}?accountName=localfake$(date +%s)&region=us-west-2")"
  read -r account unique < <(printf '%s' "${stack}" | python3 -c '
import sys, json, urllib.parse as u
d = json.load(sys.stdin)["data"]
url = u.urlparse(d["url"])
q = u.parse_qs(url.fragment.split("?", 1)[1]) if "?" in url.fragment else u.parse_qs(url.query)
print(d["account_id"], q["param_UniqueId"][0])')
  curl -fs -o /dev/null -X POST -H "Authorization: ${token}" -H "Content-Type: application/json" \
    -d "{\"role_arn\":\"arn:aws:iam::123456789012:role/AllowClutterToDeployTerraformRole-${unique}\"}" \
    "${api}/organization/${org}/accounts/${account}"
  echo "org ${org}: linked a fake account (123456789012); the diagram editor is unlocked"
done
