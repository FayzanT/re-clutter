# Docs map

Each kind of fact has one owner. Change a fact at its owner, in the same change as the code that moved it. When a doc and the code disagree, the code is true and the doc is fixed.

| Fact | Owner |
| --- | --- |
| How agents behave in this repo | `CLAUDE.md` (root and per folder) |
| What each part of the Claude Code setup does | `.claude/README.md` |
| Code rules | `.claude/skills/engineering-conventions/SKILL.md` |
| What exists today (System A): how it runs, what stands in for AWS locally, what changed since the capstone, what it can and cannot do | `docs/architecture/system-a-as-built.md` |
| Onboarding: what Clutter is, the setup sequence for a new person, what not to run | root `README.md` |
| Running A locally; what works locally and what only works in AWS | `backend/devserver/README.md` |
| Backend layout, checks and their results, A's Go and shell lint, adding a Lambda | `backend/README.md` |
| Frontend layout, run variants, checks and their results, browser results | `frontend/clutter/README.md` |
| The generator's internals | `backend/api/terraform-engine/create/README.md` |
| What differs between local, dev and prod, what works where, and how to set up a cloud environment | `docs/architecture/environments.md` |
| What we are building (System B, the adapter layer), its names and its phases | `docs/architecture/system-b-adapter-layer.md` |
| The team's A/B plan as the team wrote it (Options 1 to 3, B1 and B2, figures and explanation) | `docs/architecture/system-b-team-plan/` (source material; `system-b-adapter-layer.md` owns the plan from here on) |
| The second research run on Patrii and Clutter (2026-10-26) | `docs/research/patricloud/2026-10-26-second-research-run/` (source material, folded into the docs above) |
| What was decided, and why | `docs/decisions.md` |
| Outside research (cloud providers, prior art, law) | `docs/research/<target>/<date>-<topic>.md` (`patricloud/`, `tierhive/`) |
| Where the current work stands, open defects | `.claude/findings/NOW.md` |
| A resource's fields and defaults | in A, the generator code (and, drifting from it, the seed SQL and the config panel); in B, each connector's manifest |
| The previous capstone team's design and course deliverable | `docs/old-capstone/`: `final-report.pdf` and `.md` (same report; cover dated 2026-04-12, committed 2026-06-08; history, not current; its figures were never committed) and `backend-tutorial.md` (the capstone's backend guide) |
