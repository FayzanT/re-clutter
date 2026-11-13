#!/usr/bin/env bash
# Deploys Clutter to a cloud environment (docs/architecture/environments.md).
#   npm run deploy:plan -- prod    shows what would change, changes nothing
#   npm run deploy -- prod         plans, asks, then applies (clean main only)
#   npm run deploy:destroy -- dev  plans a teardown of a test environment (never prod); unused until one exists
# Run by a person, never by a session. It has not yet been run against real AWS: only its checks
# are tested (test-deploy.sh). It covers the platform Terraform; the steps it cannot do are printed
# at the end.
set -euo pipefail

INFRA_DIR="${CLUTTER_INFRA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
BUILD_CMD="${CLUTTER_BUILD_CMD:-${INFRA_DIR}/../api/build.sh}"

fail() { echo "deploy: $1" >&2; exit 1; }

action="${1:-}"
env_name="${2:-}"
case "${action}" in plan|apply|destroy) ;; *) fail "usage: deploy.sh plan|apply|destroy dev|prod" ;; esac
case "${env_name}" in dev|prod) ;; *) fail "usage: deploy.sh plan|apply|destroy dev|prod" ;; esac
[[ "${action}:${env_name}" != "destroy:prod" ]] || fail "destroying prod is not allowed from this script."

for tool in terraform aws git; do
  command -v "${tool}" >/dev/null || fail "${tool} is required."
done

vars_file="${INFRA_DIR}/${env_name}.tfvars"
backend_file="${INFRA_DIR}/${env_name}.backend.hcl"
[[ -f "${vars_file}" ]] || fail "missing ${env_name}.tfvars. Copy terraform.tfvars.example to it and fill it in."
[[ -f "${backend_file}" ]] || fail "missing ${env_name}.backend.hcl. Copy backend.hcl.example to it and fill it in."
if grep -qE 'REPLACE|USER:PASSWORD|BUCKET\.s3|123456789012|dev\.example\.com' "${vars_file}" "${backend_file}"; then
  fail "${env_name}.tfvars or ${env_name}.backend.hcl still holds example values."
fi

# The credentials in this shell must belong to the account this environment names.
want_account="$(sed -nE 's/^[[:space:]]*clutter_account_id[[:space:]]*=[[:space:]]*"([0-9]+)".*/\1/p' "${vars_file}")"
[[ -n "${want_account}" ]] || fail "clutter_account_id is not set in ${env_name}.tfvars."
have_account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" || fail "not logged in to AWS."
[[ "${have_account}" == "${want_account}" ]] || fail "logged in to AWS account ${have_account}, but ${env_name} is account ${want_account}."

if [[ "${env_name}" == "prod" && "${action}" != "plan" ]]; then
  [[ "$(git -C "${INFRA_DIR}" rev-parse --abbrev-ref HEAD)" == "main" ]] || fail "prod deploys only from main."
  [[ -z "$(git -C "${INFRA_DIR}" status --porcelain)" ]] || fail "prod deploys only from a clean checkout."
fi

echo "Building the Lambdas ..."
"${BUILD_CMD}"

echo "Connecting to ${env_name}'s Terraform state ..."
terraform -chdir="${INFRA_DIR}" init -reconfigure -backend-config="${env_name}.backend.hcl"

plan_file="${env_name}.tfplan"
trap 'rm -f "${INFRA_DIR}/${plan_file}"' EXIT
plan_args=(-var-file="${env_name}.tfvars" -out="${plan_file}")
[[ "${action}" != "destroy" ]] || plan_args+=(-destroy)
terraform -chdir="${INFRA_DIR}" plan "${plan_args[@]}"

if [[ "${action}" == "plan" ]]; then
  echo "Plan only: nothing changed."
  exit 0
fi

echo
read -r -p "Type ${env_name} to ${action} this plan in AWS account ${want_account}: " answer
[[ "${answer}" == "${env_name}" ]] || fail "not confirmed; nothing changed."
terraform -chdir="${INFRA_DIR}" apply "${plan_file}"

if [[ "${action}" == "apply" ]]; then
  cat <<EOF

Terraform is applied to ${env_name}. Still by hand (docs/architecture/environments.md):
  - push the runner images (modules/fargate/ecr-scripts/*/build-and-push.sh), the first time
  - publish the API Gateway stage
  - set up the Supabase webhook, the first time
  - build and host the frontend with this environment's API address
EOF
fi
