# Environments: local, dev and prod

Clutter runs in three places, and each has one job. Only local exists today. ADR-010 records this split; the steps to deploy are in `system-a-as-built.md` § Deploying to AWS.

| | Local | Dev | Prod |
| --- | --- | --- | --- |
| **Job** | build and test on your laptop | prove it works in a real cloud, shared by the team | real customers |
| **Status** | works | not set up | not set up |
| **Who uses it** | each developer alone | the team | customers |
| **Costs money** | no | a little | yes |
| **Frontend** | `npm run dev` on port 3100 | hosted, built with dev's API address | hosted, built with prod's API address |
| **Backend** | the real Lambdas, run by `backend/devserver` | real Lambdas behind API Gateway in the dev AWS account | the same in the prod AWS account |
| **Database** | Postgres in Docker | its own Supabase project | its own Supabase project |
| **File storage (S3)** | the devserver's local S3, on disk | real S3 in the dev account | real S3 in the prod account |
| **Sign-in** | `/dev/login`, or real Google through the capstone's client id while it still works | a Google OAuth client for dev | a separate Google OAuth client for prod |
| **Generate Terraform** | runs when you save a diagram (the devserver stands in for the Supabase webhook) | a Supabase webhook on the dev project | a Supabase webhook on the prod project |
| **Deploy and Ansible** | do not run (no ECS, SQS, STS or SSM) | run on Fargate into a sandbox customer account | run on Fargate into customers' accounts |
| **Secrets live in** | `backend/devserver/.state/`, generated for you | `dev.tfvars` on the deployer's machine, never in git | a secret store, never on a laptop |
| **Terraform state** | none | a state bucket in the dev account | a state bucket in the prod account |
| **Data** | fake, wipe it any time | test data only | real customer data |

## The rules

- **Nothing is shared between environments:** no AWS account, database, Google client, secret or state bucket. A mistake in dev must be unable to touch prod.
- **Prod data never goes to dev or local.**
- **The same code runs in all three.** Environments differ only in configuration. Code that branches on the environment name is a defect; the devserver stands in for AWS from outside the Lambdas.
- **Change moves one way:** local, then pull request (with the checks), then `main`, then dev, then prod. Nothing reaches prod without passing through dev.
- **A person deploys.** No session or agent runs `terraform apply`.

## What each environment needs

**Local:** nothing beyond the install list in the root `README.md`. No env file, no accounts.

**Dev**, once phase 0 items 1 to 6 are done:

| Thing | Who gets it | Goes into |
| --- | --- | --- |
| An AWS account for Clutter (dev) | the client or the team | AWS credentials on the deployer's machine |
| A second AWS account, or the same one, as the sandbox "customer" | same | the account link in the app |
| A Supabase project (dev) | the team | `psql_connection_string` |
| A Google OAuth client (dev) | the team | the frontend, and `GOOGLE_CLIENT_ID` on the log-in Lambda |
| A hosted frontend address (dev) | the team | `frontend_url` |
| Terraform inputs | filled in from the rows above | `backend/infra/dev.tfvars`, copied from `backend/infra/terraform.tfvars.example` |
| Frontend config | the dev API address | `frontend/clutter/.env.local`, copied from `frontend/clutter/.env.example`, or the build's environment |

**Prod:** the same list again, as separate accounts and projects, plus a secret store, backups, a domain and monitoring. Decide these when dev has proved a full deploy.

## What must change before dev can exist

These are A's files, so each is a seam or a decision (ADR-006). None is done yet.

| Hard-coded today | Needed for dev and prod |
| --- | --- |
| `backend/infra/backend.tf` points at the capstone's state bucket (and is listed in `.gitignore` while tracked) | a state backend per environment, chosen at `terraform init` (`backend/infra/backend.hcl.example`) |
| The Google client id is in two frontend files | read from an environment variable |
| `frontend/Dockerfile.frontend` bakes in the capstone's API address | pass it in at build time |
| The API Gateway has no stage or deployment in Terraform | add them, so an environment has a URL without manual steps |
| The Supabase webhook is set up by hand | a written step per environment, or replaced by phase 0 item 1 |
| `GOOGLE_CLIENT_ID` is never set on the log-in Lambda | phase 0 item 4 |
| Runner images are tagged `:latest` in immutable repositories | a version tag per build |
| The generator's S3 region is fixed to `us-west-2` | use the environment's region |

## Open choices

- Where the frontend is hosted in dev and prod. The capstone used a VM with Docker Compose. Default: a small VM or container host for dev; decide prod later.
- Whether dev and prod are separate AWS accounts (default, and the safe choice) or separate stacks in one account.
