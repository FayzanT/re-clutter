# CLAUDE.md

The frames to hold before opening a file, the boundaries not to cross, and where everything else lives. Folder `CLAUDE.md` files load where you work; `docs/README.md` maps each fact to its one owner. How the lead (the main session) runs the work is `.claude/lead.md`. Nothing here restates what `ls`, `grep` or a type signature already answers.

## What Clutter is

A drag-and-drop canvas that turns an architecture diagram into Terraform (and Ansible), then runs it inside the customer's own cloud account. It began as a University of Calgary capstone (team 500-MM-3, client Alberta 2514640 Inc). The final report is in `docs/old-capstone/` (PDF, and the same text as markdown); it is history, not the current architecture (`docs/architecture/system-a-as-built.md` owns that).

The team's names, used everywhere: **C** is the whole app, A + A2 + B. **A** is Clutter as built (AWS only, complete, tested). **A2** is the local extension (`backend/devserver`): it runs A without AWS, and B beside it, and is for the team, not end users. Its one piece inside A is the local-only **Link fake account** button (ADR-011). **B** is the adapter layer we are building beside it: B API, a connector interface, and one **connector** per target (General: one per approved Terraform provider, OpenStack first; AWS, reusing A's templates; Patrii and TierHive when they have APIs, through General where a standard provider exists). **B0** is B run by us as a hosted service (built first); **B1** is B as a self-hosted service with entity connectors (later); **B2** is B run inside a company with instance connectors (later, and a separate decision). **World 1** is Clutter's own cloud account; **world 2** is the user's account, where their diagram is built (`docs/architecture/system-b-adapter-layer.md` § Names, which owns every name here). We build **2.1** (users link their own accounts), not 2.2 (accounts Clutter owns). One diagram can have several **deployments**, one per linked cloud (ADR-014). There are two environments, local and one cloud (ADR-015). A **connection** is one organization's linked cloud account (a connector plus credentials and region); older docs call it an instance, which now means only B2's *instance connector*. The design is `docs/architecture/system-b-adapter-layer.md`; the team's own figures are in `docs/architecture/system-b-team-plan/`; target research is in `docs/research/`.

## What you will get wrong about this repo

- **There are two Terraforms.** `backend/infra` deploys Clutter itself into Clutter's AWS account. The `*.tf.tmpl` files are customer templates the generator renders into code that runs in the customer's account. A change to one never stands in for the other (`.claude/rules/terraform.md`).
- **Templates do not ship with the Lambda.** They are uploaded to S3 by the platform Terraform (one `aws_s3_object` per file) and fetched at run time. A new template file that is not added there does not exist in production.
- **A resource is defined in five places that must agree:** the generator's type switch and generator file (Go), the template, the `supported_resources` seed (SQL), the canvas palette and config panel (frontend), and the S3 upload. They already drift (runtimes, regions, defaults). A keeps its five places (Option 1, ADR-006); B's connectors each keep one owner, the manifest, so the drift is not repeated. B's AWS connector also uses A's template files and three new ones, which ride the same S3 upload. `add-cloud-resource` lists all five.
- **"AWS" is not only in the templates.** It is in the core: the `provider "aws"` block the writer emits, IAM policy built from edges, the region list, the account-link flow (CloudFormation and role ARN), the runner scripts (STS and SSM), the DB columns, and the frontend's node component. Assume any file may hold an AWS assumption until you have read it.
- **The final report overstates A.** It says every endpoint needs a JWT, Supabase row-level security isolates tenants, roles are least privilege, and a new resource needs only a new template. The code does none of these. Check the code before repeating a report claim.
- **87 of A's files use CRLF line endings, stored that way in git:** 52 Go files, 24 platform `.tf` files, 4 `*.tf.tmpl` templates and a few JSON, YAML, SQL and Dockerfile files (`git ls-files --eol`). With `core.autocrlf=input` (common on macOS), git rewrites a touched CRLF file to LF on commit, so a one-line edit becomes a whole-file diff. Check `git diff --stat` before committing an A file, and keep line endings as they are. The format hook skips files that were not formatted at HEAD for the same reason.
- **Work happens in a fork, and merges into the client's repo.** `origin` is `FayzanT/re-clutter`, where branches live. `upstream` is the client's `Alberta2514640/clutter`, which receives finished work by pull request. Never push to `upstream` directly. Its 24 older branches are all merged into `main` or stale.
- **Nothing in A triggers generation.** `POST /terraform-engine` expects a Supabase database-webhook body, and that webhook is configured in Supabase, not here. Neither the frontend nor the diagram handlers call it. Locally, `backend/devserver` stands in for the webhook.

## Boundaries, and what enforces them

- **Tenant isolation is the product's first promise.** Every handler that takes an org, project, diagram, run or account id checks that the caller is a member of the org and that the child belongs to that org. Membership alone is not enough. A handler without that check is a defect, whatever else it does.
- **User input never reaches generated code unescaped.** A value from the canvas that lands in a template, an IAM policy, an Ansible playbook or a shell command is validated against an allow-list or escaped for that target. Generated code runs with the customer's credentials and the runner holds platform secrets, so an injection here is a cross-tenant breach.
- **Customer credentials and Terraform state never reach a log, a response, a session transcript or a doc.** Hooks refuse reading `.env*`, state, tfvars, `clouds.yaml`, openrc files and `.vscode/.aws_credentials`.
- **No session deploys.** `terraform apply` or `destroy`, a mutating `aws` or `openstack` command, `ansible-playbook` or an image push goes to the person for approval (the `guard-cloud-writes` hook asks). Lanes never deploy.
- **A is touched only at the named seams** (ADR-006, listed in `docs/architecture/system-b-adapter-layer.md` § The seams), plus the stage 1 work in `docs/architecture/implementation-plan.md`. Any other change to A is a decision, recorded before it is made.
- **B's core never names a connector.** Target code lives behind the connector interface; core code that branches on a target name is a defect, not a shortcut (`docs/architecture/system-b-adapter-layer.md`).

## Known open defects

The 2026-10-26 audit and the 2026-11-13 design review found security defects that are still open: an unauthenticated generation endpoint, template injection, an over-broad customer role, ownership checks that stop at membership (one is a cross-tenant read), a log-in that accepts Google tokens minted for any app, a runner that can reach every customer's account and holds the database string (phase 0 item 10, found 2026-11-13), and a database with row-level security off on ten tables and wide open on the eleventh. They are listed with their fixes in `.claude/findings/NOW.md`. Do not build on top of a path they touch without fixing or flagging it.

## Commands

Run from the repo root with absolute paths; no `cd dir && cmd`. The commands live here; their expected results live with each folder (`backend/README.md`, `frontend/clutter/README.md`, `backend/devserver/README.md`). Compare against those, and update them when a result changes.

| Question | Command | Notes |
| --- | --- | --- |
| Does the Go compile? | `go -C backend/api build ./...` and `go -C backend/api vet ./...` | Must stay green. |
| Do the Go tests pass? | `go -C backend/api test ./...` | Two packages fail before any change (`backend/README.md` says which). Read the per-package lines; a red run is not a reason to skip the packages you touched. |
| Does the frontend type-check, lint and build? | `npx --prefix frontend/clutter tsc --noEmit -p frontend/clutter`, `npm --prefix frontend/clutter run lint`, and the build with `NEXT_PUBLIC_API_ENDPOINT` set | Needs `npm ci` in `frontend/clutter` first; npm, never pnpm. |
| Is the platform Terraform valid? | `terraform -chdir=backend/infra fmt -check -recursive`, then `validate` after `init -backend=false` in a scratch copy | The backend is the capstone team's AWS account: never `plan` or `apply` against it. |
| Does A still run? | `backend/devserver/dev.sh --backend-only`, then `npm run smoke`; stop with `npm run stop` | Any change on a seam must keep the smoke test at 0 fail. |
| Does the devserver itself pass? | `go -C backend/devserver vet ./...` and `go -C backend/devserver test ./...` | Its route test fails if `backend/infra/main.tf` changes a route; update `internal/routes/routes.go` with it. |
| Do our docs and scripts lint? | `npx -y markdownlint-cli2@0.18.1 "**/*.md"`, and `docker run --rm -v "$PWD":/mnt -w /mnt koalaman/shellcheck:v0.10.0 -S warning .claude/hooks/*.sh backend/devserver/*.sh` | Both must stay clean. |
| Do the hooks still work? | `.claude/hooks/test-hooks.sh` | Run after changing any hook. |
| How is it deployed to AWS? | `npm run deploy:plan -- prod`, `npm run deploy -- prod` (a person runs these); `docs/architecture/environments.md` § Setting up the cloud | Not run yet; needs the client's account and phase 0 first. After changing `backend/infra/deploy.sh`, run `backend/infra/test-deploy.sh`. |

CI: `.github/workflows/checks.yml` runs the Go, devserver, frontend, markdown, shellcheck and hook checks on every pull request and push to `main` (the two known-failing Go packages are excluded until phase 0 item 6). It also runs the smoke test. `.github/workflows/docker-image.yml` is A's image build, unchanged.

## When you are uncertain

- A search that returns nothing is the claim most worth double-checking. Say "I have not checked" rather than infer absence.
- Ambiguity about architecture, tenancy, credentials, the schema or user-visible copy: ask, with a default, and keep working on the default.
- Patrii Cloud is in beta and changes monthly. Re-check any Patrii fact older than a month against patrii.cloud before building on it (`ground-before-building`).

## Habits that matter here

- **Grep to locate, read to understand.** A grep says a symbol occurs; only the surrounding lines say what is true.
- **Follow a change through every layer it rides:** canvas node, API schema, Go handler, generator, template, S3 upload, runner. A field added in three of five places is the drift this repo already has.
- **Fix the class at its owner.** A missing ownership check in one handler is almost always missing in its siblings; sweep them all.
- **Every narrowing change drops something real.** Before adding a filter, guard or allow-list, name the legitimate input it now refuses.
- **Delete what a change makes unused** in the same change. No `_v2` copies beside the original.

## Skills

Skills route by their own descriptions. The ones a description alone may not catch:

| Doing this | Use |
| --- | --- |
| Writing or changing any code | `engineering-conventions` |
| Starting a feature, or touching a cloud API, Terraform provider or library | `ground-before-building` |
| Adding or changing a canvas resource (any provider) | `add-cloud-resource` |
| Running as a delegated lane | `lane-doctrine` (preloaded by the agents) |

## Which surface a thing belongs on

| Surface | Holds | Write here when |
| --- | --- | --- |
| this file | how to think and behave here | a behaviour must change |
| `.claude/hooks/` | what must never go wrong, enforced | the model must not be able to get it wrong |
| `.claude/skills/` | how to do a repeatable job | a procedure changes |
| `.claude/rules/` | path-scoped reminders | a rule applies to one kind of file |
| `docs/` | what is true | a fact changes |
| `docs/decisions.md` | what was decided and why | a decision is made |
| `docs/research/` | dated outside research | a source was read |
| `.claude/findings/NOW.md` | where the work stands | work lands, the plan changes, or the session ends |
| a code comment or folder `CLAUDE.md` | the trap a line or folder must not fall into | an invariant would surprise the next editor |

The test for a line in this file: would removing it cause a model to repeat a mistake? If not, it belongs elsewhere or nowhere.

## Repo-wide rules

- **No em dashes** in user-facing copy, docs a person outside the team reads, or chat replies. Code comments may follow the file's style.
- **Plain everyday English** wherever a person reads it.
- **Never commit, push or open a PR unless the person asks.** Work happens on a branch, never straight on `main`. Commit messages describe what changed and why; no tool attribution.
