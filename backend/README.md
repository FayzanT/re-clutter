# Backend

How the backend is laid out, and how to run, test and extend it.

Setup for the whole repo is in the root `README.md`. Deploying to a new AWS account: `docs/architecture/system-a-as-built.md` § Deploying to AWS. The capstone team's original tutorial is kept in `docs/old-capstone/backend-tutorial.md`; do not run its deployment steps, which target their AWS account.

## Run and test the backend (tested 2026-10-30)

| Folder | What it is |
| --- | --- |
| `api/` | 33 Go Lambdas, one folder each (31 API routes, the authorizer, and `ansible/run-task`, an SQS consumer). Shared code in `generic/` and `ansible/shared/`. |
| `infra/` | Terraform that deploys Clutter itself into Clutter's AWS account, plus the customer templates (`modules/s3/uploads/aws/`) and the two runner images (`modules/fargate/ecr-scripts/`) |
| `storage-sql/` | the Postgres schema (`application-tables.sql`) and the resource seed (`seed-resources.sql`) |
| `tfstate-infra/` | bootstraps the S3 bucket and DynamoDB lock table for `infra/`'s own state |
| `devserver/` | dev-only: runs the real Lambdas locally behind an API Gateway stand-in (ours, not the capstone team's) |

Run from the repo root:

| Do this | Command | Result on 2026-10-30 |
| --- | --- | --- |
| Compile and vet | `go -C backend/api build ./...` and `go -C backend/api vet ./...` | pass |
| Unit tests | `go -C backend/api test ./...` | 2 packages fail, both before any change: `terraform-engine/create` (`TestHandler` and `TestGenerateOnly` need live S3) and `tests/generic` (a nil database connection panics). `tests/ansible` and `tests/user-information` pass. |
| Run every route locally | `npm run dev`, then `npm run smoke` | 0 fail; the full breakdown is in `devserver/README.md` |
| Load the schema | `npm run dev` does it | 11 tables, 5 resources |
| Validate the platform Terraform | `cp -R backend/infra "$TMPDIR/infra"`, then `terraform -chdir="$TMPDIR/infra" init -backend=false` and `terraform -chdir="$TMPDIR/infra" validate` (a copy, so `init` never touches the real state backend) | pass; `fmt -check` fails on 7 files |
| Build for AWS | `backend/api/build.sh` (all 33 Lambdas, linux/arm64 zips in each `deploy/`) | not run (nothing to deploy to) |

A's lint results, recorded and not fixed (A changes only at the seams, ADR-006):

| Linter | Result on 2026-10-30 |
| --- | --- |
| `gofmt -l backend/api` | 59 of 97 files: 52 because they use CRLF line endings (stored that way in git), 7 for a trailing blank line |
| staticcheck (`go run honnef.co/go/tools/cmd/staticcheck@2025.1.1 ./...` in `backend/api`) | 6: 4 nil contexts in `tests/generic` (the package that panics), 2 simplifications in `terraform-command-runner` |
| shellcheck (`build.sh`, `build_linux.sh`, the two runner `entrypoint.sh` and `build-and-push.sh`) | 6 warnings: unused variables, and `local x=$(...)` masking exit codes in the terraform deployer's entrypoint |
| devserver (`go -C backend/devserver vet ./...`, `test ./...`, shellcheck) | clean |

Locally, everything runs except what needs ECS or SQS: deploy, destroy, live status, and running Ansible. The list is in `devserver/README.md`.

### Adding a Lambda or a route

1. A folder under `api/` with a `main.go` that calls `lambda.Start`.
2. Add it to `api/build.sh` and `api/build_linux.sh`.
3. In `infra/main.tf`: a `lambda` module, an `api-path` module, an `api-lambda-integration` module (give it `jwt_authorizer_id` unless the route is meant to be public), the CORS module, and a request model under `modules/templates/api-models/schemas/` if it takes a body.
4. Add it to `devserver/internal/routes/routes.go`. `go -C backend/devserver test ./...` fails until the table matches `main.tf`.
5. If it takes an organization, project, diagram, run or account id: check membership and that the child belongs to the organization.
6. Run the smoke test; it must stay at 0 fail.

## Inside `api/` and `infra/`

- Each Lambda is a folder with a `main.go` (and often an `internal/` package). `build.sh` compiles each into a `bootstrap` binary for linux/arm64 and zips it into the folder's `deploy/bootstrap.zip`, which the platform Terraform uploads. Its Lambda list is kept by hand.
- `api/generic/` is the shared code: the `Response()` helper, Postgres access, the membership check (`CheckOrganizationMembershipPSQL`), the region list. `api/ansible/shared/` is shared by the Ansible Lambdas (but `ansible/run-task` holds its own copy).
- `api/terraform-engine/create/` is the generator; its internals are in its own `README.md`.
- In `infra/`: `main.tf` calls every module; `modules/` holds `api-gateway`, `fargate` (the ECS cluster, task definitions, ECR and the two runner images), `s3` (the buckets and every uploaded template) and `templates` (one `lambda`, `api-path`, `api-lambda-integration`, CORS and request-model module per route); `backend.tf` points at the remote state; `providers.tf` sets the AWS provider; `variables.tf` lists the inputs, whose values go in a `terraform.tfvars` file that holds secrets and is never committed.
- After a rebuild, `terraform apply` reports Lambdas as changed even when the code did not change: Terraform compares the zip's hash, and a new zip has a new hash.
