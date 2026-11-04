# Environments: local, dev and prod

Clutter runs in three places, and each has one job. Only local exists today. ADR-010 records this split.

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
| **Secrets live in** | `backend/devserver/.state/`, generated for you | `dev.tfvars` on the deployer's machine, never in git | a secret store, never on a laptop |
| **Terraform state** | none | a state bucket in the dev account | a state bucket in the prod account |
| **Data** | fake, wipe it any time | test data only | real customer data |

## What each feature does where

Dev and prod do not exist yet, so nothing has been tested there. Their columns say what is expected once they are set up.

| Feature | Local (tested) | Dev (expected) | Prod (expected) |
| --- | --- | --- | --- |
| Sign in | Google, through the capstone's client for now | Google, our dev client | Google, our prod client |
| Organizations, projects, diagrams | works | works | works |
| Canvas: drag, connect, configure, save | works | works | works |
| Link an AWS account | fake account only | real sandbox account | real customer account |
| Generate Terraform on save | works (A2 stands in for the webhook) | works, once the webhook is set up | works, once the webhook is set up |
| Read and download Terraform in the editor | works | works, once generation runs | works, once generation runs |
| Upload Lambda code or a playbook | stored on disk | real S3 | real S3 |
| Deploy and destroy | does not run | first real test happens here | customers |
| Live deploy status, real deploy logs | does not run | runs with deploy | runs with deploy |
| Run Ansible on a server | does not run | runs, needs a real EC2 server | customers |
| `npm run smoke`, `npm run generated` | team tools | not available | not available |

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

## Setting up a cloud environment

The capstone deployment is gone. The API host baked into `frontend/Dockerfile.frontend` (`7c1aawofvl.execute-api.us-west-2.amazonaws.com`) returns NXDOMAIN, and the platform state bucket in `backend/infra/backend.tf` belongs to the capstone AWS account, which we cannot reach.

These steps run once per cloud environment, after the changes in the next section. None of this has been done. What is missing is accounts and secrets, not tools. Every step creates real resources and costs money, so a person runs it, not a session.

1. **An AWS account for the platform.** Bootstrap remote state with `backend/tfstate-infra`, then point `backend/infra/backend.tf` at the new bucket and lock table.
2. **Postgres.** A Supabase project (or any Postgres with the `anon`, `authenticated` and `service_role` roles). Load `backend/storage-sql/application-tables.sql`, then `seed-resources.sql`. Turn on row-level security or turn off the Supabase Data API first.
3. **A Google OAuth client** for sign-in. Replace the hard-coded client id in the frontend, and add `GOOGLE_CLIENT_ID` to the log-in Lambda's environment in `backend/infra/main.tf` (today it is never set, so log-in accepts tokens minted for any app).
4. **Platform inputs** (`backend/infra/variables.tf`): `aws_region`, `jwt_secret`, `psql_connection_string`, `cloudformation_template_url`, `clutter_account_id`, `frontend_url`, `ansible_runner_image_tag`. The capstone team shared their tfvars file on Discord. It is not in the repo and must not be.
5. **Build the Lambdas** with `backend/api/build.sh` (it lists all 34). `build_linux.sh` omits two.
6. **Build and push the runner images** (`backend/infra/modules/fargate/ecr-scripts/*/build-and-push.sh`). The ECR repos are immutable, but the images are tagged `:latest`, so the second push fails.
7. **`terraform apply` in `backend/infra`.** The Terraform defines no API Gateway deployment or stage, so the API must also be published by hand.
8. **The Supabase database webhook** that calls `POST /terraform-engine` when a diagram changes. It is configured in Supabase, not in this repo. Without it, saving a diagram never generates code.
9. **The frontend** with `NEXT_PUBLIC_API_ENDPOINT` set to the new API stage URL.

Phase 0 (`.claude/findings/NOW.md`) comes before step 7 on any account reachable from the internet: today the generation endpoint needs no login.

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

## Testing A in dev

Nothing here has been run yet. A is proven when every step passes, in this order. Use a sandbox customer account, never a real one.

1. Sign in with Google, using the dev client.
2. Create an organization, a project and a diagram.
3. Link the sandbox account through the real CloudFormation link, and paste back the role ARN.
4. Draw a Lambda connected to an S3 bucket, and save.
5. Press **Preview Terraform**: the files appear, with no warning.
6. Press **Deploy**: live status runs, and the run ends in success.
7. Check the AWS console of the sandbox account: the Lambda, the bucket and the IAM policy exist.
8. Open the log files tab: the run's logs are there.
9. Upload Lambda code, deploy again, and invoke the function.
10. Run an Ansible playbook on an EC2 server from the diagram.
11. Sign in as a second user in another organization: they cannot see any of this.
12. Press **Destroy**: everything is gone from the sandbox account.

Any failure is a bug in A or in the setup; fix it and repeat from that step.

## Going to prod

Prod comes after every dev step passes and phase 0 is done. Then repeat the setup with separate accounts, add a secret store, backups, a domain and monitoring, and run the same steps with a test organization and a sandbox account.

## Open choices

- Where the frontend is hosted in dev and prod. The capstone used a VM with Docker Compose. Default: a small VM or container host for dev; decide prod later.
- Whether dev and prod are separate AWS accounts (default, and the safe choice) or separate stacks in one account.
