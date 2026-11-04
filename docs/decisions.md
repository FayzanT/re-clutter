# Decisions

One entry per decision (an ADR, architecture decision record): the date, the status, what was decided, why, and what would change it. An entry is "proposed" until its pull request is approved by the team (and the client, for scope or hosting), then "accepted". A superseded entry stays, marked with what replaced it.

## ADR-001: Capability-based provider adapters, not a lowest common denominator (2026-10-26, proposed)

Each cloud provider declares the resource types it supports and the canvas shows only those. Why: Patrii has no serverless, API gateway or managed NoSQL table, and a common-denominator model would remove those from AWS users too. Prior art that works this way: Terraform providers, Crossplane compositions, Cluster API providers. Would change if: the client wants one abstract diagram that deploys unchanged to several clouds.

## ADR-002: Terraform stays the engine for every provider (2026-10-26, proposed)

Adapters emit HCL for an existing Terraform provider; Clutter does not call cloud APIs to create resources itself. Why: plan, apply, state and drift handling are already solved there, and the runner and logs already speak Terraform. Would change if: a target cloud has no Terraform provider and no OpenStack-compatible API.

## ADR-003: Patrii is targeted through public OpenStack APIs first, its own provider second, and never its console's private API (2026-10-26, proposed)

Why: the standard OpenStack Terraform provider and Keystone application credentials are documented and portable to other OpenStack clouds; Patrii's own provider is not released; the console API is undocumented and changes with each build. Contested: the second research run on the same date recommends coding against the console's REST API now (Path C in `system-b-adapter-layer.md`), since it is the only surface that works today and Patrii's homepage never names OpenStack services. Would change if: Patrii states it will not expose OpenStack endpoints and no provider is planned, or publishes an OpenAPI file and calls its REST API the supported surface.

## ADR-004: A stays SaaS on AWS; B is one container that we host or others self-host (2026-10-26, revised 2026-10-30, proposed)

Why: moving A off Lambda and API Gateway is a separate project, and nothing about Patrii requires it before a Patrii connector works. B1 is by definition a service other people can run, which they cannot do with Clutter's API Gateway and Lambdas, so B is one Go service in a container plus a Terraform runner, hosted by us beside A or self-hosted. Keeping instance credentials and state behind the connector interface leaves room to run the runner inside a customer's cloud. The 2026-10-26 version kept the deployer BYOC-ready through `RunnerEnv` and `StateBackend` on a provider interface; those are now the instance credentials and the runner's state backend. Would change if: the client needs Canadian-only hosting of Clutter itself (data residency, CLOUD Act exposure), in which case hosting on Patrii or BYOC moves before phase 3.

## ADR-005: The central standard is a versioned inbound API over Clutter's own model (2026-10-26, proposed)

Other products, and people, call one `/v1` API. It is B API (ADR-006): it sits beside A's handlers, reuses A's sign-in and organization model, and puts connectors behind it. Its objects, revised 2026-10-30 to follow the team's plan: organization, project, desired state, target, instance, workspace, run, catalog (`docs/architecture/system-b-adapter-layer.md`). The 2026-10-26 draft renamed project to workspace; that rename is dropped, because the plan uses workspace for an environment inside an instance. Why: the existing org, project and diagram path with its membership check is sound enough to wrap, while the internal routes are inconsistent (ids in paths and queries, mixed names, no error envelope, no idempotency). Freezing them as the public contract would freeze those gaps. Would change if: the only consumers are Clutter's own frontend, in which case the outbound adapters alone are enough.

## ADR-006: Build B next to A (Option 1), reuse A only at named seams (2026-10-30, proposed by the team)

The adapter layer (B) is new code with its own tests, beside today's AWS system (A), not a rewrite of A. B touches A at four named seams only: the UI target choice, shared sign-in and the JWT authorizer, the shared database (a target field on projects, new target, instance and credential tables), and the security fixes on paths B shares with A. Reusing other A code (Option 2) is the fallback and is decided case by case. Turning A into the adapter (Option 3) is a later destination reached piece by piece, never the first move. Why: A is a complete, tested application, and every change to it means retesting every AWS path. Source: the team's plan in `docs/architecture/system-b-team-plan/`. Trade-off: B duplicates some of A (job tracking, logs) until AWS moves into B. Would change if: B needs so much of A that the duplicated code costs more than A's retest would.

## ADR-007: B1 (self-hosted, entity connectors) first; B2 (internal, instance connectors) later (2026-10-30, proposed by the team)

B1 needs nothing we do not have. B2 needs to know how targets such as TierHive and PatriCloud run inside the companies that use them. Build order: connector interface, B1 skeleton and the General connector; then PatriCloud and TierHive; then B2. Would change if: a partner hands over the details B2 needs, or the client wants B2 first.

## ADR-008: The General connector comes first, and covers targets without an API (2026-10-30, proposed)

General has two modes: Terraform with a provider the instance names, and existing hosts over SSH with Ansible. Why: it needs no partner, and it is the only way to reach TierHive and Patrii today, since neither has a public API (`docs/research/tierhive/2026-10-30-tierhive-research.md`, `docs/research/patricloud/2026-10-26-patricloud-research.md`). Would change if: the client defines General differently.

## ADR-009: A local dev gateway runs System A without AWS (2026-10-30, proposed)

`backend/devserver` runs A's real, unchanged Lambdas on one machine: a gateway on loopback that stands in for API Gateway and the authorizer, Postgres in Docker, and a dev-only sign-in. It never ships and never deploys. It refuses to start with a secret it did not generate, a non-loopback address or a non-loopback database, and every AWS call is refused locally. It has its own Go module, so A's `go.mod` is untouched, and a test fails if its route table drifts from `backend/infra/main.tf`. B's local development reuses it rather than adding a second launcher. Why: A was built to run only in AWS, the capstone account is gone, and deploying A as it is would expose the open security defects; this is the only way to check A, and the seams B touches, without an account or cost. Trade-off: about 2,900 lines of tooling to maintain, and it can differ from real API Gateway (request-model validation is not applied). Would change if: we get a dev AWS account and a deploy pipeline that make a local run unnecessary, or the gateway's behaviour drifts from API Gateway in a way that misleads.

## ADR-010: Preview the existing AWS Terraform locally without deployment (2026-11-04, proposed)

At the user's request, the development canvas adds Preview Terraform for inspecting and downloading `main.tf` and `outputs.tf` from a saved diagram. This is a narrow exception to ADR-006 for local testing of A. The dev gateway authenticates the caller and proves diagram, project and organization membership together before reading the saved layout. A local CLI reuses A's generator with disk templates and preview input escaping. It has no cloud credentials, S3 fallback, file upload, Terraform execution or deployment. The button appears only in a development frontend configured for a loopback API; production deploy and generation remain unchanged. The existing fake account can unlock the canvas, but generation does not use an AWS account id or role. Why: inspecting generated files should not require a cloud account or an AWS deployment. Trade-off: output inherits the existing templates' defaults and limitations and is not a validated deployment plan; preview escaping does not fix the separate production generator defects. Would change if: the production compile API gains an authenticated preview/download workflow, allowing this dev-only endpoint to be retired.
