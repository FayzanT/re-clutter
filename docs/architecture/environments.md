# Environments: local and cloud

Clutter runs in two places, and each has one job (ADR-015). Only local exists today. A separate test environment is added when real outside users arrive; the deploy command already takes the environment as a parameter.

| | Local | Cloud |
| --- | --- | --- |
| **Job** | build and test on your laptop | the hosted product: demos now, real users later |
| **Status** | works | not set up |
| **Who uses it** | each developer alone | the team, the client, and later users |
| **Costs money** | no | yes |
| **Frontend** | `npm run dev` on port 3100, opened through A2's front door on port 3000 | hosted, built with the cloud API's address |
| **Backend** | the real Lambdas, run by `backend/devserver` | real Lambdas behind API Gateway, and B's container on Fargate, in the client's AWS account in `ca-central-1` |
| **Database** | Postgres in Docker | a Supabase project |
| **File storage (S3)** | the devserver's local S3, on disk | real S3 |
| **Secrets live in** | `backend/devserver/.state/`, generated for you | `prod.tfvars` on the deployer's machine, never in git; users' cloud credentials in AWS Secrets Manager (ADR-016) |
| **Terraform state (platform)** | none | a state bucket in the client's account |
| **Where diagrams deploy (world 2)** | a fake AWS account; DevStack for OpenStack | our test AWS account and a DevStack VM for demos, then real users' own accounts |
| **Data** | fake, wipe it any time | test data until real users arrive |

## What each feature does where

The cloud does not exist yet, so nothing has been tested there. Its column says what is expected once it is set up.

| Feature | Local (tested) | Cloud (expected) |
| --- | --- | --- |
| Sign in | Google, through the capstone's client for now | Google, the client's own client |
| Organizations, projects, diagrams | works | works |
| Canvas: drag, connect, configure, save | works | works |
| Link an AWS account | fake account only | our test account, then real users' accounts |
| Generate Terraform on save | works (A2 stands in for the webhook) | works, once phase 0 item 1's save-then-generate step replaces the webhook |
| Read and download Terraform in the editor | works | works, once generation runs |
| Upload Lambda code or a playbook | stored on disk | real S3 |
| Deploy and destroy | does not run | the first real test happens here |
| Live deploy status, real deploy logs | does not run | runs with deploy |
| Run Ansible on a server | does not run | runs, needs a real EC2 server |
| `npm run smoke`, `npm run generated` | team tools | not available |

## The rules

- **Local and cloud share nothing:** no database, Google client, secret or state bucket.
- **Cloud data never goes to a laptop.**
- **The same code runs in both.** Only configuration differs. Code that branches on the environment name is a defect; the devserver stands in for AWS from outside the Lambdas.
- **Change moves one way:** local, then pull request (with the checks), then `main`, then the cloud. The cloud is deployed only from a clean `main`.
- **A person deploys.** No session or agent runs `terraform apply`.

## What each environment needs

**Local:** nothing beyond the install list in the root `README.md`. No env file, no accounts.

**Cloud.** Clutter in the cloud is a hosted service (SaaS): one copy, run for everyone. The accounts that run Clutter itself (world 1, `system-b-adapter-layer.md` § Names) belong to the client, who owns the product and pays for running it, and the team gets access to deploy. Users bring a Google sign-in and their own cloud accounts (world 2), which they pay for. Set up once stages 1 to 6 are done (`implementation-plan.md`):

| Thing | Owned by | Goes into |
| --- | --- | --- |
| An AWS account for Clutter, region `ca-central-1` | the client; the team gets access through its own user logins | AWS credentials on the deployer's machine |
| A Supabase project | the client; the team sets it up | `psql_connection_string` |
| A Google OAuth client | the client; the team sets it up | the frontend, and `GOOGLE_CLIENT_ID` on the log-in Lambda |
| A domain and DNS access | the client | `frontend_url`, and the Google client's allowed address |
| Where the frontend is hosted | the client decides; default an AWS service in the same account | `frontend_url` |
| Terraform inputs | filled in from the rows above | `backend/infra/prod.tfvars`, copied from `backend/infra/terraform.tfvars.example` |
| Frontend config | the cloud API's address | `frontend/clutter/.env.local`, copied from `frontend/clutter/.env.example`, or the build's environment |

**Test accounts for world 2** (where diagrams deploy during testing and demos):

| Thing | Owned by | Why |
| --- | --- | --- |
| A second AWS account, acting as a user | the client or the team; easiest as a second account in the same AWS organization | proves a real cross-account deploy, as a user's account would be |
| An OpenStack | the team | locally DevStack on a laptop; for the cloud, a DevStack virtual machine in the test account, switched on only for demos, until Patrii opens |
| A DigitalOcean account (optional) | the team | the second General connector (`general-digitalocean`) |

## Setting up the cloud

The capstone deployment is gone. The API host baked into `frontend/Dockerfile.frontend` (`7c1aawofvl.execute-api.us-west-2.amazonaws.com`) returns NXDOMAIN, and the platform state bucket in `backend/infra/backend.tf` belongs to the capstone AWS account, which we cannot reach.

`npm run deploy:plan -- prod` shows what would change, and `npm run deploy -- prod` applies it. They stop on missing or example config, on the wrong AWS account, and on anything but a clean `main`; they ask you to type `prod` before applying, and there is no tear-down command for it. The command also accepts `dev`, which is unused until a test environment exists. They have not been run against real AWS yet; `backend/infra/test-deploy.sh` tests only their checks.

These steps run once, after stage 1 has made the changes in the next section; each step says what it looks like then, and what stands in the way today. None of this has been done. What is missing is accounts and secrets, not tools. Every step creates real resources and costs money, so a person runs it, not a session.

1. **An AWS account for the platform.** Bootstrap remote state with `backend/tfstate-infra`, then name the new bucket and lock table in `prod.backend.hcl`, which `terraform init` reads (today `backend/infra/backend.tf` hard-codes the capstone's bucket).
2. **Postgres.** A Supabase project (or any Postgres with the `anon`, `authenticated` and `service_role` roles). Load `backend/storage-sql/application-tables.sql`, then `seed-resources.sql`. Turn on row-level security or turn off the Supabase Data API first.
3. **A Google OAuth client** for sign-in, with the site's address allowed. Its id goes into the platform inputs and the frontend's configuration (today it is hard-coded in two frontend files, and `GOOGLE_CLIENT_ID` is never set, so log-in accepts tokens minted for any app).
4. **Platform inputs** (`backend/infra/variables.tf`): `aws_region` (`ca-central-1`), `jwt_secret`, `psql_connection_string`, `cloudformation_template_url`, `clutter_account_id`, `frontend_url`, `ansible_runner_image_tag`. The capstone team shared their tfvars file on Discord. It is not in the repo and must not be.
5. **Build the Lambdas** with `backend/api/build.sh` (it lists all 34). `build_linux.sh` omits two.
6. **Build and push the runner images** (`backend/infra/modules/fargate/ecr-scripts/*/build-and-push.sh`). They are tagged by version (today they are tagged `:latest` in immutable ECR repos, so the second push fails).
7. **`npm run deploy -- prod`**, which also builds the Lambdas (step 5) and publishes the API through the stage and deployment the platform Terraform defines (today it defines none, so the API would have to be published by hand).
8. **No Supabase webhook.** Saving a diagram generates code through stage 1's authenticated save-then-generate step (phase 0 item 1). Today generation runs only when a Supabase database webhook, configured in Supabase and not in this repo, calls `POST /terraform-engine`.
9. **The frontend,** built with `NEXT_PUBLIC_API_ENDPOINT` set to the new API's address (today `frontend/Dockerfile.frontend` bakes in the capstone's address).
10. **B's container,** once B exists: on Fargate in the same account, with its Secrets Manager access.

Stage 1 (phase 0 in `.claude/findings/NOW.md`) must be done before step 7 on any account reachable from the internet: today the generation endpoint needs no login.

## What must change before the cloud can exist

These are A's files, so each is a seam or a decision (ADR-006). Stage 1 makes them (`implementation-plan.md` § Stage 1). None is done yet.

| Hard-coded today | Needed for the cloud |
| --- | --- |
| `backend/infra/backend.tf` points at the capstone's state bucket (and is listed in `.gitignore` while tracked) | a state backend chosen at `terraform init` (`backend/infra/backend.hcl.example`) |
| The Google client id is in two frontend files | read from an environment variable |
| `frontend/Dockerfile.frontend` bakes in the capstone's API address | pass it in at build time |
| The API Gateway has no stage or deployment in Terraform | add them, so the environment has a URL without manual steps |
| The Supabase webhook is set up by hand | replaced by phase 0 item 1's save-then-generate step (stage 1) |
| `GOOGLE_CLIENT_ID` is never set on the log-in Lambda | phase 0 item 4 |
| Runner images are tagged `:latest` in immutable repositories | a version tag per build |
| The generator's S3 region, and the platform's region defaults, are fixed to `us-west-2` | use the environment's region (`ca-central-1`) |

## Testing A in the cloud

Nothing here has been run yet. A is proven when every step passes, in this order. Use the test AWS account, never a real user's.

1. Sign in with Google, using the client's Google client.
2. Create an organization, a project and a diagram.
3. Link the test account through the real CloudFormation link, and paste back the role ARN.
4. Draw a Lambda connected to an S3 bucket, and save.
5. Press **Preview Terraform**: the files appear, with no warning.
6. Press **Deploy**: live status runs, and the run ends in success.
7. Check the AWS console of the test account: the Lambda, the bucket and the IAM policy exist.
8. Open the log files tab: the run's logs are there.
9. Upload Lambda code, deploy again, and invoke the function.
10. Run an Ansible playbook on an EC2 server from the diagram.
11. Sign in as a second user in another organization: they cannot see any of this.
12. Press **Destroy**: everything is gone from the test account.

Any failure is a bug in A or in the setup; fix it and repeat from that step. B's own end-to-end check is the demo in `system-b-adapter-layer.md` § What the user sees.

## Before real users

Before outside users arrive: add a separate test environment, backups for Postgres and Terraform state, monitoring and alerts, and the items under "Not planned yet" in `.claude/findings/NOW.md`.
