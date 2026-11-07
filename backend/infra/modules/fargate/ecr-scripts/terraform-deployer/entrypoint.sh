#!/usr/bin/env bash
set -euo pipefail

TOTAL_START_TIME=$(date +%s)

echo "Starting Terraform deploy."
psql --version

# ENVIRONMENT VARIABLES (Required)
# ===============================
# AWS_REGION
# TERRAFORM_DIRECTORY
# CLIENT_ROLE_ARN
# ASSUME_ROLE_EXTERNAL_ID
# COMMAND
# COMMAND_ID

# -------------------------------
# Log files
# -------------------------------
INIT_LOG="/tmp/terraform-init.log"
COMMAND_LOG="/tmp/terraform-command.log"

# -------------------------------
# Error handler
# -------------------------------
on_error() {
  exit_code=$?

  echo
  echo "Terraform deploy failed (exit code: $exit_code)"
  echo "Failed command: ${BASH_COMMAND}"
  echo

  if [[ -f "$INIT_LOG" ]]; then
    echo "Terraform init output:"
    echo "----------------------"
    cat "$INIT_LOG"
    echo "----------------------"
  fi

  if [[ -f "$COMMAND_LOG" ]]; then
    echo "Terraform command output:"
    echo "-----------------------"
    cat "$COMMAND_LOG"
    echo "-----------------------"
  fi

  # Mark as FAILED in DB
  update_status "FAILED" || true

  # Upload state even on failure if state exists
  # Unset assumed role credentials and go back to using Fargate's own role
  unset AWS_ACCESS_KEY_ID
  unset AWS_SECRET_ACCESS_KEY
  unset AWS_SESSION_TOKEN
  if [ -f "/app/terraform.tfstate" ]; then
    echo "Uploading Terraform state after failure..."

    aws s3 sync /app "s3://$S3_CLUTTER_NAME/$TERRAFORM_DIRECTORY" \
      --exclude "*" \
      --include "*.tfstate" \
      --include "*.tfstate.backup" \
      --include ".terraform.lock.hcl" \
      --sse AES256 || true
  fi

  # Upload logs on failure
  upload_logs

  exit "$exit_code"
}

trap on_error ERR

# -------------------------------
# Upload logs
# -------------------------------
upload_logs() {
  LOG_S3_PATH="s3://$S3_CLUTTER_NAME/$TERRAFORM_DIRECTORY/logs/$COMMAND_ID"
  
  echo "Uploading logs to $LOG_S3_PATH ..."
  
  # Upload init.log
  if [[ -f "$INIT_LOG" ]]; then
    aws s3 cp "$INIT_LOG" "$LOG_S3_PATH/init.log" --sse AES256 || true
  fi

  # Upload command.log
  if [[ -f "$COMMAND_LOG" ]]; then
    aws s3 cp "$COMMAND_LOG" "$LOG_S3_PATH/command.log" --sse AES256 || true
  fi
}

# -------------------------------
# Update Log DB Record Status
# -------------------------------
update_status() {
  local status=$1

  END_TIME=$(date +%s)
  DURATION=$((END_TIME - TOTAL_START_TIME))

  echo "Updating deployment status to $status..."

  psql "$PSQL_CONNECTION_STRING" -v ON_ERROR_STOP=1 -c "
  UPDATE public.diagram_deployment_logs
  SET 
    status = '$status',
    duration_seconds = $DURATION
  WHERE diagram_id = '$DIAGRAM_ID'
    AND command_id = '$COMMAND_ID';
  " || echo "Warning: failed to update deployment status"
}

# -------------------------------
# Fetch Terraform code
# -------------------------------
echo "Downloading Terraform from S3."
aws s3 sync "s3://$S3_CLUTTER_NAME/$TERRAFORM_DIRECTORY" /app

# Check to see if Terraform file exists
if [ -z "$(ls -A /app/*.tf 2>/dev/null)" ]; then
  echo "ERROR: No Terraform files found in S3 path."
  false
fi

# -------------------------------
# Fetch Lambda bootstrap.zip
# -------------------------------
echo "Downloading bootstrap.zip."

aws s3 cp "s3://$S3_TEMPLATES_NAME/templates/zip/bootstrap.zip" /app/bootstrap.zip

# Verify it exists
if [ ! -f "/app/bootstrap.zip" ]; then
  echo "ERROR: Failed to download bootstrap.zip"
  false
fi

echo "bootstrap.zip downloaded successfully."

# -------------------------------
# Assume customer role
# -------------------------------
echo "Assuming customer role."

CREDS=$(aws sts assume-role \
  --role-arn "$CLIENT_ROLE_ARN" \
  --role-session-name clutter-terraform-deployer-session \
  --external-id "$ASSUME_ROLE_EXTERNAL_ID")

export AWS_ACCESS_KEY_ID=$(echo "$CREDS" | jq -r '.Credentials.AccessKeyId')
export AWS_SECRET_ACCESS_KEY=$(echo "$CREDS" | jq -r '.Credentials.SecretAccessKey')
export AWS_SESSION_TOKEN=$(echo "$CREDS" | jq -r '.Credentials.SessionToken')

INIT_LOG="/tmp/terraform-init.log"
COMMAND_LOG="/tmp/terraform-command.log"

# -------------------------------
# Run Terraform Init
# -------------------------------
echo "Initializing Terraform."
INIT_START_TIME=$(date +%s)

terraform init >"$INIT_LOG" 2>&1

INIT_END_TIME=$(date +%s)
INIT_DURATION=$((INIT_END_TIME - INIT_START_TIME))
INIT_MIN=$((INIT_DURATION / 60))
INIT_SEC=$((INIT_DURATION % 60))

echo "Terraform init time: ${INIT_MIN}m ${INIT_SEC}s"
echo "Terraform init output:"
echo "----------------------"
cat "$INIT_LOG"
echo "----------------------"

# -------------------------------
# Run Terraform Command
# -------------------------------
echo "Running Terraform Command."
COMMAND_START_TIME=$(date +%s)

if [ "$COMMAND" = "apply" ]; then
  terraform apply \
  -auto-approve \
  -var="aws_region=$AWS_REGION" >"$COMMAND_LOG" 2>&1
elif [ "$COMMAND" = "destroy" ]; then
  terraform destroy \
  -auto-approve \
  -var="aws_region=$AWS_REGION" >"$COMMAND_LOG" 2>&1
else
  echo "Invalid COMMAND: $COMMAND"
  false
fi

COMMAND_END_TIME=$(date +%s)
COMMAND_DURATION=$((COMMAND_END_TIME - COMMAND_START_TIME))
COMMAND_MIN=$((COMMAND_DURATION / 60))
COMMAND_SEC=$((COMMAND_DURATION % 60))

echo "Terraform command time: ${COMMAND_MIN}m ${COMMAND_SEC}s"
echo "Terraform command output:"
echo "-----------------------"
cat "$COMMAND_LOG"
echo "-----------------------"

# -------------------------------
# Upload Terraform state
# -------------------------------
echo "-----------------------"
echo "Uploading state back to S3..."
echo "-----------------------"
# Unset assumed role credentials and go back to using Fargate's own role
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset AWS_SESSION_TOKEN
aws s3 sync /app "s3://$S3_CLUTTER_NAME/$TERRAFORM_DIRECTORY" \
  --exclude "*" \
  --include "*.tfstate" \
  --include "*.tfstate.backup" \
  --include ".terraform.lock.hcl" \
  --sse AES256

# Upload logs on success
upload_logs

# -------------------------------
# Mark SUCCESS
# -------------------------------
update_status "SUCCESS"

echo "Terraform command complete."
