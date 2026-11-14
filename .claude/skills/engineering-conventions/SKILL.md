---
name: engineering-conventions
description: The code rules for the Clutter repo - Go Lambdas, the Terraform generator and templates, the runner images, the Next.js frontend, the SQL schema. Tenancy checks, input escaping into generated code, one owner per fact, verify before done, git discipline. Fire before writing or changing any code here.
---

# Engineering conventions

The folder `CLAUDE.md` files hold the traps of their own folders. This skill holds the rules that span them. The person's instructions win over both.

## Invariants

1. **Every handler proves the caller may touch every id it takes.** Membership in the org, then that the project belongs to the org, the diagram to the project, the run or account to the org. Use the shared helpers in `backend/api/generic` (membership, project lookups); if one is missing, add it there once rather than inline in one handler. A route without the API Gateway JWT authorizer must say in its Terraform why it is public, and then prove the caller another way (a signed webhook secret, for example).
2. **Input that reaches generated code is validated for its target.** Terraform names: `^[a-z][a-z0-9_-]*$` and a length cap. Enumerated fields (instance type, runtime, region): an allow-list owned once on the backend. Free text inside an HCL string: escaped for HCL (quotes, backslashes, `${` and `%{`). Never pass a canvas value to a shell, an IAM policy or a playbook as raw text. Validate in Go before rendering; the template is not a validation layer.
3. **One owner per fact.** A region list, a runtime list, a resource's fields and defaults each live in one place and everything else reads it. While the five-place resource definition still exists (`add-cloud-resource`), change all five in the same change. Never fork a value into a `_v2` or suffixed copy; change it in place and delete what is no longer read.
4. **Secrets come from the environment or a secret store, are checked non-empty at start-up, and are never logged.** A missing secret fails the cold start loudly, not the first request quietly. Never put a connection string, a token or a credential in an error message or a response.
5. **Errors are returned, not swallowed.** A handler maps errors to the shared response helpers in `generic`; a type assertion on outside data uses the `, ok` form. A panic in a Lambda is a defect.
6. **A changes only at its seams; B's core never names a connector.** New target work goes in B (the adapter layer), beside A, not into A's handlers. A is changed only at the named seams (ADR-006, `docs/architecture/system-b-adapter-layer.md` § The seams) and by the stage 1 work in `docs/architecture/implementation-plan.md`. In B, target logic sits behind the connector interface (`docs/architecture/system-b-adapter-layer.md`); core code never switches on a target name, it asks the connector.
7. **Platform code and customer code are separate.** Code that runs Clutter (platform Terraform, runner images, Lambdas) and code Clutter generates for a customer never share a credential, a bucket prefix or a state file.

## Go

- One Lambda per folder under `backend/api`, each with its own `main.go`; shared code lives in `backend/api/generic` or a feature's `internal/` package. A copy of shared code inside a handler (as `ansible/run-task` has today) leaves the deployed path untested; import the shared package instead.
- `gofmt` runs on write (hook) for new files and files already formatted at HEAD. 52 of A's Go files (87 files in all, root `CLAUDE.md`) use CRLF line endings: keep them as they are and check `git diff --stat` before committing one. `go vet` must stay clean.
- Unit tests sit beside the code (`*_test.go`) or in `backend/api/tests/<area>`. A test that needs live AWS is an integration test: guard it with a build tag or an env check so `go test ./...` stays meaningful offline.
- Add a new Lambda to both `build.sh` and `build_linux.sh`, the platform Terraform and `backend/devserver/internal/routes/routes.go` in the same change (`backend/README.md` § Adding a Lambda or a route).

## Frontend (`frontend/clutter`)

- Next.js 16 App Router and React 19. Check the current docs before using a Next or React API (`ground-before-building`); remembered APIs are often wrong on these majors.
- Server data goes through the feature folders in `src/lib/features/<feature>/` (`api.ts`, `types.ts`, `keys.ts`, `hooks.ts` with TanStack Query; `uiStore.ts` with Zustand for UI state). A new feature follows the same shape (`uiStore.ts` only when it has UI state).
- Types in `types.ts` mirror the Go response structs; change both together.
- Every async surface has its loading, error and empty state.

## Verify before done

Run the checks in root `CLAUDE.md` § Commands for every folder you touched, read the output, and paste the result line in your reply. Pre-existing failures are named as pre-existing; they are never a reason to skip the packages you changed. A check you could not run is reported as not run, with why.

## Git

Never commit, push or open a PR unless the person asks. Hold the change in the working tree until it is whole and green, then one commit on a branch. Commit messages: what changed and why, in neutral language, with no tool or vendor attribution.
