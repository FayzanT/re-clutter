# backend/api

Go Lambdas, one per folder with its own `main.go`. Module `github.com/Alberta2514640/clutter/backend/api`. Code rules: `engineering-conventions`.

Traps:

- **A route is public unless the platform Terraform gives it the JWT authorizer.** `POST /terraform-engine` and `GET /resources` have none today. Never assume a handler is reached only by signed-in users; read its integration in `backend/infra/main.tf`.
- **Membership is not ownership.** `generic` checks that the caller is in the org. Each handler must also check that the project, diagram, run or account id it takes belongs to that org. Several handlers stop at membership today.
- **`ansible/run-task/main.go` is a hand copy of `ansible/shared/runtaskutils`.** The tests cover the shared package, not the deployed copy. Change both, or better, make the handler import the shared package.
- **`terraform-engine/create` is the generator.** Templates come from S3 at run time (`generator/template`), not from the repo, so a template edit is invisible in a cloud environment until the platform Terraform uploads it. Locally the devserver serves the repo's template files directly.
- **Option lists are duplicated.** Runtimes in `terraform-engine/code-upload` (`nodejs24`) and the frontend config panel (`nodejs24.x`) disagree today; regions in `generic` and the frontend disagree. Fix at one owner, do not add a third list.
- **Build scripts list Lambdas by hand.** A new Lambda goes into `build.sh` and `build_linux.sh` (the latter is missing `terraform-engine/code-upload` and `terraform-engine/logs/recent-activity` today).

Owners: Postgres access and queries in `generic/postgresql.go` and `generic/queries.go`; membership in `generic/membership.go`; responses in `generic/responses.go`; regions in `generic/regions.go`; the resource generator interface in `terraform-engine/create/internal/structs.go`.

- **A new route is also a devserver route.** Add it to `backend/devserver/internal/routes/routes.go`; the devserver's test fails until it matches `backend/infra/main.tf`.
- **52 Go files here use CRLF line endings.** Keep them; check `git diff --stat` before committing one.

Checks: `go -C backend/api build ./...`, `vet`, `test` (expected results in `backend/README.md`), then `backend/devserver/dev.sh --backend-only` and `npm run smoke` for any handler change: the smoke test must stay at 0 fail.
