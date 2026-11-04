# System A: Clutter as built (exists today)

As it stands on 2026-10-30, from a read of the code and a local run of every route (`backend/devserver`). The final report (`docs/old-capstone/final-report.pdf`, same text in `.md`) describes the design as submitted; where they differ, this file and the code win. What is planned next is `system-b-adapter-layer.md`.

## Parts

- **Frontend** (`frontend/clutter`): Next.js 16 App Router, React 19, React Flow (`@xyflow/react`) for the canvas, TanStack Query for server data, Zustand for UI state, Tailwind 4. Google sign-in. Shipped as a Docker image to GHCR by CI.
- **API** (`backend/api`): Go Lambdas, one per route, behind AWS API Gateway. Shared code in `generic` (Postgres access, membership, responses, regions). Postgres (Supabase) holds users, orgs, projects, diagrams, supported resources, linked accounts, runs and jobs.
- **Platform infrastructure** (`backend/infra`): Terraform for API Gateway, the Lambdas, S3, ECR, ECS Fargate and SQS, in Clutter's own AWS account, with remote state in S3 and a DynamoDB lock (`backend/tfstate-infra` bootstraps that).
- **Runners** (`backend/infra/modules/fargate/ecr-scripts`): two container images run as Fargate tasks. `terraform-deployer` runs Terraform for a diagram; `ansible-runner` runs a playbook on the customer's EC2 instances.

## How A runs: there is no backend server

A has no server of its own, and it never did. The capstone team built it to run only in AWS: each route is a small function (a Lambda) that AWS starts on demand, and API Gateway gives those functions their URLs. There was nothing to start on a laptop, no `go run`, and no local mode. They developed against their AWS account.

The app's code is the same everywhere. To run it on a laptop, we added stand-ins for the AWS parts around it, all in `backend/devserver`. It is dev tooling, not part of A: it never ships, and A's code does not know it exists.

| In real AWS (System A) | Stand-in on your laptop (ours) |
| --- | --- |
| API Gateway gives the functions URLs | the gateway on port 8787 |
| Lambda service runs the functions | the same Go code, run as local processes |
| Lambda authorizer checks the token | the same authorizer code |
| Google sign-in | Google sign-in, or `/dev/login` |
| Supabase Postgres | Postgres in Docker |
| S3 holds templates, generated files and logs | a local S3, on disk in `backend/devserver/.state/s3` |
| Supabase webhook triggers generation on save | the gateway does it after each save |
| Frontend on a server, built with the API address | `npm run dev` on port 3100, behind the front door on port 3000 |
| AWS console, to read generated Terraform (A has no screen for it) | files on disk, and `npm run generated` |
| Fargate deployer runs Terraform in the customer's account | nothing: Deploy fails locally |
| SQS and Fargate runner for Ansible | nothing: jobs stop at SQS |

## What was delivered

From the final report, checked against the code where noted.

- **Sign-in:** Google ID token in, user upserted, Clutter issues an HS256 JWT (24 hours). There are no invites, roles, refresh or service credentials.
- **Organizations, projects, diagrams:** full CRUD. Every diagram save writes a snapshot to `diagram_history`, which no route exposes. Saving is manual, with no undo or redo.
- **AWS account link:** a CloudFormation quick-create link with an external id, then the customer pastes back the role ARN.
- **Canvas:** a palette of five AWS resources (Lambda, EC2, DynamoDB, S3, API Gateway). Config panels are driven by the `supported_resources` table, with hints for missing fields. The toolbar has save, deploy and destroy; destroy is enabled only after a first deploy. Edges between resources generate IAM policies.
- **Deploy and destroy** through the Terraform deployer. The report's evidence is one Lambda (`test242`) applied and destroyed in a test account.
- **Ansible:** upload a playbook, paste an EC2 instance id, and a job runs over SSM. Deployed instances are not linked to jobs automatically.
- **Logs:** polled about every 10 seconds, saved to S3, and listed in a log files tab.
- **Lambda code upload** as a zip to S3.

Dropped from the original scope, for time: inviting users to an organization with shared diagramming, and pulling an EC2 environment down to a local machine. The database moved from DynamoDB to Postgres mid-project, and the report's glossary still describes DynamoDB.

Testing in the report is manual: a Postman collection, exploratory UI testing, one real deploy and an Ansible playbook run, and informal usability sessions. It gives no counts or timings. The Go tests in the repo (below) are not mentioned.

The report makes claims the code does not support:

| Report says | The code |
| --- | --- |
| Every endpoint requires a JWT | `POST /terraform-engine` and `GET /resources` have no authorizer |
| Supabase row-level security keeps each user's data separate | only `supported_resources` enables it, with a policy that gives the public `anon` role every command; the other ten tables have none |
| Least-privilege roles | the customer role grants `ec2:*`, `s3:*`, `iam:*`, `ssm:*` and more |
| A new resource needs only a new template in S3 | a resource lives in five places that must agree (`add-cloud-resource`) |
| Generation runs when the user deploys (one passage) or on every save (another) | on a Supabase webhook configured outside the repo; neither the frontend nor the diagram handlers call it |
| No CI | CI builds and pushes the frontend image |

## What A can and cannot do

Status: **proven** means we ran it locally (2026-11-04). **Unproven** means the code exists but needs AWS, so only the capstone team has run it, and their evidence is one Lambda and one playbook.

| Ability | Status |
| --- | --- |
| Sign in with Google; a user can have many organizations and projects | proven |
| Create, rename and delete organizations, projects and diagrams | proven |
| Link an AWS account (CloudFormation link, then paste the role ARN) | proven locally as far as the database; the ARN is never checked |
| Draw on the canvas: 5 resources, connect them, configure them, save, reload | proven |
| Generate Terraform on save, with IAM from connections | proven; output passes `terraform validate` |
| Deploy and destroy into the customer's AWS account | unproven |
| Live deploy status | unproven |
| Deploy logs saved and listed | listing proven, real logs unproven |
| Upload Lambda code | upload link proven; Node uploads fail on a runtime mismatch |
| Run an Ansible playbook on an EC2 instance | unproven; the instance id is pasted by hand |

Resources and the options each offers:

| Resource | Options | Creates |
| --- | --- | --- |
| Lambda | name, handler, timeout, runtime, architecture, memory (ignored, always 128) | function and its IAM role |
| S3 | name, versioning, block public access | bucket and access block |
| DynamoDB | name, billing mode, hash key and type, TTL | table (no sort key) |
| API Gateway | name, description, stage, CORS, HTTP methods | REST API, methods, deployment and stage |
| EC2 Container | name, instance type, key name | instance and an SSM role |

Connections: the canvas refuses anything into API Gateway, anything out of S3 or DynamoDB, and a node to itself. Only three connections do anything: Lambda to DynamoDB, Lambda to S3 (read and write permissions) and API Gateway to Lambda (invoke). Any other allowed connection, such as Lambda to EC2, draws a line and generates nothing, with no warning.

A cannot:

- deploy anywhere but AWS, or to any region but `us-west-2`
- create networking (VPCs, subnets, security groups), databases such as RDS, queues, load balancers, DNS, or any resource beyond the five
- set Lambda environment variables or tags from the UI
- preview a change (no plan step), estimate cost, import existing infrastructure, or detect drift
- undo, autosave, or show diagram history (history is written, never shown)
- invite members, set roles, or share a diagram; an organization has only its creator
- be called by another program (no API keys or service accounts)

## Inventory

From a read of the code on 2026-10-30.

- **API:** 31 routes, one Lambda each. Three have no authorizer: `POST /log-in`, `GET /resources` and `POST /terraform-engine`.
- **Lambdas:** 33 with a `main.go`, all wired in the platform Terraform: the 31 routes, the authorizer, and `ansible/run-task` (an SQS consumer).
- **Canvas resources:** Lambda, DynamoDB, S3, API Gateway and EC2 exist in all five places (generator, template, S3 upload, seed, palette and config panel), with drifting defaults and option lists.
- **Database:** 11 tables (10 in `application-tables.sql`, plus `supported_resources` in the seed) and 2 enums. `jobs` has no organization column.
- **Frontend:** login, dashboard, projects, the diagram editor and the AWS account page call the real API. Member management is a mock, `settings/organization/create-org` and the workspaces page are stubs, and `/register` posts to a dead host. No page calls `GET /ansible/jobs`, the job logs route, `/user-information` or `POST /terraform-engine`.
- **Deploy region:** no deploy sends a region, so every deploy runs in `us-west-2`.

## The main flows

1. **Sign in.** Google ID token in, user upserted, Clutter issues an HS256 JWT (24 hours). A Lambda authorizer checks it on protected routes. The frontend's route guard only checks that a `clutter_token` cookie exists, not that it is valid; data calls still need a real JWT.
2. **Link an AWS account.** Clutter builds a CloudFormation quick-create link for a role in the customer's account (with an external id), and the customer pastes back the role ARN. The ARN is stored, not verified.
3. **Draw and generate.** `POST /terraform-engine` takes a Supabase database-webhook body. The webhook itself is configured in Supabase, outside this repo, and the frontend never calls the route; the diagram update handler does not call it either. So whether a save compiles depends on configuration this repo does not hold. The generator parses each node's label into a resource type, loads that type's `*.tf.tmpl` from S3, renders it with `text/template`, builds IAM from the diagram's edges, emits a fixed `provider "aws"` block, and writes the files to S3 under the org, project and diagram, in a `terraform/` folder.
4. **Deploy.** `terraform-command-runner` starts a Fargate task with the role ARN and external id. The deployer syncs the files from S3, assumes the customer role, runs init and apply or destroy, syncs local state back to S3 (no lock), and writes status to Postgres. Logs come from S3 and CloudWatch.
5. **Configure.** A playbook is uploaded, a job is queued on SQS, a consumer starts the `ansible-runner` task, which assumes the customer role and runs the playbook through SSM Run Command.

## Where AWS is assumed

Everywhere a connector would need to reach. Behind a usable seam: the per-resource generators (`ResourceGenerator` interface) and the templates (keyed by a path prefix). Leaked into the core: the resource type constants and label switch, the emitted provider block, IAM from edges, the region list, the account-link handlers and table, the runner scripts' STS and SSM calls, the seed table (no provider column), and the frontend palette, node component and config panel. Under Option 1 (ADR-006) these stay in A; `system-b-adapter-layer.md` maps each to the connector part that replaces it if AWS later moves into B.

## Load-bearing facts

- The platform Terraform defines the API Gateway methods but no deployment or stage, so publishing the API happens outside this repo.
- Organization membership is a boolean (no role column). The frontend's member management is an in-memory mock (`MOCK_MEMBERS`); no invite route exists.
- Run state is split: Terraform runs in `diagram_deployment_logs`, Ansible runs in `jobs`.
- Templates are fetched from S3 at run time; the platform Terraform uploads each file individually.
- The template loader and writer use a fixed S3 region (`us-west-2`), so generated code and Terraform state for every customer sit in that US region.
- Customer Terraform state is a local file synced to S3 per diagram; two concurrent runs on one diagram overwrite each other.
- The deployer task holds the Postgres connection string and a role that may assume any customer's Clutter role, guarded only by the external id.
- The schema in `backend/storage-sql` is written for Supabase: the seed creates a policy for the `anon` role, which plain Postgres does not have.

## Repositories and branches

- This clone's `origin` is `FayzanT/re-clutter`, a fork made 2026-10-19 of the client's `Alberta2514640/clutter` (remote `upstream`). Both `main` branches are at the same commit.
- `upstream` has 24 branches. Every one is merged into `main` or holds an older copy of a file `main` rewrote later, with two exceptions: `dev` bumps `actions/checkout` to v6 in CI, and `database-seed` holds an abandoned DynamoDB seed script. One PR is open (#21, conflicting, from 2025-12).
- CI (`.github/workflows/docker-image.yml`) builds the frontend image on pushes to `main` (tag `latest`) and `dev` (tag `dev`). Nothing else is checked on push.

## Deploying to AWS

Each fact about running Clutter has one owner; this section keeps only the AWS deployment.

| Question | Owner |
| --- | --- |
| What to install, and the setup sequence for a new person | root `README.md` § Set up |
| Running A locally; what works locally and what only works in AWS | `backend/devserver/README.md` |
| Backend checks, their results, and A's Go and shell lint results | `backend/README.md` |
| Frontend run variants, checks, browser results and lint results | `frontend/clutter/README.md` |
| Repo-wide checks (hooks, markdownlint) and the commands agents run | root `CLAUDE.md` § Commands |

### Why AWS-only features do not run today

The capstone deployment is gone. The API host baked into `frontend/Dockerfile.frontend` (`7c1aawofvl.execute-api.us-west-2.amazonaws.com`) returns NXDOMAIN, and the platform state bucket in `backend/infra/backend.tf` belongs to the capstone AWS account, which we cannot reach.

### Running the whole stack (needs our own accounts)

What differs per environment, and what each needs, is in `environments.md`; these steps run once per cloud environment. None of this has been done. What is missing is accounts and secrets, not tools. Every step creates real resources and costs money, so a person runs it, not a session.

1. **An AWS account for the platform.** Bootstrap remote state with `backend/tfstate-infra`, then point `backend/infra/backend.tf` at the new bucket and lock table.
2. **Postgres.** A Supabase project (or any Postgres with the `anon`, `authenticated` and `service_role` roles). Load `backend/storage-sql/application-tables.sql`, then `seed-resources.sql`. Turn on row-level security or turn off the Supabase Data API first.
3. **A Google OAuth client** for sign-in. Replace the hard-coded client id in the frontend, and add `GOOGLE_CLIENT_ID` to the log-in Lambda's environment in `backend/infra/main.tf` (today it is never set, so log-in accepts tokens minted for any app).
4. **Platform inputs** (`backend/infra/variables.tf`): `aws_region`, `jwt_secret`, `psql_connection_string`, `cloudformation_template_url`, `clutter_account_id`, `frontend_url`, `ansible_runner_image_tag`. The capstone team shared their tfvars file on Discord. It is not in the repo and must not be.
5. **Build the Lambdas** with `backend/api/build.sh` (it lists all 33). `build_linux.sh` omits two.
6. **Build and push the runner images** (`backend/infra/modules/fargate/ecr-scripts/*/build-and-push.sh`). The ECR repos are immutable, but the images are tagged `:latest`, so the second push fails.
7. **`terraform apply` in `backend/infra`.** The Terraform defines no API Gateway deployment or stage, so the API must also be published by hand.
8. **The Supabase database webhook** that calls `POST /terraform-engine` when a diagram changes. It is configured in Supabase, not in this repo. Without it, saving a diagram never generates code.
9. **The frontend** with `NEXT_PUBLIC_API_ENDPOINT` set to the new API stage URL.

Phase 0 of `system-b-adapter-layer.md` should come before step 7 on any account reachable from the internet: today the generation endpoint needs no login.

### Do not run

The list is in the root `README.md` § Do not run.
