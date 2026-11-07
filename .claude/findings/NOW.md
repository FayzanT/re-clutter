# NOW

Updated 2026-10-30.

## Goal

First prove System A: test it locally through A2 (`backend/devserver`), fix what is unsafe, then run it in a dev cloud. Then build System B, the adapter layer, beside it, so a diagram can deploy to other targets through connectors: General first, then PatriCloud and TierHive. C is A + A2 + B (ADR-011). Design: `docs/architecture/system-b-adapter-layer.md`. What exists: `docs/architecture/system-a-as-built.md`. Decisions: ADR-001 to ADR-012. Environments: `docs/architecture/environments.md`.

## Where it stands

- Work happens in the fork (`origin`, `FayzanT/re-clutter`) and merges by pull request into the client's `Alberta2514640/clutter` (`upstream`). The harness, docs, design, devserver and Terraform preview are in this branch.
- The design now follows the team's plan (`docs/architecture/system-b-team-plan/`): Option 1, build B next to A and touch A only at named seams (ADR-006); B1 first, B2 later (ADR-007); the General connector first (ADR-008).
- Neither PatriCloud nor TierHive has a public API today. Patrii: REST API and Terraform provider "coming soon" (`docs/research/patricloud/2026-10-26-patricloud-research.md`). TierHive: an alpha NAT VPS host whose API ships with its beta, "later in 2026 or early 2027" (`docs/research/tierhive/2026-10-30-tierhive-research.md`). Both connectors are blocked; General is not.
- Every local check was run on 2026-10-30 (results in `backend/README.md` and `frontend/clutter/README.md`). Go build and vet, frontend types, lint and build, Terraform validate and the database schema pass. Go tests fail in the 2 known packages, and `terraform fmt` fails on 7 files.
- The capstone AWS deployment is gone (the API host is NXDOMAIN). A now runs locally through `backend/devserver` (ADR-009), including a local S3 and a stand-in for the Supabase webhook: saving a diagram generates real Terraform, and all five resource types validate. Smoke test of all 32 routes: 31 pass, 3 need AWS, 3 expected, 0 fail. Deploy and running Ansible need our own AWS account (`docs/architecture/environments.md`, ADR-010).
- All 24 `upstream` branches are merged into `main` or stale, except `dev` (CI `actions/checkout` v6) and `database-seed` (an abandoned DynamoDB seed).
- Waiting on: the team's answers to the questions below, and contacts at Patrii and TierHive.

## Next

### The order

| Step | Work | Touches A? | Status |
| --- | --- | --- | --- |
| 0 | tag `capstone-original` (A as delivered) | no | done |
| 1 | Terraform preview in the editor, as a product feature (ADR-012) | yes, an agreed exception | done, tested locally |
| 2 | deploy from a laptop: A2 answers A's ECS call by running the deployer in Docker, against a real AWS account | no | open; needs an AWS sandbox to prove |
| 3 | phase 0 security and bug fixes (below) | yes, as ADR-006 allows | open |
| 4 | dev environment on AWS, Supabase and Google (`docs/architecture/environments.md`), with the hard-coded items removed and `npm run deploy` proven for the first time | configuration and small A changes | open; needs accounts |
| 5 | System B, phase 1 | no | after step 4 |

Done for A means one diagram with a Lambda and an S3 bucket deploys to dev, shows up in AWS, and destroys cleanly.

### How the team uses this file

- **Claim a task** by putting your name in its Owner cell, in the first commit of your branch, and open a draft pull request right away so others see it. Unclaim the same way.
- **Edit only your own rows**, plus the "Where it stands" line your merged work changes. Small edits to separate lines merge cleanly; never rewrite the whole file on a feature branch.
- **Whoever merges a pull request** updates the task's Status to done and moves any new defect into "Open defects".

### Phase 0: make the seams safe

Do these before phase 1, in any order unless a row says otherwise. Items 1 to 6 can be finished and checked locally; items 7 to 9 change A's AWS behaviour and are finished in code locally, then confirmed on the first AWS deploy.

| # | Task | Done when | Owner | Status |
| --- | --- | --- | --- | --- |
| 1 | Authenticate `POST /terraform-engine` (a signed webhook secret), make save and compile one authenticated sequence, and decide whether `GET /resources` stays public | the smoke test shows `POST /terraform-engine` refused without the secret; a handler test covers a bad signature | free | open |
| 2 | Row-level security: enable it on every table in `backend/storage-sql`, with policies that keep each organization's rows to its members, and fix the `anon` policy on `supported_resources` | in the devserver's Postgres, the `anon` role can read no user, organization or account row; the smoke test stays at 0 fail | free | open |
| 3 | Validate and escape every canvas value before it reaches a template: allow-lists for enumerated fields, a name pattern, HCL escaping for free text including `${` and `%{` | generator tests (reading templates from disk) reject a bad name, an out-of-list value, `"`, `${` and a newline; valid diagrams still render | free | open |
| 4 | Set `GOOGLE_CLIENT_ID` on the log-in Lambda in `backend/infra/main.tf` and check `email_verified` in the handler | the devserver's route test passes with the new environment key; a handler test rejects a token with the wrong audience and an unverified email | free | open |
| 5 | Ownership checks on every child id through one shared helper in `generic` (recent-activity, terraform-command-runner, code-upload, logs/live, ansible list-jobs) | a test per handler shows a member of organization X gets 403 or 404 for organization Y's project, diagram or run; the smoke test stays at 0 fail | free | open |
| 6 | Go tests green offline (put the live-S3 tests behind a build tag, fix the nil-connection panic), and remove the package exclusion in `.github/workflows/checks.yml` | `go -C backend/api test ./...` exits 0 with no AWS credentials, and the checks workflow runs every package. **Good first task**: small, no security path, teaches the backend and its tests | free | open |
| 6b | Update the frontend's packages: `npm audit` reports 21 issues (2 critical, 14 high), including Next.js itself, and `zod` and `sharp` directly. `sharp` needs a major version bump | `npm audit` shows no critical or high issue in a package the app ships; type-check, lint, build and a browser check still pass | free | open |
| 6c | Generation bug: API Gateway with CORS off renders invalid Terraform (the stale `outputs.tf` bug is fixed) | `terraform validate` passes for API Gateway with CORS off | free | open |
| 6d | `GetOutputs` hides template failures in all five generators, and `POST /terraform-engine` error bodies leak paths and SDK text | a failed output template fails the run; a test shows a generic error body | free | open |
| 7 | Narrow the customer role (`client_side_terraform_deployer_role.yaml`) to the actions the templates use | the policy lists named actions, no `*` on `iam`, `s3`, `ec2` or `ssm`; confirmed by a deploy in AWS later | free | open |
| 8 | Verify a role ARN with STS before storing it in `submit-role-arn` | a handler test with a stubbed STS client rejects an ARN it cannot assume; confirmed in AWS later | free | open |
| 9 | A lock on customer Terraform state (an S3 backend with locking instead of the synced local file) | the deployer's generated backend block has locking; two parallel runs on one diagram are refused, confirmed in AWS later | free | open |

Then phase 1: the connector interface, the B1 skeleton and the General connector (`docs/architecture/system-b-adapter-layer.md` § Build order).

## Open defects in A

Verified at the code by the lead:

- `POST /terraform-engine` has no authorizer (`backend/infra/main.tf`, terraform-engine-create integration) and trusts `project_id` from the body. Anyone with a project id can overwrite that tenant's generated code. Critical.
- Row-level security: none of the ten tables in `application-tables.sql` enables it, and `supported_resources` enables it with a policy for `anon` that has no command clause, so it allows every command. On Supabase with the Data API on, the anon key can read users and linked roles and rewrite the resource catalog. The final report claims RLS isolates tenants. High, depending on the Supabase project's settings.
- `GET /resources` has no authorizer. Low impact (static catalogue), but undocumented.
- Customer role grants `ec2:*`, `s3:*`, `iam:*`, `ssm:*` (`client_side_terraform_deployer_role.yaml`). High.
- Lambda runtimes: config panel sends `nodejs24.x`, code upload accepts `nodejs24`. Node code uploads fail.
- Customer state is a local file synced to S3 without a lock; generated code and state sit in `us-west-2` for every customer.
- ECR repos are immutable but images are pushed as `:latest`; the second push fails.
- `build_linux.sh` omits `terraform-engine/code-upload` and `terraform-engine/logs/recent-activity` (`build.sh` lists all 33).
- The frontend members API is an in-memory mock (`MOCK_MEMBERS`); no invite route exists.
- The frontend `RunAction` type offers `plan`; the backend accepts only `apply` and `destroy`.
- Nothing in the repo calls `POST /terraform-engine`; it depends on a Supabase webhook configured outside the repo.
- The frontend proxy lets any `clutter_token` cookie value through; it never verifies the token. Low impact (page shells only, data needs a real JWT).
- `frontend/clutter/init.bash` is a stale scaffold script that overwrites real source files. The frontend README now warns against it; the script itself is A's and is not deleted.
- The Google OAuth client id is hard-coded in two frontend files and belongs to the capstone team's Google project.

Found or confirmed by the 2026-10-30 code sweep (a reader lane; the first four re-checked at the source by the lead):

- Log-in accepts a Google ID token minted for any app. `GOOGLE_CLIENT_ID` is read by the log-in handler but never set on its Lambda (`backend/infra/main.tf`, log-in module), and Google's `idtoken.Validate` skips the audience check when the audience is empty. `email_verified` is not checked. High.
- `GET /terraform-engine/logs/recent-activity` checks membership of the org, then queries by diagram id alone: a cross-tenant read of another tenant's diagram name and deploy history. High.
- Ansible polling never stops on success: the frontend's terminal set is `SUCCESS`, `FAILED`, `CANCELLED`; the database uses `COMPLETED`.
- No deploy sends a region: the account-link page offers a few regions, but `runTerraform` sends none, so every deploy runs in `us-west-2`. The `us-east-1` default is in the API Gateway JSON model, which API Gateway does not apply.
- Template injection is worse than quote-breaking: values sit inside HCL strings, so `${...}` in a canvas value is evaluated by Terraform. Only the Terraform identifier is sanitized; every other value (function name, handler, runtime, instance type, key name, env vars and others) is inserted raw through `text/template`, and the entry point is unauthenticated. Critical. A fix must escape `${` and `%{` as well as `"` and `\`.
- `submit-role-arn` stores the ARN with no STS check; only a regex and the 8-character suffix are checked. Confirmed.
- `terraform-command-runner` and `code-upload` check membership but not that the project and diagram belong to the org (the runner writes a log row on any diagram); `logs/live` describes any task ARN in the shared cluster. Confirmed.
- `ansible/list-jobs` filters by creator only, with no org check. `role_arn` is in the response code but never written. Partly confirmed.
- JWT: no iss or aud, and validation is turned off and done by hand; the log-in handler type-asserts Google claims without `ok` and panics if one is missing. The missing empty-secret check fails closed (the library rejects an empty key). Partly confirmed.
- Any member can delete an organization (no role column).
- Canvas drift: the Lambda `memory_size` choice is ignored (the UI stores strings, the generator reads numbers, so it is always 128); the code-upload handler is never saved, so Node and Python functions keep `handler = "main"`; the API Gateway template is invalid with CORS off; IAM references `aws_apigatewayv2_api` but the template creates a REST API; seed runtime `provided.al2` vs generator `provided.al2023`.
- Frontend: `/register` posts to a dead hard-coded host and is not reachable through the proxy; `settings/organization/create-org` and the workspaces page are stubs; the diagram editor uses the user's first organization, so deploy and upload break for users in more than one.
- Dead code in the generator (`LambdaDefaults`, `S3Defaults`, `DynamoDBDefaults`, `LoadResourceTemplates`, `RenderContext`, `HasDataChanged`). Confirmed.
- Found by running A locally (2026-10-30): `terraform-command-runner` writes a `RUNNING` deploy-log row before it starts the ECS task, so a failed start leaves a deploy that shows as running forever. `ansible/submit-job` reports every S3 error as 404 "playbook not found". `terraform-engine` returns 400 "completed with errors" when its templates cannot load, so a platform failure looks like a user error. The login page's 403 branch for expired tokens can never run in a browser, because API Gateway's own 403 has no CORS headers. `code-upload` puts `lambda_resource_name` into the S3 key unvalidated. Confirmed at run time: `POST /terraform-engine` runs with no token.
- Found by generating Terraform locally (2026-11-04): API Gateway with CORS off renders invalid Terraform (`depends_on` names the `_options` resources outside the `{{if .EnableCORS}}` block), and the canvas can send that. The generator's response gives an `s3_path` without the `terraform/` folder. Real Google sign-in works locally only through the capstone's client id and the unset audience check.
- Found building the Terraform preview (2026-11-04): `GetOutputs` in all five generators returns empty on a template failure, so a run reports success with outputs missing, and if every one fails `outputs.tf` is deleted (the fix changes the `ResourceGenerator` interface). The 400 and 500 bodies of `POST /terraform-engine` still carry paths and SDK text, on a route with no authorizer. The panel's "save to refresh" needs a change first, because Save is disabled on a clean diagram. Diagrams written through the API load as unsaved, so Preview stays disabled until Save. The status tests in `terraform-engine/create` pass but CI skips that package until phase 0 item 6.
- Minor: the recent-activity Lambda's log permission points at another log group; the terraform branch of `ansible/run-task` is dead; `application-tables.sql` fails on a re-run (`CREATE TYPE`).

Closed: the audit suspected AWS keys were committed in `ac90930`. That commit added `.vscode/.bashrc` and a `.gitignore` entry only; no AWS key pattern appears in the tree or any commit.

## Open questions

1. What does General (custom) mean: Terraform with a named provider plus existing hosts over SSH (default), or something else?
2. Why TierHive, and does the client have a relationship with KernelKeepers LTD? Default: treat TierHive as a later connector and reach it through General until its API ships.
3. Who contacts Patrii and TierHive, and can we join Patrii's Technology partner program for a sandbox? Default: the client (Alberta 2514640 Inc) makes the contact and asks.
4. Does B run as a container (default, since B1 is self-hosted) or as Lambdas like A?
5. Is Patrii a customer target, a host for Clutter itself, or both? Default: a customer target first.
6. Does a diagram target exactly one target instance? Default: yes.
7. Should our fork pick up `upstream/dev`'s CI fix (`actions/checkout` v6)? Default: yes, in phase 0's CI work.
8. Where are instance credentials stored, and how are they secured per instance? Default: an encrypted secret store with only a reference in Postgres.
