# System A: Clutter as built (exists today)

As it stands on 2026-11-04, from a read of the code and a local run of every route (`backend/devserver`). The final report (`docs/old-capstone/final-report.pdf`, same text in `.md`) describes the design as submitted; where they differ, this file and the code win. What is planned next is `system-b-adapter-layer.md`.

## Parts

- **Frontend** (`frontend/clutter`): Next.js 16 App Router, React 19, React Flow (`@xyflow/react`) for the canvas, TanStack Query for server data, Zustand for UI state, Tailwind 4. Google sign-in. Shipped as a Docker image to GHCR by CI.
- **API** (`backend/api`): Go Lambdas, one per route, behind AWS API Gateway. Shared code in `generic` (Postgres access, membership, responses, regions). Postgres (Supabase) holds users, orgs, projects, diagrams, supported resources, linked accounts, runs and jobs.
- **Platform infrastructure** (`backend/infra`): Terraform for API Gateway, the Lambdas, S3, ECR, ECS Fargate and SQS, in Clutter's own AWS account, with remote state in S3 and a DynamoDB lock (`backend/tfstate-infra` bootstraps that).
- **Runners** (`backend/infra/modules/fargate/ecr-scripts`): two container images run as Fargate tasks. `terraform-deployer` runs Terraform for a diagram; `ansible-runner` runs a playbook on the customer's EC2 instances.

## The two worlds

A is a hosted service (SaaS): one copy of Clutter, run for every user. Clutter touches two separate cloud accounts. **World 1** is Clutter's own account: the website, the API, the database and the workers. **World 2** is the user's own account, where the things they draw get built. The user owns and pays for world 2; Clutter only builds there, with access the user grants. A user's diagram is data in world 1; what it builds lives in world 2.

| | World 1: Clutter's account | World 2: the user's account |
| --- | --- | --- |
| Holds | the website, the Lambdas and API Gateway, the Fargate workers | whatever the user drew: Lambda, S3, DynamoDB, API Gateway, EC2 |
| Postgres (Supabase) | users, organizations, members, projects, diagrams and history, linked accounts, deploy logs, Ansible jobs, playbook records, the resource catalog | none from Clutter |
| S3 | templates; generated Terraform and `status.json`; Terraform state; deploy and job logs; uploaded Lambda code and playbooks | only buckets the user drew |
| Credentials | the JWT secret and the database password; for each linked AWS account, only a role ARN and an external id | the role the user created for Clutter |

How the worlds meet: the user creates a role in their account through a CloudFormation link and pastes its ARN into Clutter. At deploy, a Fargate worker in world 1 asks AWS (STS) for short-lived keys for that role, then runs Terraform, which builds in world 2. Ansible runs the same way and configures the user's EC2 servers through SSM. Clutter never stores a permanent key for world 2.

Terraform state for every user's diagram sits in world 1, in Clutter's bucket in `us-west-2`, with no lock. It lists everything in the user's account and can hold secrets (an open defect in `.claude/findings/NOW.md`).

An EC2 server is the user's, not Clutter's: Clutter creates it with Amazon Linux 2023, the chosen instance type, an SSM role and an optional SSH key, and nothing else installed. What runs on it comes from the user's own Ansible playbook. Its CPU and memory come from the instance type; its disk is the image's default, with no size option; Clutter sets no security group.

## How A runs: there is no backend server

A has no server of its own, and it never did. The capstone team built it to run only in AWS: each route is a small function (a Lambda) that AWS starts on demand, and API Gateway gives those functions their URLs. There was nothing to start on a laptop, no `go run`, and no local mode. They developed against their AWS account.

The app's code is the same everywhere. To run it on a laptop, we added stand-ins for the AWS parts around it, all in `backend/devserver`. That extension is **A2**: it is not part of A and never ships to end users. A's code does not know about it, with one exception: the **Link fake account** button, which appears only in a local development build.

| In real AWS (System A) | Stand-in on your laptop (ours) |
| --- | --- |
| API Gateway gives the functions URLs | the gateway on port 8787 |
| Lambda service runs the functions | the same Go code, run as local processes |
| Lambda authorizer checks the token | the same authorizer code |
| Google sign-in | the same Google sign-in |
| Supabase Postgres | Postgres in Docker |
| S3 holds templates, generated files and logs | a local S3, on disk in `backend/devserver/.state/s3` |
| Supabase webhook triggers generation on save | the gateway does it after each save |
| Frontend on a server, built with the API address | `npm run dev` on port 3100, behind the front door on port 3000 |
| Fargate deployer runs Terraform in the customer's account | nothing: Deploy fails locally |
| SQS and Fargate runner for Ansible | nothing: jobs stop at SQS |

## What changed since the capstone

The capstone's version is tagged `capstone-original`. This is what is different now.

| Area | Capstone delivered | Now |
| --- | --- | --- |
| Where it runs | only in AWS; that account is gone | locally with `npm run dev` (A2); dev and prod not set up yet |
| Reading generated Terraform | not in the app, only through the AWS console | **Preview Terraform** in the editor, for every user (ADR-012) |
| Generator | writes `.tf` files | also records `status.json`, and removes a stale `outputs.tf` |
| API | 31 routes | 32: adds `GET /terraform-engine/files` |
| Unlocking the canvas locally | not possible | a local-only **Link fake account** button |
| Tests before merging | none on Go | `checks.yml` on every pull request, and a smoke test of every route |
| Docs | one report, stale READMEs | one owner per fact (`docs/README.md`) |

Unchanged: every other handler, the database schema, the customer templates, and the open security defects in `.claude/findings/NOW.md`.

## The capstone's report

Dropped from the original scope, for time: inviting users to an organization with shared diagramming, and pulling an EC2 environment down to a local machine. The database moved from DynamoDB to Postgres mid-project, and the report's glossary still describes DynamoDB.

Testing in the report is manual: a Postman collection, exploratory UI testing, one real deploy and an Ansible playbook run, and informal usability sessions. It gives no counts or timings. The Go tests in the repo are not mentioned.

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
| Draw on the canvas: 5 resources, connect them, configure them (config panels come from the `supported_resources` table), save, reload | proven |
| Generate Terraform on save, with IAM from connections | proven; output passes `terraform validate` |
| Read and download generated Terraform in the editor (needs a linked account, like the canvas) | proven |
| Deploy and destroy into the customer's AWS account (Destroy is enabled only after a first deploy, per the report) | unproven |
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
- set an EC2 server's disk size, or give an EC2 server access to S3 or DynamoDB (an EC2 connection draws a line and grants nothing)
- set Lambda environment variables or tags from the UI
- preview a change (no plan step), estimate cost, import existing infrastructure, or detect drift
- undo, autosave, or show diagram history (history is written, never shown)
- invite members, set roles, or share a diagram; an organization has only its creator
- be called by another program (no API keys or service accounts)

## Inventory

- **API:** 32 routes, one Lambda each. Three have no authorizer: `POST /log-in`, `GET /resources` and `POST /terraform-engine`.
- **Lambdas:** 34 with a `main.go`, all wired in the platform Terraform: the 32 routes, the authorizer, and `ansible/run-task` (an SQS consumer).
- **Database:** 11 tables (10 in `application-tables.sql`, plus `supported_resources` in the seed) and 2 enums. `jobs` has no organization column.
- **Frontend:** login, dashboard, projects, the diagram editor and the AWS account page call the real API. Member management is a mock, `settings/organization/create-org` and the workspaces page are stubs, and `/register` posts to a dead host. No page calls `GET /ansible/jobs`, the job logs route, `/user-information` or `POST /terraform-engine`.

## The main flows

1. **Sign in.** Google ID token in, user upserted, Clutter issues an HS256 JWT (24 hours). A Lambda authorizer checks it on protected routes. The frontend's route guard only checks that a `clutter_token` cookie exists, not that it is valid; data calls still need a real JWT.
2. **Link an AWS account.** Clutter builds a CloudFormation quick-create link for a role in the customer's account (with an external id), and the customer pastes back the role ARN. The ARN is stored, not verified.
3. **Draw and generate.** `POST /terraform-engine` takes a Supabase database-webhook body. The webhook itself is configured in Supabase, outside this repo, and the frontend never calls the route; the diagram update handler does not call it either. So whether a save compiles depends on configuration this repo does not hold. The generator parses each node's label into a resource type, loads that type's `*.tf.tmpl` from S3, renders it with `text/template`, builds IAM from the diagram's edges, emits a fixed `provider "aws"` block, and writes the files to S3 under the org, project and diagram, in a `terraform/` folder, with a `status.json` recording whether that run succeeded. `GET /terraform-engine/files` reads them for the editor's Preview Terraform panel, after checking the caller belongs to that diagram's organization.
4. **Deploy.** `terraform-command-runner` starts a Fargate task with the role ARN and external id. The deployer syncs the files from S3, assumes the customer role, runs init and apply or destroy, syncs local state back to S3 (no lock), and writes status to Postgres. Logs come from S3 and CloudWatch.
5. **Configure.** A playbook is uploaded, a job is queued on SQS, a consumer starts the `ansible-runner` task, which assumes the customer role and runs the playbook through SSM Run Command.

## Where AWS is assumed

Everywhere a connector would need to reach. Behind a usable seam: the per-resource generators (`ResourceGenerator` interface) and the templates (keyed by a path prefix). Leaked into the core: the resource type constants and label switch, the emitted provider block, IAM from edges, the region list, the account-link handlers and table, the runner scripts' STS and SSM calls, the seed table (no provider column), and the frontend palette, node component and config panel. Under Option 1 (ADR-006) these stay in A; `system-b-adapter-layer.md` maps each to the connector part that replaces it if AWS later moves into B.

## Load-bearing facts

- Organization membership is a boolean (no role column).
- Run state is split: Terraform runs in `diagram_deployment_logs`, Ansible runs in `jobs`.
- The template loader and writer use a fixed S3 region (`us-west-2`), so generated code and Terraform state for every customer sit in that US region.
- Customer Terraform state is a local file synced to S3 per diagram; two concurrent runs on one diagram overwrite each other.
- The deployer task holds the Postgres connection string and a role that may assume any customer's Clutter role, guarded only by the external id.
- The schema in `backend/storage-sql` is written for Supabase: the seed creates a policy for the `anon` role, which plain Postgres does not have.

## Repositories and branches

- This clone's `origin` is `FayzanT/re-clutter`, a fork made 2026-10-19 of the client's `Alberta2514640/clutter` (remote `upstream`). Work happens in the fork, and pull requests merge it into the client's repo.
- `upstream` has 24 older branches. Every one is merged into `main` or holds an older copy of a file `main` rewrote later, with two exceptions: `dev` bumps `actions/checkout` to v6 in CI, and `database-seed` holds an abandoned DynamoDB seed script. One old PR is open (#21, conflicting).
- CI: `docker-image.yml` builds the frontend image on pushes to `main` (tag `latest`) and `dev` (tag `dev`). `checks.yml` is described in the root `CLAUDE.md` § Commands.
