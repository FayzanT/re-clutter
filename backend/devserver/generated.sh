#!/usr/bin/env bash
# Shows the Terraform the devserver generated, and validates it.
#   generated.sh               list generated diagrams and their files
#   generated.sh <diagram id>  run terraform init and validate on a scratch copy
# Validation never runs in the repo tree and is only init -backend=false and
# validate: no plan, no apply, and no AWS credentials reach terraform. The first
# run downloads the providers from registry.terraform.io into .state.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# <bucket>/<org>/<project>/<diagram>/terraform, as the generator's writer lays it out.
generated_dirs() {
  [[ -d "${STATE_DIR}/s3" ]] || return 0
  find "${STATE_DIR}/s3" -mindepth 5 -maxdepth 5 -type d -name terraform | sort
}

list_generated() {
  local dirs dir diagram project org file
  dirs="$(generated_dirs)"
  if [[ -z "${dirs}" ]]; then
    echo "Nothing generated yet. Start the devserver with npm run dev and save a diagram."
    return
  fi
  while IFS= read -r dir; do
    diagram="$(basename "$(dirname "${dir}")")"
    project="$(basename "$(dirname "$(dirname "${dir}")")")"
    org="$(basename "$(dirname "$(dirname "$(dirname "${dir}")")")")"
    echo "diagram ${diagram}  (project ${project}, organization ${org})"
    while IFS= read -r file; do
      printf '  %-28s %8s bytes  %s\n' "${file#"${dir}"/}" "$(wc -c < "${file}" | tr -d ' ')" "$(date -r "${file}" '+%Y-%m-%d %H:%M:%S')"
    done < <(find "${dir}" -type f | sort)
  done <<< "${dirs}"
  echo
  echo "Files are in ${STATE_DIR}/s3. Validate one with: $0 <diagram id>"
}

validate_generated() {
  local id="$1" dir scratch
  if [[ ! "${id}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "generated.sh: ${id} is not a diagram id" >&2
    exit 2
  fi
  dir="$(generated_dirs | grep "/${id}/terraform$" || true)"
  if [[ -z "${dir}" ]]; then
    echo "generated.sh: no generated files for diagram ${id}; run generated.sh to list them" >&2
    exit 1
  fi
  command -v terraform >/dev/null || { echo "generated.sh: terraform is required" >&2; exit 1; }

  scratch="$(mktemp -d "${TMPDIR:-/tmp}/clutter-generated.XXXXXX")"
  # shellcheck disable=SC2064  # expand now: scratch is local to this function
  trap "rm -rf '${scratch}'" EXIT
  mkdir -p "${scratch}/work" "${scratch}/home" "${STATE_DIR}/terraform-plugins"
  cp -R "${dir}/." "${scratch}/work/"

  # A clean environment and an empty home: no AWS_* variable, no ~/.aws and no
  # ~/.terraformrc reach terraform.
  run_terraform() {
    env -i PATH="${PATH}" HOME="${scratch}/home" TMPDIR="${TMPDIR:-/tmp}" \
      TF_IN_AUTOMATION=1 CHECKPOINT_DISABLE=1 TF_PLUGIN_CACHE_DIR="${STATE_DIR}/terraform-plugins" \
      terraform -chdir="${scratch}/work" "$@"
  }

  echo "Validating a scratch copy of ${dir}"
  if [[ -z "$(ls -A "${STATE_DIR}/terraform-plugins")" ]]; then
    echo "The first run downloads Terraform's AWS provider (about 680 MB), so it can take a few minutes."
  fi
  # A large download over a flaky network can drop, and what it fetched is not kept, so try again.
  local attempt
  for attempt in 1 2 3; do
    if run_terraform init -backend=false -input=false -no-color > "${scratch}/init.log" 2>&1; then
      run_terraform validate -no-color
      return
    fi
    [[ "${attempt}" == 3 ]] || echo "terraform init failed (attempt ${attempt} of 3); trying again."
  done
  cat "${scratch}/init.log" >&2
  echo "generated.sh: terraform init failed. This is usually the network: check your connection and run it again." >&2
  exit 1
}

case "$#" in
  0) list_generated ;;
  1) validate_generated "$1" ;;
  *) echo "usage: generated.sh [diagram id]" >&2; exit 2 ;;
esac
