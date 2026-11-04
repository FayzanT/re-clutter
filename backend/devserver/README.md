# devserver

Runs System A on one machine, without AWS, so the team can check what exists. Development only.

It runs the real, unchanged Lambdas from `backend/api`. Each one is built for this machine and started in aws-lambda-go's RPC mode. A gateway on `127.0.0.1:8787` turns HTTP requests into API Gateway REST proxy events, the same way the platform's API Gateway does. It runs the real authorizer on protected routes and answers CORS preflights. Postgres runs in Docker, loaded from `backend/storage-sql`.

## Start and stop

```sh
backend/devserver/run.sh      # Postgres, then the Lambdas and the gateway
NEXT_PUBLIC_API_ENDPOINT=http://localhost:8787 npm --prefix frontend/clutter run dev -- --hostname 127.0.0.1 --port 3100
open http://localhost:3000/dev/login
backend/devserver/link-fake-account.sh   # unlocks the diagram editor: links a fake AWS account to each of the dev user's organizations
backend/devserver/smoke.sh    # all 31 routes, one row per call
backend/devserver/stop.sh     # add --wipe to delete the database
```

You need Go, Docker (running), Node with npm (run `npm ci` in `frontend/clutter` once), openssl, curl, and python3 for `link-fake-account.sh`.

## Preview Terraform without AWS

Save a diagram with configured resource names, then click **Preview Terraform**
in the editor toolbar. Choose `main.tf` or `outputs.tf` to inspect it, or download
either file. The button is enabled only when the diagram is saved. It is shown
by the development frontend when its API endpoint is `http://localhost:8787`
or another loopback HTTP endpoint. It is absent from production builds.

The dev-only `GET /dev/terraform-preview?projectId=...&diagramId=...` authenticates
the caller with the real authorizer and checks the diagram's project and the
caller's organization membership before reading the saved layout. It invokes
the local generator built by `run.sh`, using the checked-in templates in
`backend/infra/modules/s3/uploads`. It returns files to the browser without
calling AWS, writing to S3, changing the diagram, or running Terraform. A fake
linked account is sufficient to unlock A's editor; preview itself needs no role
or account credentials.

These files use the existing AWS templates and defaults, not a simulated cloud
deployment. The AWS region variable and any Lambda code packages are separate
deployment inputs. Unsupported resources, invalid names, duplicate names, empty
diagrams and template failures produce an error instead of partial files.
Resource names must start with a lowercase letter and contain at most 63
lowercase letters, digits, underscores or hyphens. Restart with `stop.sh` and
`run.sh` after pulling this feature so the preview CLI and route are available.

Checked on 2026-11-04: offline tests render all five resources and cover invalid
names, missing templates, empty layouts, and HCL escaping. A live saved S3
diagram returned both files without a linked account; an unauthenticated request
returned 401. The existing smoke test still reports 0 fail. Terraform validation
and cloud deployment were not run.

## Sample diagram for movement testing

With the backend running, run `python3 backend/devserver/seed-diagram.py` from
the repo root. It creates a new playground organization, a fake linked account,
a project, and a diagram with five nodes and four connections. It prints the
diagram URL after reading back and verifying the saved layout. Existing data is
kept; each run creates a separate playground. No AWS calls are made.

Sign in through `/dev/login`, open the printed URL, drag nodes, click Save, and
refresh to check that their positions persist. You can also test pan, zoom,
connections, and deletion. The frontend must be running on port 3100.

## If it does not start

| You see | Do this |
| --- | --- |
| `Cannot connect to the Docker daemon` | open Docker Desktop and wait until it says it is running, then run `run.sh` again |
| `something already listens on 127.0.0.1:8787` (or 3000) | `stop.sh`, or find the process with `lsof -nP -iTCP:3000 -sTCP:LISTEN` and stop it |
| `The devserver is already running` | `stop.sh`, then `run.sh` |
| the first `run.sh` takes a minute or two | normal: it builds all 33 Lambdas once |
| the canvas says "AWS account required" | `link-fake-account.sh` |
| the dashboard is empty after `/dev/login` | normal on a new database: create an organization at `http://localhost:3000/onboarding/create-org` |
| odd data, or you changed `backend/storage-sql` | `stop.sh --wipe`, then `run.sh` reloads the schema |
| anything else | read the end of `backend/devserver/.state/gateway.log` |

## What works locally, and what only works in AWS

Checked on 2026-10-30 with `smoke.sh` (all 31 routes, 34 calls: 27 pass, 6 need AWS, 1 expected failure, 0 fail) and by signing in through the frontend.

| Feature | Locally | Why |
| --- | --- | --- |
| Sign in | works through `/dev/login` only | real Google sign-in (`POST /log-in`) needs a Google ID token |
| Protected routes and the authorizer | work | the real authorizer runs; no token gives 401, a bad token gives 403 |
| Organizations: create, list, get, update, delete | work | Postgres only |
| AWS account link: stack URL, list, submit role ARN, delete | work | Postgres only; the CloudFormation link is built but never opened, and the ARN is never checked against AWS (it isn't in AWS either) |
| Projects and diagrams: create, list, get, update, delete | work | Postgres only; a saved diagram reads back with its nodes and edges |
| Resource palette (`GET /resources`), user information, recent activity | work | Postgres only |
| Presigned upload and download URLs (Lambda code, deploy logs, Ansible playbooks) | URLs are created, uploads go nowhere | presigning is local maths; the URL points at the local no-AWS endpoint |
| Ansible job list and job details | work, on data already in the database | reading jobs is Postgres only |
| Generate Terraform from a diagram (`POST /terraform-engine`) | only in AWS | loads templates from S3 and writes the generated files to S3 |
| Preview and download Terraform (`GET /dev/terraform-preview`, devserver only) | works | authenticates and reads the saved diagram, then renders disk templates without AWS |
| Deploy or destroy (`POST /terraform-command-runner`) | only in AWS | starts an ECS Fargate task; locally it leaves a `RUNNING` log row behind |
| Live deploy status (`logs/live`) | only in AWS | ECS `DescribeTasks` |
| Deploy logs (`logs`) | only in AWS | read from S3 |
| Submit an Ansible job (`POST /ansible/jobs`) | only in AWS | checks the playbook in S3, then queues on SQS |
| Ansible job logs | only in AWS | read from S3 |
| Running Ansible on a server (`ansible/run-task`, the two runner images) | only in AWS | an SQS consumer starting Fargate tasks that use STS and SSM |

In a real browser (headless Chrome, 2026-10-30): `/dev/login` signs in, and the dashboard, projects, project and AWS account pages render real data from the local database. The diagram editor opens only after the organization has a linked AWS account. That is A's own rule, and linking a fake account locally is enough (the account page, or the smoke test's stack-URL and role-ARN calls). With one linked, the canvas renders with the 5 resources in the palette and Save, Deploy and Destroy buttons. Dragging a node onto the canvas and saving was not checked by script (an automated drag timed out); try it by hand. Deploy will fail at its AWS call.

Anything marked "only in AWS" stops at its first AWS call, after its database and auth steps have run. Testing those paths needs an AWS account (or an S3, SQS and ECS emulator, which this devserver does not include).

## How sign-in works locally

Google sign-in cannot work here. `/dev/login` creates a local user, `dev@clutter.localhost`. It signs a token with the same claims and algorithm as the log-in Lambda, using a secret that `run.sh` generates. The real authorizer accepts that token.

The frontend reads its API token from `localStorage` on its own origin, and the gateway on port 8787 cannot write it. So the gateway also runs a front door on `127.0.0.1:3000`. The front door serves `/dev/login` and passes every other request to the Next dev server on port 3100. `/dev/login` sets the `clutter_token` cookie and the `google_data` localStorage entry, just as a real log-in does, then opens `/dashboard`.

## Without AWS

Every Lambda gets fake credentials, no AWS config files, and `AWS_ENDPOINT_URL` set to a local endpoint that refuses every call. No request leaves the machine. A route that needs S3, ECS or SQS runs its database and auth steps, then stops at its first AWS call. The smoke table marks that `NEEDS-AWS`. The gateway log names each refused call (`[no-aws]`).

## Differences from AWS

- API Gateway's request models (JSON Schema body validation) are not applied. They use regex lookaheads, which Go cannot run. A body that API Gateway would reject with 400 reaches the handler here.
- Each Lambda runs as one long-lived process, like one warm instance, and takes one request at a time, as a Lambda instance does. Parallel requests to the same Lambda queue rather than run side by side (in AWS they would start more instances). aws-lambda-go's RPC mode fails under overlapping calls, which broke the canvas before this rule; the smoke test sends 30 parallel requests to keep it fixed. A timeout or crash replaces the process.
- Lambdas are built for this machine (`go build`), not for `linux/arm64`.

## Guard rails

One devserver runs per machine: its ports (3000, 8787, 54329) and its Docker database are fixed, so two clones on one laptop share them. Separate laptops never collide; each generates its own secrets.

The gateway binds to loopback only. It refuses a JWT secret that `run.sh` did not generate (prefix `devserver-local-`). It refuses a Postgres that is not on loopback. Secrets, binaries and logs live in `.state/`, which git ignores.

`go test ./...` here checks the route table, CORS methods, timeouts and environment keys against `backend/infra/main.tf`. It fails when they drift.
