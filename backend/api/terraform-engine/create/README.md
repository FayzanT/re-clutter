# Terraform Engine - Create

This Lambda function generates Terraform code from diagram data received via Supabase webhooks.

> **Checked against the code on 2026-11-04.** The Supabase webhook that calls this route is configured in Supabase, not in this repo, and nothing in the repo calls the route. The route has no authorizer, so anyone who can reach it can trigger generation. Locally, `backend/devserver` stands in for the webhook and S3, so saving a diagram runs this Lambda for real (`backend/devserver/README.md`). Corrections to the capstone text below are marked "Now:".

## Architecture Overview

```
Supabase Webhook → API Gateway → Lambda → Generate Terraform → S3 Output Bucket
                                              ↓
                                    S3 Templates Bucket
```

## How It Works

### 1. Webhook Trigger
When a diagram is created/updated in Supabase, a webhook sends a POST request with:
```json
{
  "type": "UPDATE",
  "record": {
    "id": "diagram-uuid",
    "project_id": "project-uuid",
    "data": {
      "nodes": [...],
      "edges": [...]
    }
  }
}
```

### 2. Node Processing
Each node in the diagram is parsed:
- `data.label` → Determines resource type (Lambda, S3, DynamoDB, API Gateway, EC2 Container; see `internal/generator/resources/mapper.go`)
- `variables.resource_name` → Used for Terraform resource naming and AWS resource names
- `variables.*` → Mapped to template placeholders

### 3. Template Loading
Templates are fetched from S3 and cached in memory. The bucket name below is the capstone account's. Now: the template files live in `backend/infra/modules/s3/uploads/aws/<type>/` for all five types (`apigateway`, `dynamodb`, `ec2`, `lambda`, `s3`), and the platform Terraform uploads each one with its own `aws_s3_object` in `backend/infra/modules/s3/main.tf`.

```
s3://clutter-templates-us-west-2-b35a3c5c/
└── templates/aws/
    ├── lambda/
    │   ├── main.tf.tmpl
    │   └── outputs.tf.tmpl
    └── s3/
        ├── main.tf.tmpl
        └── outputs.tf.tmpl
```

### 4. Template Rendering
Go's `text/template` package renders templates the variables passed into for each Node in the Diagram Layout:
```
{{.ResourceName}} → my_test_function
{{.FunctionName}} → my-test-function
{{.Timeout}}      → 30
```

### 5. IAM Generation
Edges between nodes generate IAM policies automatically:
- Lambda → S3 edge creates S3 read/write permissions

### 6. S3 Output
Generated Terraform is uploaded to:
```
s3://clutter-us-west-2-..../
└── {org-id}/
    └── {project-id}/
        └── {diagram-id}/
            └── terraform/
                ├── main.tf      (provider + resources + IAM)
                ├── outputs.tf   (resource outputs; deleted when a diagram has none)
                └── status.json  (whether the last run succeeded, read by the editor)
```

Now: the `terraform/` folder is what the writer really uses; the `s3_path` in the Lambda's response omits it.

Every run writes `status.json`. A failed run leaves the older `.tf` files in place and records the failure, so the editor can warn that they are out of date. Errors caused by the diagram keep their real message; infrastructure errors are stored as a fixed sentence, with the cause in the log. If an upload fails partway, the status says the files may be incomplete. A status that cannot be written is logged and does not fail the run. `GET /terraform-engine/files` (`backend/api/generic/terraformfiles`) reads all of this for the editor.

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TEMPLATE_BUCKET_NAME` | S3 bucket for templates | `clutter-templates-us-west-2-...` |
| `S3_BUCKET_NAME` | S3 bucket for output | `clutter-us-west-2-...` |
| `PSQL_CONNECTION_STRING` | Postgres connection string for org lookup | `postgres://...` |

---

## Local Testing

### Run Tests

**Full end-to-end test (generates + uploads to S3):**
```bash
cd backend/api/terraform-engine/create
go test -v -run TestHandler
```

**Generation only (no S3 upload):** Now: this test also loads templates from live S3, so both tests fail without AWS credentials.
```bash
cd backend/api/terraform-engine/create
go test -v -run TestGenerateOnly
```

### Verify S3 Output
```bash
# List generated files
aws s3 ls s3://clutter-us-west-2-b35a3c5c/test-org-123/test-project-456/test-diagram-123/

# View main.tf content
aws s3 cp s3://clutter-us-west-2-b35a3c5c/test-org-123/test-project-456/test-diagram-123/main.tf -

# View outputs.tf content
aws s3 cp s3://clutter-us-west-2-b35a3c5c/test-org-123/test-project-456/test-diagram-123/outputs.tf -
```

---

## Template Files

### Lambda Template (`backend/infra/modules/s3/uploads/aws/lambda/main.tf.tmpl`)
```hcl
resource "aws_iam_role" "{{.ResourceName}}_role" {
  name = "{{.FunctionName}}-lambda-role"
  ...
}

resource "aws_lambda_function" "{{.ResourceName}}" {
  function_name = "{{.FunctionName}}"
  handler       = "{{.Handler}}"
  timeout       = {{.Timeout}}
  runtime       = "{{.Runtime}}"
  ...
}
```

### S3 Template (`backend/infra/modules/s3/uploads/aws/s3/main.tf.tmpl`)
```hcl
resource "aws_s3_bucket" "{{.ResourceName}}" {
  bucket = "{{.BucketName}}"
}
```

### Upload Templates to S3

Now: templates are uploaded by `terraform apply` in `backend/infra` (one `aws_s3_object` per file), not by hand. The capstone command, which points at a folder and a bucket that no longer exist:

```bash
cd backend/api/terraform-engine/create
aws s3 cp templates/aws/ s3://clutter-templates-us-west-2-b35a3c5c/templates/aws/ --recursive
```

### List Templates in S3
```bash
aws s3 ls s3://clutter-templates-us-west-2-b35a3c5c/templates/aws/ --recursive
```

---

## Variable Mapping

### Lambda Node
| Diagram Variable | Template Placeholder | Default |
|-----------------|---------------------|---------|
| `resource_name` | `{{.ResourceName}}`, `{{.FunctionName}}` | Required |
| `handler` | `{{.Handler}}` | `main` |
| `timeout` | `{{.Timeout}}` | `3` |
| `runtime` | `{{.Runtime}}` | `provided.al2023` (Now: the generator's default; the seed SQL still says `provided.al2`) |
| `architecture` | `{{.Architecture}}` | `arm64` |
| `memory_size` | `{{.MemorySize}}` | `128` (Now: always 128 in practice; the config panel sends a string and the generator reads only numbers) |

### S3 Node
| Diagram Variable | Template Placeholder | Default |
|-----------------|---------------------|---------|
| `resource_name` | `{{.ResourceName}}`, `{{.BucketName}}` | Required |
| `enable_versioning` | `{{.EnableVersioning}}` | `false` |
| `block_public_access` | `{{.BlockPublicAccess}}` | `true` |

---

## Code Structure

Now: there is no local `templates/aws/` folder (see above), `resources/` holds a generator per type (`apigateway.go`, `dynamodb.go`, `ec2.go`, `lambda.go`, `s3.go`), and `data_clean.go`'s `HasDataChanged` is unused (its only call is commented out).

```
terraform-engine/create/
├── main.go                          # Lambda handler entry point
├── main_test.go                     # Test file
├── templates/aws/                   # Local template files (upload to S3)
│   ├── lambda/
│   │   ├── main.tf.tmpl
│   │   └── outputs.tf.tmpl
│   └── s3/
│       ├── main.tf.tmpl
│       └── outputs.tf.tmpl
└── internal/
    ├── structs.go                   # Data types
    ├── data_clean.go                # Node sanitization
    └── generator/
        ├── generator.go             # Main generation logic
        ├── template/
        │   ├── loader.go            # S3 template fetching + caching
        │   ├── renderer.go          # Go text/template rendering
        │   └── config.go            # Template path helpers
        ├── resources/
        │   ├── mapper.go            # Resource type → Generator mapping
        │   ├── lambda.go            # Lambda generator
        │   └── s3.go                # S3 generator
        ├── iam/
        │   └── policy.go            # IAM policy generation from edges
        └── writer/
            └── writer.go            # S3 upload with encryption
```

---

## Troubleshooting

### "NoSuchKey" Error

Template file doesn't exist in S3. Now: re-apply `backend/infra`, which uploads every template. The capstone command:

```bash
aws s3 cp templates/aws/ s3://clutter-templates-us-west-2-b35a3c5c/templates/aws/ --recursive
```
