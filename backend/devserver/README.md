# devserver

This is **A2**: the extension that runs System A on one machine, without AWS, so the team can test what exists. It wraps A and does not change it. Development only.

It runs the real, unchanged Lambdas from `backend/api`. Each one is built for this machine and started in aws-lambda-go's RPC mode. A gateway on `127.0.0.1:8787` turns HTTP requests into API Gateway REST proxy events, the same way the platform's API Gateway does. It runs the real authorizer on protected routes and answers CORS preflights. Postgres runs in Docker, loaded from `backend/storage-sql`. S3 is a small local store on disk, so saving a diagram generates real Terraform files.

## Start and stop

`npm run dev` at the repo root starts everything, and Ctrl+C stops it (root `README.md` step 4). Behind it are the scripts here: `dev.sh`, `stop.sh`, `smoke.sh`, `generated.sh` and `link-fake-account.sh`, with shared settings in `lib.sh`, and each has an `npm run` name. `dev.sh --backend-only` starts Postgres and the gateway without the frontend and returns.

## Why the backend runs this way

Postgres runs in Docker because it is a ready-made image. The gateway and the Lambdas run directly on your machine instead, because they rebuild in seconds from the code you are editing and need only Go, and the frontend does too, because its hot reload is fastest outside a container. Nothing stops them moving into Docker later (a single `docker compose up`, with no Go or Node needed); the cost is slower rebuilds and reloads. There is no `go run` for one Lambda: each is a function with no web server of its own, and the gateway is what gives them URLs. Go edits need a restart, because the gateway builds the Lambdas once at start.

## What it needs

Nothing to configure: no `.env` file, no API keys, no accounts. `dev.sh` generates a local JWT secret and database password into `.state/` and passes every variable the Lambdas need. Real Google sign-in, ECS and SQS are the parts that need outside accounts; `docs/architecture/system-a-as-built.md` § Deploying to AWS lists them.

## If it does not start

| You see | Do this |
| --- | --- |
| `Cannot connect to the Docker daemon` | open Docker Desktop and wait until it says it is running, then run `npm run dev` again |
| `something already listens on 127.0.0.1:8787` (or 3000) | `npm run stop`, or find the process with `lsof -nP -iTCP:3000 -sTCP:LISTEN` and stop it |
| the first `npm run dev` takes a minute or two | normal: it builds the Lambdas once |
| the canvas says "AWS account required" | `npm run link-account` |
| odd data, or you changed `backend/storage-sql` | `npm run stop -- --wipe`, then `npm run dev` reloads the schema |
| a saved diagram has no files in `npm run generated` | read the `[webhook]` lines in `backend/devserver/.state/gateway.log`; a failed generation never fails the save |
| anything else | read the end of `backend/devserver/.state/gateway.log` |

## What works locally, and what only works in AWS

Checked on 2026-11-04 with `smoke.sh` (all 31 routes, 34 calls: 30 pass, 3 need AWS, 1 expected failure, 0 fail). Sign-in, saving on the canvas and generation were checked in a browser on 2026-11-04.

| Feature | Locally | Why |
| --- | --- | --- |
| Sign in | works two ways: `/dev/login`, or real Google on `/login` | Google works through the capstone team's client id, so it can stop if they delete it; `/dev/login` needs nothing. Each Google account is a separate local user, which is how to test two users. |
| Protected routes and the authorizer | work | the real authorizer runs; no token gives 401, a bad token gives 403 |
| Organizations: create, list, get, update, delete | work | Postgres only |
| AWS account link: stack URL, list, submit role ARN, delete | work | Postgres only; the CloudFormation link is built but never opened, and the ARN is never checked against AWS (it isn't in AWS either) |
| Projects and diagrams: create, list, get, update, delete | work | Postgres only; a saved diagram reads back with its nodes and edges |
| Resource palette (`GET /resources`), user information, recent activity | work | Postgres only |
| Presigned upload and download URLs (Lambda code, deploy logs, Ansible playbooks) | work, from a browser too | the URL points at the local S3, which accepts it without checking the signature and answers CORS |
| Ansible job list and job details | work, on data already in the database | reading jobs is Postgres only |
| Generate Terraform from a diagram | works, on every save | see [Generating Terraform locally](#generating-terraform-locally) |
| Deploy or destroy (`POST /terraform-command-runner`) | only in AWS | starts an ECS Fargate task; locally it leaves a `RUNNING` log row behind |
| Live deploy status (`logs/live`) | only in AWS | ECS `DescribeTasks` |
| Deploy logs (`logs`, `logs/url`) | routes work, but no logs exist | they read the local S3; only the runner writes deploy logs, and it needs AWS |
| Submit an Ansible job (`POST /ansible/jobs`) | only in AWS | the playbook checks pass in the local S3, then queueing on SQS is refused and the job is marked `FAILED` |
| Ansible job logs | route works, but no logs exist | it reads the local S3; only the runner writes job logs, and it needs AWS |
| Running Ansible on a server (`ansible/run-task`, the two runner images) | only in AWS | an SQS consumer starting Fargate tasks that use STS and SSM |

In a real browser (headless Chrome, 2026-10-30): `/dev/login` signs in, and the dashboard, projects, project and AWS account pages render real data from the local database. The diagram editor opens only after the organization has a linked AWS account. That is A's own rule, and linking a fake account locally is enough (the account page, or the smoke test's stack-URL and role-ARN calls). With one linked, the canvas renders with the 5 resources in the palette and Save, Deploy and Destroy buttons. Dropping nodes on the canvas, naming them, saving and reloading all work (checked 2026-11-04 with scripted drag events; both nodes persisted). Deploy fails at its AWS call.

Anything marked "only in AWS" stops at its first call to ECS or SQS, after its database, auth and S3 steps have run. Testing those paths needs an AWS account (or an SQS and ECS emulator, which this devserver does not include).

## Generating Terraform locally

Save a diagram in the app, or call `POST /diagram` or `PUT /diagram`. The gateway then does what the Supabase webhook does in production:

1. It waits for a successful answer from the save, so the save is never held up.
2. It reads the diagram row from Postgres and builds the body Supabase sends: `type` (`INSERT` or `UPDATE`), `table`, `schema`, `record` and `old_record`.
3. It invokes the real `terraform-engine-create` Lambda with that body.
4. It writes the result to the gateway log, in a line that starts with `[webhook]`. A failed generation is only that line: the save has already succeeded.

This is a stand-in. The real webhook is configured in Supabase, outside this repo, and nothing in the repo triggers generation in production. The stand-in exists only in the devserver. Its `old_record` takes the name and data from `diagram_history`, because the old row is gone by the time it runs.

The Lambda reads templates through the local S3, so it gets the repo's real files. The templates bucket follows the `aws_s3_object` blocks in `backend/infra/modules/s3/main.tf`, and reads each file from `backend/infra/modules/s3/uploads` on every request. A template edit therefore shows up on the next save, with no copy step. A template with no `aws_s3_object` does not exist here, the same as in production. If a block cannot be resolved to a file, the gateway does not start, and `go test` fails.

The files land in `backend/devserver/.state/s3/clutter-devserver-local/<org>/<project>/<diagram>/terraform/`, as `main.tf` and `outputs.tf`. A diagram with no nodes gets `main.tf` only.

List them with `npm run generated`, and validate one with `npm run generated -- <diagram-id>`. The first validate downloads Terraform's AWS provider (about 680 MB) and retries if the download drops. Validation runs on a scratch copy, never in the repo tree, and deletes the copy afterwards. It runs no plan and no apply. Terraform gets a clean environment and an empty home, so no AWS credentials reach it. `terraform init` is the one step that uses the network: the first run downloads the AWS and random providers from `registry.terraform.io` into `.state/terraform-plugins`, and later runs reuse them.

`npm run generated` lists what is on disk. Deleting a diagram does not delete its files, the same as in production, so a deleted diagram stays in the list until `stop.sh --wipe`.

## How sign-in works locally

Real Google sign-in works here while the capstone team's Google client still exists: the log-in Lambda runs unchanged, and it accepts the token because `GOOGLE_CLIENT_ID` is unset (an open defect in A). To work with no Google at all, use `/dev/login`. It creates a local user, `dev@clutter.localhost`. It signs a token with the same claims and algorithm as the log-in Lambda, using a secret that `dev.sh` generates. The real authorizer accepts that token.

The frontend reads its API token from `localStorage` on its own origin, and the gateway on port 8787 cannot write it. So the gateway also runs a front door on `127.0.0.1:3000`. The front door serves `/dev/login` and passes every other request to the Next dev server on port 3100. `/dev/login` sets the `clutter_token` cookie and the `google_data` localStorage entry, just as a real log-in does, then opens `/dashboard`.

## Without AWS

Every Lambda gets fake credentials, no AWS config files, and `AWS_ENDPOINT_URL` set to one local endpoint on a random loopback port. No AWS request leaves the machine. Two things do reach the internet: the log-in Lambda fetches Google's public keys to check a real Google token, and validating downloads Terraform providers.

That endpoint answers S3 itself and refuses everything else. It serves `GetObject`, `PutObject`, `HeadObject`, `ListObjectsV2` and `DeleteObject`, path-style, on the two local buckets. The data bucket is stored under `.state/s3/<bucket>/<key>`. The templates bucket is read-only. Each S3 call is logged with `[local-s3]`.

Any other call is refused with a 403: ECS, SQS, STS, CloudWatch, any other bucket, and any other S3 operation. A route that needs one of those stops there, and the smoke table marks it `NEEDS-AWS`. The gateway log names each refused call (`[no-aws]`).

## Differences from AWS

- API Gateway's request models (JSON Schema body validation) are not applied. They use regex lookaheads, which Go cannot run. A body that API Gateway would reject with 400 reaches the handler here.
- Each Lambda runs as one long-lived process, like one warm instance, and takes one request at a time, as a Lambda instance does. Parallel requests to the same Lambda queue rather than run side by side (in AWS they would start more instances). aws-lambda-go's RPC mode fails under overlapping calls, which broke the canvas before this rule; the smoke test sends 30 parallel requests to keep it fixed. A timeout or crash replaces the process.
- Lambdas are built for this machine (`go build`), not for `linux/arm64`.
- The local S3 checks no signature, expiry or permission. It accepts a request from any process on this machine, and CORS from any loopback origin.
- The local S3 does not keep an object's content type: it guesses from the file extension. It has no versions, no encryption and no multipart upload.
- Keys are paths on disk, so the local S3 refuses a key with an empty, `.` or `..` segment, and a key that is also a folder of other keys. S3 allows these.

## Guard rails

One devserver runs per machine: its ports (3000, 8787, 54329) and its Docker database are fixed, so two clones on one laptop share them. Separate laptops never collide; each generates its own secrets.

The gateway binds to loopback only. It refuses a JWT secret that `dev.sh` did not generate (prefix `devserver-local-`). It refuses a Postgres that is not on loopback. Secrets, binaries, logs and the local S3 files live in `.state/`, which git ignores.

`go test ./...` here checks the route table, CORS methods, timeouts and environment keys against `backend/infra/main.tf`, and every `aws_s3_object` against `backend/infra/modules/s3`. It fails when they drift.
