# NOW

Updated 2026-11-13.

## Goal

Clutter becomes one hosted product (B0) where users link their own clouds (world 2.1) and deploy one diagram to any of them: AWS through A today, and every cloud through B's connectors, OpenStack first (ADR-013, ADR-014). Make A safe first, build B beside it, then run it all in one cloud environment (ADR-015). C is A + A2 + B (ADR-011). Design: `docs/architecture/system-b-adapter-layer.md`. Build order: `docs/architecture/implementation-plan.md`. What exists: `docs/architecture/system-a-as-built.md`. Decisions: ADR-001 to ADR-017. Environments: `docs/architecture/environments.md`.

## Where it stands

- Work happens in the fork (`origin`, `FayzanT/re-clutter`) and merges by pull request into the client's `Alberta2514640/clutter` (`upstream`). The fork's `main` has the harness, docs, devserver, Terraform preview and deploy command; the client's `main` stops at PR #96 and is 5 commits behind.
- The design follows the team's plan (`docs/architecture/system-b-team-plan/`), revised 2026-11-13: Option 1 (ADR-006); B0 first (ADR-007); users' own accounts only (ADR-013); one diagram with many deployments, and an AWS connector in B that reuses A's templates (ADR-014); General first, a family of connectors with OpenStack (tested on DevStack) as its first provider (ADR-008, ADR-014). Live collaboration is another team's work. Patrii is low priority until it opens its API.
- Neither PatriCloud nor TierHive has a public API today. Patrii: REST API and Terraform provider "coming soon" (`docs/research/patricloud/2026-10-26-patricloud-research.md`). TierHive: an alpha NAT VPS host whose API ships with its beta, "later in 2026 or early 2027" (`docs/research/tierhive/2026-10-30-tierhive-research.md`). Both wait for an API; General, which is how most new clouds arrive (`system-b-adapter-layer.md` § General), does not.
- Local check results, with their dates, are owned by `backend/README.md` and `frontend/clutter/README.md`: everything passes except the 2 known Go test packages and `terraform fmt` on 7 files.
- The capstone's AWS hosting is gone (the API host is NXDOMAIN). A now runs locally through `backend/devserver` (ADR-009), including a local S3 and a stand-in for the Supabase webhook: saving a diagram generates real Terraform, and all five resource types validate. The smoke test covers all 32 routes at 0 fail (counts in `backend/devserver/README.md`). Deploy and running Ansible need the client's AWS account (`docs/architecture/environments.md`, ADR-015).
- All 24 `upstream` branches are merged into `main` or stale, except `dev` (CI `actions/checkout` v6) and `database-seed` (an abandoned DynamoDB seed).
- Waiting on the client: the list in § What we need from the client. Nothing in stages 0 to 6 waits on it.

## Next

### The order

The stages, their work, tests and "done when" are in `docs/architecture/implementation-plan.md`. Status:

| Stage | Status |
| --- | --- |
| 0. Housekeeping: client repo up to date, decisions recorded, questions sent | decisions recorded (ADR-013 to ADR-017); design checked on 2026-11-13 (independent review, AWS template spike, DevStack test); pull request and client message open |
| 1. Make A safe (phase 0, below) | open |
| 2. A test cloud on the laptop (DevStack) | proven on one laptop (2026-11-13); a setup guide for the team comes with stage 4 |
| 3. B's core | open |
| 4. General's OpenStack connector | open |
| 5. The AWS connector | open |
| 6. The frontend and the whole flow | open |
| 7. The cloud | open; needs the client's accounts |
| 8. More targets | later |

Done for A means the 12-step test in `docs/architecture/environments.md` passes in the cloud. Done for the plan means the demo in `docs/architecture/system-b-adapter-layer.md` § What the user sees runs in the cloud.

### How the team uses this file

- **Claim a task** by putting your name in its Owner cell, in the first commit of your branch, and open a draft pull request right away so others see it. Unclaim the same way.
- **Edit only your own rows**, plus the "Where it stands" line your merged work changes. Small edits to separate lines merge cleanly; never rewrite the whole file on a feature branch.
- **Whoever merges a pull request** updates the task's Status to done and moves any new defect into "Open defects".

### Phase 0: make the seams safe

These are stage 1, done before B's stages 3 to 6, in the order `docs/architecture/implementation-plan.md` § Stage 1 sets. Items 1 to 6 can be finished and checked locally; items 7 to 10 change A's AWS behaviour and are finished in code locally, then confirmed on the first AWS deploy.

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
| 10 | A's runner: stop handing it `PSQL_CONNECTION_STRING` (report status through the API instead), and start one task per run with only that run's role and external id | the runner's task definition and overrides contain no database string; a test shows one run cannot read another's credentials; confirmed in AWS later | free | open |

Then stages 2 to 6 (`docs/architecture/implementation-plan.md`).

## Open defects in A

Verified at the code by the lead:

- `POST /terraform-engine` has no authorizer (`backend/infra/main.tf`, terraform-engine-create integration) and trusts `project_id` from the body. Anyone with a project id can overwrite that tenant's generated code. Critical.
- Row-level security: none of the ten tables in `application-tables.sql` enables it, and `supported_resources` enables it with a policy for `anon` that has no command clause, so it allows every command. On Supabase with the Data API on, the anon key can read users and linked roles and rewrite the resource catalog. The final report claims RLS isolates tenants. High, depending on the Supabase project's settings.
- `GET /resources` has no authorizer. Low impact (static catalogue), but undocumented.
- Customer role grants `ec2:*`, `s3:*`, `iam:*`, `ssm:*` (`client_side_terraform_deployer_role.yaml`). High.
- Lambda runtimes: config panel sends `nodejs24.x`, code upload accepts `nodejs24`. Node code uploads fail.
- Customer state is a local file synced to S3 without a lock; generated code and state sit in `us-west-2` for every customer.
- ECR repos are immutable but images are pushed as `:latest`; the second push fails.
- `build_linux.sh` omits `terraform-engine/code-upload` and `terraform-engine/logs/recent-activity` (`build.sh` lists all 34).
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
- Found by the 2026-11-13 template spike (rendered from A's template files and run through `terraform validate`): an API Gateway to Lambda edge never routes traffic, because the API Gateway template renders no method or integration for the target Lambda and the IAM step only grants the invoke permission; that permission uses a fixed `statement_id`, so AWS rejects a second API on the same function at apply time; A's Lambdas get no basic execution role, so they cannot write logs; a "reads" edge grants Put and Delete as well; the EC2 template pins an x86 image, so an ARM instance type fails; the IAM step's API Gateway case refers to `aws_apigatewayv2_api`, which no template renders.
- Found by the 2026-11-13 design review: A's runner can assume every customer's role (`AllowClutterToDeployTerraformRole-*` in any account) and is handed the database string, which holds every external id, so one injected command reaches every tenant (phase 0 item 10).
- Minor: the recent-activity Lambda's log permission points at another log group; the terraform branch of `ansible/run-task` is dead; `application-tables.sql` fails on a re-run (`CREATE TYPE`).

Closed: the audit suspected AWS keys were committed in `ac90930`. That commit added `.vscode/.bashrc` and a `.gitignore` entry only; no AWS key pattern appears in the tree or any commit.

## Not planned yet

Needed before real users, and not yet designed. Decide each before prod, with the client where it touches money or law.

- **Cost:** who pays for running Clutter (AWS, Supabase, the Fargate run behind every deploy), and whether users pay for Clutter.
- **Legal and privacy:** terms of use, a privacy policy, and Canadian privacy law (PIPEDA), because Clutter holds access to users' cloud accounts.
- **Teams:** inviting members and roles; today an organization has only its creator and the members page is a mock.
- **Operations:** monitoring and alerts, backups and restore for Postgres and Terraform state, and who is on call.
- **Leaving:** deleting a user's data, and how a user revokes Clutter's access to their cloud.
- **Abuse and limits:** rate limits, and a cap on deploys, because each one runs a paid worker.
- **Template changes:** a template or provider version change can alter what an already-deployed diagram does on its next deploy.
- **Audit log:** who deployed or destroyed what, and when.

## What we need from the client

One message, in one go. Defaults in brackets.

| Need | Why |
| --- | --- |
| An AWS account for Clutter, owned by the client, with team access through user logins [the client owns it] | hosts world 1 in `ca-central-1` (ADR-015) |
| A second AWS account acting as a user, ideally in the same AWS organization [yes] | proves a real cross-account deploy |
| Who pays, a budget cap and a billing alert [$100 CAD for the project] | cloud costs (the team's ENEL 500 Design Roadmap, kept outside this repo, Table 11.1) |
| A Supabase project, or permission to use AWS's own Postgres [Supabase] | the database |
| A Google OAuth client | sign-in |
| A domain and DNS access | the site address, and the Google client's allowed address |
| Where the frontend is hosted [an AWS service in the same account] | the capstone only built a Docker image |
| Scope sign-off: DevStack as the fallback while Patrii has no public API, and the Design Roadmap's must-have features | the Design Roadmap, section 6.3 |
| Branch protection on the client's `main` (pull requests and the Checks workflow required) [yes] | nothing stops a direct push today |
| A Patrii contact, when the client has one [later] | Patrii's OpenStack endpoints or Terraform provider |

## Open questions

Each has a default we act on until someone answers, and the person or source that settles it. Answered 2026-11-13 and recorded: B0 first (ADR-007), one diagram with many deployments (ADR-014, replaces "one cloud per diagram"), one cloud environment in `ca-central-1` (ADR-015), where credentials are stored (ADR-016), and that the client owns the accounts (§ What we need from the client).

| # | Question | Until answered, we | Settled by |
| --- | --- | --- | --- |
| 1 | What does General (custom) cover? | a family: one connector per approved Terraform provider, plus existing servers over SSH (ADR-008) | the team and the client |
| 2 | Which providers does General start with after OpenStack? | DigitalOcean | the team and the client |
| 3 | Why TierHive, and does the client know KernelKeepers LTD? | treat TierHive as later: a General connector if it ships a Terraform provider, its own otherwise; its hand-made servers through General's SSH mode once that exists | the client |
| 4 | Is Patrii a place to build, a place to host Clutter, or both? | a place to build | the client (data residency needs would change it) |
| 5 | Where does Terraform state go in B? | in the user's storage when their target has any, otherwise ours, encrypted and locked | the team, in stage 3 |
| 6 | Does the other team's live collaboration need anything from the diagram document or B API? | keep the document's shape stable and tell them before changing it | the other team |
| 7 | Should CI move to `actions/checkout` v6, as the client's `dev` branch does? | yes, the next time CI changes | the team |
| 8 | Are ADR-001 to ADR-017 accepted? Only ADR-012 is. | act on them as written | the team, in one review; the client for scope and hosting (ADR-004, ADR-007, ADR-013, ADR-015) |
