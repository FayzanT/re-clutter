# Clutter

Clutter is a drag-and-drop canvas for cloud architecture. You draw a diagram (a Lambda, an S3 bucket, an EC2 server, with lines between them), and Clutter turns it into Terraform and Ansible and runs it inside your own cloud account.

It began as a University of Calgary capstone (team 500-MM-3, 2025 to 2026) for Alberta 2514640 Inc. That version works with AWS only. A previous capstone team built that version; we are the new team, extending it so a diagram can deploy to other targets, such as PatriCloud and TierHive, through an adapter layer.

This page gets you from a fresh clone to a working setup, and shows where everything lives. Read it once, top to bottom.

## Where the project stands

| | |
| --- | --- |
| **System A** (Clutter as built, AWS only) | Complete and tested by the capstone team. Its AWS deployment has been torn down. It runs locally through `backend/devserver`, except the parts that need AWS (deploy and running Ansible). |
| **System B** (the adapter layer) | Designed, not built. Phase 0 (security fixes A and B share) comes first. |
| **Local checks** | Go build, frontend type-check, lint and build, Terraform validate and the database schema all pass. Two Go test packages fail (known). |
| **Open defects** | Several security defects in A, some critical. Listed in `.claude/findings/NOW.md`. Read that before you build on any A code path. |

## The two systems

**A: Clutter today.** A Next.js canvas, 34 Go Lambdas (32 API routes, an authorizer and a queue consumer) behind AWS API Gateway, Postgres on Supabase, S3, and two Fargate runners: one runs Terraform in the customer's AWS account, one runs Ansible on the customer's EC2 servers over SSM. Full description: `docs/architecture/system-a-as-built.md`.

**B: the adapter layer.** New code beside A, not a rewrite of A. B has its own API, a connector interface, and one connector per target: General (custom) first, then PatriCloud and TierHive. Full design: `docs/architecture/system-b-adapter-layer.md`. The team's original figures are in `docs/architecture/system-b-team-plan/`.

The names everyone uses:

| Name | Means |
| --- | --- |
| C | the whole Clutter app: A + A2 + B |
| A | Clutter as built (AWS). Changed only at named seams, for bug and security fixes, and by recorded decision. |
| A2 | the extension that makes A run and test without AWS (`backend/devserver`). It wraps A from outside, with one exception (the local-only **Link fake account** button). For the team, not end users. |
| B | the adapter layer we are building |
| B1 | B as a service anyone can run, with entity connectors (built first) |
| B2 | B run inside a company, with instance connectors (later) |
| connector | the code for one target type (General, PatriCloud, TierHive). An *entity connector* is one we write for a target type (B1); an *instance connector* is one a company builds for its own setup (B2). |
| PatriCloud | our working name for Patrii Cloud (patrii.cloud), a Canadian cloud; the same thing |
| General | the first connector: Terraform with any provider the customer names, or servers they already have over SSH (the exact scope is open question 1 in `NOW.md`) |
| instance | one company's configured setup of a connector |
| seam | one of the four places B touches A: the target choice screen, shared sign-in, the shared database, and security fixes |
| phase 0 | the first work item: security fixes on the parts A and B share (listed in `.claude/findings/NOW.md`) |
| ADR | architecture decision record: one entry in `docs/decisions.md` |

The full definitions are in `docs/architecture/system-b-adapter-layer.md` § Names. AWS terms you will meet in A: Lambda (a function AWS runs on request), API Gateway (AWS's HTTP front door), Fargate (AWS running a container on demand), STS (AWS issuing short-lived credentials for another account's role), SSM (AWS running a command on a server without SSH), S3 (file storage), SQS (a queue). The Supabase webhook is a trigger configured in the database service, outside this repo.

## What is in the repo

```text
backend/
  api/              Go Lambdas, one folder per route; generic/ is shared code
    terraform-engine/create/   the generator: diagram JSON to Terraform
  infra/            Terraform that deploys Clutter itself into Clutter's AWS account
    modules/s3/uploads/        the customer Terraform templates (*.tf.tmpl)
    modules/fargate/ecr-scripts/   the two runner images
  storage-sql/      the Postgres schema and the resource seed
  devserver/        dev-only: runs A's real Lambdas locally behind an API Gateway stand-in
  tfstate-infra/    bootstraps the remote state bucket for infra/
frontend/
  clutter/          the Next.js app (canvas, dashboard, settings)
  Dockerfile.frontend
docs/
  README.md         the map: which file owns which fact
  architecture/
    system-a-as-built.md       A: what exists today
    system-b-adapter-layer.md  B: what we are building, and in what order
    environments.md            local vs dev vs prod: what differs and what each needs
    system-b-team-plan/        the team's own B plan: figures, PDF and the written explanation
  decisions.md      every decision and why (ADR-001 onward; ADR means architecture decision record)
  research/
    patricloud/     dated research on PatriCloud (and a second research run)
    tierhive/       dated research on TierHive
  old-capstone/  the previous capstone team's final report (PDF and markdown) and backend tutorial
.claude/            the Claude Code setup (its README says what each part is)
  findings/NOW.md   the status board: next tasks, open defects, open questions (everyone reads this)
CLAUDE.md, AGENTS.md        rules for AI coding agents; skim them, they are written for agents
```

There are two kinds of Terraform here. `backend/infra` deploys Clutter itself. The `*.tf.tmpl` files are templates the generator fills in for a customer. They never stand in for each other.

## Set up

### 1. Install the tools

`npm` cannot install Go, and `go` cannot install Node. Each language needs its own installer first. After that, the repo installs its own packages (`npm install` for the frontend; `npm run dev` downloads Go modules and the Postgres image).

| Tool | Version | Needed for |
| --- | --- | --- |
| macOS (tested) or Linux; Windows only through WSL (untested) | | |
| Git and GitHub CLI (`gh`) | any recent | clone, branches, pull requests |
| Go | 1.25 or newer (`backend/api/go.mod`) | the backend. Homebrew's `go` is currently 1.27, which is fine |
| Node.js with npm | 22 or newer (`.nvmrc`; CI uses 22; Next.js 16's floor is 20.9) | the frontend. Use npm; `pnpm-lock.yaml` is stale |
| Terraform | 1.x | checking the infrastructure code, not a local run |
| Docker Desktop (running) | any recent | the local database. `brew install docker` is only the CLI and is not enough |
| curl, openssl, python3 | macOS has them | the local run scripts |
| AWS CLI | v2 | only for deploying, which nobody does from a laptop yet |
| Claude Code, and `jq` | optional | the AI setup in `.claude/` (its hooks need `jq`) |

**macOS**, with [Homebrew](https://brew.sh). If `brew` is missing, install it from that page, then:

```bash
xcode-select --install                         # Apple's Git and compilers; skip if already installed
brew install git gh go node jq
brew install hashicorp/tap/terraform           # Hashicorp's formula; Homebrew core no longer ships terraform
brew install --cask docker-desktop             # then open Docker.app and wait until it says it is running
```

`brew install node` puts `node` and `npm` on your PATH. That is not the same as the project's JavaScript packages.

**Linux.** Install the same tools from the vendor pages, not from an old distro package of Go or Node: [Go](https://go.dev/doc/install), [Node 22 LTS](https://nodejs.org/), [Docker Engine](https://docs.docker.com/engine/install/), [Terraform](https://developer.hashicorp.com/terraform/install), [GitHub CLI](https://cli.github.com/). Then start Docker (`sudo systemctl start docker`, or your distro's equivalent).

**Check** (open a new terminal after Homebrew so PATH updates):

```bash
go version          # go1.25 or newer
node -v             # v22 or newer
npm -v
docker info         # must succeed; if it cannot talk to the daemon, open Docker Desktop and wait
terraform version   # optional until you check backend/infra
gh --version
```

Nothing in the repo is installed yet. That is step 2.

### 2. Clone

We work in a fork (`origin`). Finished work merges into the client's repo (`upstream`) by pull request, never by a direct push.

```bash
git clone https://github.com/FayzanT/re-clutter
cd re-clutter
git remote add upstream https://github.com/Alberta2514640/clutter
npm install
```

`npm install` at the repo root runs `npm ci` for the frontend, which reads `frontend/clutter/package-lock.json` and fills `frontend/clutter/node_modules` at exact versions. It does not install Node itself. The backend has no install step: Go downloads its modules, pinned by each `go.sum`, on the first `npm run dev` (or the first `go build` in step 3); you do not run `go get` by hand.

### 3. Check that everything builds

Run from the repo root.

```bash
go -C backend/api build ./...
go -C backend/api vet ./...
go -C backend/api test ./...          # 2 packages fail today (one waits about 70 s first)
npx --prefix frontend/clutter tsc --noEmit -p frontend/clutter
npm --prefix frontend/clutter run lint
NEXT_PUBLIC_API_ENDPOINT=http://localhost:9999 npm --prefix frontend/clutter run build
terraform -chdir=backend/infra fmt -check -recursive    # 7 files fail today
go -C backend/devserver test ./...     # the local run tool
```

The expected result of each check, including the two known failures, is in `backend/README.md` and `frontend/clutter/README.md`. Every other package must pass.

### 4. Run the app locally

Open Docker Desktop first, then:

```bash
npm run dev
```

That is the whole backend and frontend. It checks your tools, starts Postgres in Docker, builds and starts A's real Lambdas behind a local API Gateway, and runs the frontend in this terminal. The first run takes a minute or two. Ctrl+C stops everything and keeps your data.

Then:

1. Open <http://localhost:3000/login> and sign in with Google.
2. The first time, sign-in takes you to create an organization. Then create a project and a diagram from the dashboard.
3. The diagram editor stays locked until the organization has a linked AWS account. Press **Link fake account** on that popup (it only appears locally, and only writes to the local database).
4. Open a diagram, drag resources on, name them and press Save. Saving generates real Terraform. Press **Preview Terraform** to read and download it. Deploy fails at its AWS call; that is expected.

Frontend edits reload by themselves. After editing Go code, press Ctrl+C and run `npm run dev` again.

| Command | Does |
| --- | --- |
| `npm run dev` | starts everything; Ctrl+C stops it and keeps your data |
| `npm run seed` | creates a sample diagram to try things on |
| `npm run generated -- <diagram-id>` | runs `terraform validate` on a diagram's generated files |
| `npm run smoke` | calls all 32 routes and prints what passed (with `npm run dev` running) |
| `npm run stop` | stops a backend left running |
| `npm run stop -- --wipe` | also deletes the local database, to start clean |

A has no backend server of its own, so this runs stand-ins for its AWS parts. `docs/architecture/system-a-as-built.md` § How A runs has the table of what is real and what stands in. What works locally and what does not is in `backend/devserver/README.md`.

Deploying and running Ansible need real AWS: `docs/architecture/environments.md` says what dev and prod need.

## Do not run

- `frontend/clutter/init.bash`. It is an old scaffold script that overwrites real source files.
- `terraform plan` or `apply` in `backend/infra`. Its state backend is the capstone team's AWS account.

## Your first day

Read in this order:

1. This page.
2. `docs/architecture/system-a-as-built.md`: what A does, what the capstone delivered, and where the final report is wrong about the code.
3. `docs/architecture/system-b-adapter-layer.md`: what we are building and in what order.
4. `.claude/findings/NOW.md`: what is in progress, the open defects, the open questions.
5. `docs/decisions.md`: why things are the way they are.
6. `CLAUDE.md`: skim it. It is written for AI agents, but its "What you will get wrong" list is the fastest way to learn the traps.

Then pick a task from `NOW.md` § Next. Tell the team which one you are taking, so two people do not take the same one. A good first task is the last phase 0 item (make the Go tests pass offline): it is small, it touches no security path, and it teaches you the backend and its tests.

## How we work

- **Branches.** Branch off `main`. Never commit to `main` directly. Push your branch to our fork (`origin`), then open a pull request into the client's repo (`upstream`). Never push to `upstream` directly.
- **Taking a task.** The tasks are the tables in `.claude/findings/NOW.md` § Next. Put your name in a task's Owner cell in your branch's first commit and open a draft pull request at once, so two people never take the same task. The rules for editing `NOW.md` without merge conflicts are at the top of that section.
- **Before you open a pull request:**
  1. The checks in step 3 pass, and `npm run smoke` (with `npm run dev` running) shows 0 fail. GitHub runs these on every pull request too (`.github/workflows/checks.yml`).
  2. Docs whose facts you changed are updated (`docs/README.md` says which file owns which fact).
  3. A decision you made is in `docs/decisions.md`.
- **Decisions.** An ADR starts as "proposed" and becomes "accepted" when its pull request is approved by the team (and the client, for scope or hosting). Write it before the change it decides.
- **Commits.** Say what changed and why. One commit per finished change, after the checks pass.
- **Changing A.** New local and test abilities go in A2. Any other change to A is a decision: write it in `docs/decisions.md` first.
- **Security rules.** Read the root `CLAUDE.md` § Boundaries before touching a handler or a template.
- **Docs.** Each fact has one owner doc (`docs/README.md` has the map). When code changes a fact, update its owner in the same pull request. When a doc and the code disagree, the code wins and the doc gets fixed.
- **Adding a cloud resource.** Follow `.claude/skills/add-cloud-resource/SKILL.md`, even without Claude Code. It lists every place a resource is defined.

### Claude Code

The `.claude/` folder sets up Claude Code for this repo. You do not need it. `.claude/README.md` says what each part does.

## Where to find things

`docs/README.md` maps every fact to the one file that owns it.

## History and license

The previous capstone team (500-MM-3, 2025 to 2026), who built A: Santiago Garza Fuentes (project manager), Hamza Amar, Maitra Patel, Nimna Wiedasa, Syril Jacob and Akshpreet Singh, advised by Lorenzo De Carli, for Devin Atkin at Alberta 2514640 Inc. Their final report is in `docs/old-capstone/`: the cover is dated 2026-04-12, and it was committed on 2026-06-08. Its figures were never committed.

The capstone code is released under the MIT License, copyright 2026 Alberta 2514640 Inc. The full text is at the end of the final report.
