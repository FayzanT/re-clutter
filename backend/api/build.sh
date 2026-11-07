#!/usr/bin/env bash
set -euo pipefail

# Define a list of directories that contain main.go files
LAMBDA_DIRS=(
  "log-in"
  "authorizer"
  "cloudformation/stack-url-generator"
  "organization/create"
  "organization/delete"
  "organization/get"
  "organization/update"
  "organization/accounts/submit-role-arn"
  "organization/accounts/get"
  "organization/accounts/delete"
  "project/create"
  "project/delete"
  "project/get"
  "project/update"
  "diagram/create"
  "diagram/get"
  "diagram/update"
  "diagram/delete"
  "terraform-command-runner"
  "user-information/get"
  "terraform-engine/create"
  "terraform-engine/code-upload"
  "terraform-engine/files"
  "terraform-engine/logs/get"
  "terraform-engine/logs/url"
  "terraform-engine/logs/live"
  "terraform-engine/logs/recent-activity"
  "resources/get"
  "ansible/create-playbook-upload-url"
  "ansible/submit-job"
  "ansible/get-job"
  "ansible/get-job-logs"
  "ansible/list-jobs"
  "ansible/run-task"
)

# Detect root directory of script
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Cross-compile for AWS Lambda (Go custom runtime)
GOOS=linux
GOARCH=arm64

echo "🏗️  Building Go Lambda functions..."

# Helper function to get file modification time
get_mod_time() {
  local file="$1"
  if [[ "$(uname)" == "Darwin" ]]; then
    stat -f %m "$file" 2>/dev/null || echo 0
  else
    stat -c %Y "$file" 2>/dev/null || echo 0
  fi
}

# Helper function to get latest modification time in a directory
get_latest_mod_time() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    echo 0
    return
  fi

  if [[ "$(uname)" == "Darwin" ]]; then
    find "$dir" -type f -exec stat -f %m {} + | sort -n | tail -1 || echo 0
  else
    find "$dir" -type f -printf "%T@\n" | sort -n | tail -1 | awk '{print int($1)}' || echo 0
  fi
}

# Compute latest modification time in generic and shared ansible folders
GENERIC_DIR="${ROOT_DIR}/generic"
GENERIC_MOD_TIME=$(get_latest_mod_time "$GENERIC_DIR")
ANSIBLE_SHARED_DIR="${ROOT_DIR}/ansible/shared"
ANSIBLE_SHARED_MOD_TIME=$(get_latest_mod_time "$ANSIBLE_SHARED_DIR")

for dir in "${LAMBDA_DIRS[@]}"; do
  SRC_DIR="${ROOT_DIR}/${dir}"
  DEPLOY_DIR="${SRC_DIR}/deploy"
  MAIN_GO="${SRC_DIR}/main.go"
  INTERNAL_DIR="${SRC_DIR}/internal"
  BINARY="${DEPLOY_DIR}/bootstrap"
  ZIP_FILE="${DEPLOY_DIR}/bootstrap.zip"

  echo "📁 Checking Lambda in: ${dir}"

  mkdir -p "${DEPLOY_DIR}"

  # Get modification times
  MAIN_MOD_TIME=$(get_mod_time "$MAIN_GO")
  BINARY_MOD_TIME=$(get_mod_time "$BINARY")
  INTERNAL_MOD_TIME=$(get_latest_mod_time "$INTERNAL_DIR")

  # Rebuild if:
  # 1) binary missing
  # 2) main.go changed
  # 3) any file in generic/ changed
  # 4) any file in internal/ changed
  if [[ ! -f "$BINARY" ]] || [[ "$MAIN_MOD_TIME" -gt "$BINARY_MOD_TIME" ]] || \
     [[ "$GENERIC_MOD_TIME" -gt "$BINARY_MOD_TIME" ]] || [[ "$INTERNAL_MOD_TIME" -gt "$BINARY_MOD_TIME" ]] || \
     [[ "$ANSIBLE_SHARED_MOD_TIME" -gt "$BINARY_MOD_TIME" ]]; then
     
    echo "   → Compiling Go source..."
    GOOS=$GOOS GOARCH=$GOARCH go build -o "$BINARY" "$MAIN_GO"

    # Zip the binary
    if command -v zip &> /dev/null; then
      cd "$DEPLOY_DIR"
      zip -q -r bootstrap.zip bootstrap
      cd - > /dev/null
    else
      WIN_PATH=$(echo "$DEPLOY_DIR" | sed 's|^/c|C:|' | sed 's|/|\\|g')
      echo "   → Zipping with PowerShell at: ${WIN_PATH}\\bootstrap.zip"
      powershell.exe -Command "Compress-Archive -Path '${WIN_PATH}\\bootstrap' -DestinationPath '${WIN_PATH}\\bootstrap.zip' -Force"
    fi

    echo "✅ Built ${dir}/deploy/bootstrap.zip"
  else
    echo "   → No changes detected, skipping build."
  fi
done

echo "🎉 All Lambdas processed successfully!"
