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
  "terraform-engine/files"
  "terraform-engine/logs/get"
  "terraform-engine/logs/url"
  "terraform-engine/logs/live"
  "ansible/create-playbook-upload-url"
  "ansible/submit-job"
  "ansible/get-job"
  "ansible/get-job-logs"
  "ansible/list-jobs"
  "ansible/run-task"
  "resources/get"
)

# Detect root directory of script
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Cross-compile for AWS Lambda (Go custom runtime)
GOOS=linux
GOARCH=arm64

# Detect OS
OS_TYPE="$(uname -s)"

echo "🏗️  Building Go Lambda functions on ${OS_TYPE}..."

for dir in "${LAMBDA_DIRS[@]}"; do
  SRC_DIR="${ROOT_DIR}/${dir}"
  DEPLOY_DIR="${SRC_DIR}/deploy"
  MAIN_GO="${SRC_DIR}/main.go"
  BINARY="${DEPLOY_DIR}/bootstrap"
  ZIP_FILE="${DEPLOY_DIR}/bootstrap.zip"

  echo "📁 Checking Lambda in: ${dir}"

  mkdir -p "${DEPLOY_DIR}"

  # Only rebuild if main.go is newer than the binary or if binary doesn't exist
  if [[ ! -f "$BINARY" ]] || [[ "$MAIN_GO" -nt "$BINARY" ]]; then
    echo "   → Compiling Go source..."
    GOOS=$GOOS GOARCH=$GOARCH go build -o "$BINARY" "$MAIN_GO"

    # Zip the binary depending on OS
    if command -v zip &> /dev/null; then
      cd "$DEPLOY_DIR"
      zip -q -r bootstrap.zip bootstrap
      cd - > /dev/null
    elif [[ "$OS_TYPE" == "MINGW"* || "$OS_TYPE" == "MSYS"* || "$OS_TYPE" == "CYGWIN"* ]]; then
      # Windows (Git Bash / MSYS)
      if command -v powershell.exe &> /dev/null; then
        WIN_PATH=$(cygpath -w "$DEPLOY_DIR")
        powershell.exe -Command "Compress-Archive -Path '${WIN_PATH}\\bootstrap' -DestinationPath '${WIN_PATH}\\bootstrap.zip' -Force"
      else
        echo "⚠️  PowerShell not found on Windows. Please install it or use zip command."
        exit 1
      fi
    else
      echo "⚠️  'zip' command not found. Please install zip."
      exit 1
    fi

    echo "✅ Built ${dir}/deploy/bootstrap.zip"
  else
    echo "   → No changes detected, skipping build."
  fi
done

echo "🎉 All Lambdas processed successfully!"