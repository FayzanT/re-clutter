# System B: the adapter layer (planned)

Status: proposed. First written 2026-10-26, revised 2026-10-30 to follow the team's architecture plan (the figures and write-up in `docs/architecture/system-b-team-plan/`). Nothing here is built yet. The decisions it rests on are in `docs/decisions.md`; what exists today is `system-a-as-built.md`; the Patrii facts are in `docs/research/patricloud/2026-10-26-patricloud-research.md`.

## The goal

Expand the Clutter codebase so a diagram can deploy to targets other than AWS: a General (custom) target first, then PatriCloud (our working name for Patrii Cloud) and TierHive, and whatever comes later. There is one standard way for Clutter to talk to any target (the **connector interface**), and one **connector** per target. The people who come after us add connectors without reworking what exists.

The layer has two faces:

- **Outbound:** connectors behind one interface. Adding a target means writing a connector, not editing the core.
- **Inbound:** B's own API, versioned, that Clutter's UI calls and that people and other products can call to use Clutter without learning React Flow, Supabase webhooks or AWS role ARNs.

The inbound half and its standard objects come from a second, independent research run on 2026-10-26 (`docs/research/patricloud/2026-10-26-second-research-run/`), checked against the code by the lead. The outbound half's structure (A, B, connectors, instances) comes from the team's plan.

Clutter owns intent (what the customer wants); targets own resources. Callers talk to Clutter; Clutter talks to targets. A target such as Patrii is not a host for the standard and not a caller: it publishes no inbound plugin and has no diagram, plan or apply resource. A target-side integration that only wants inventory (as Patrii's Lynx DCIM connector sketches) is a read through the same connector.

## Names

| Name | Means |
| --- | --- |
| **C** | the whole Clutter app: A + A2 + B |
| **A** | Clutter as it exists today: the AWS system, complete and tested (`system-a-as-built.md`) |
| **A2** | the extension that makes A run and test without AWS (`backend/devserver`); it wraps A and does not change it (ADR-011) |
| **B** | the adapter layer we are building |
| **B1** | B shipped as a self-hosted, separate service people can run and use. Its connectors are entity connectors. |
| **B2** | B run internally inside a company's own setup, not hosted by us. Its connectors are instance connectors. |
| **X1 … Xn**, or **1 … n** | connectors, one per target type (PatriCloud, General, TierHive) |
| **entity connector** | a connector for a target type, written once by us (B1) |
| **instance connector** | a connector a company builds or configures for its own setup (B2) |
| **I1 … In** | an instance: one company's configured setup of a connector (credentials, region, workspaces) |
| **workspace** | a deploy environment inside an instance (for example "prod") |
| **a … n** | the standard features every connector maps onto (compute VM, object storage, config runner, serverless function, …) |
| **project**, **diagram** | as in A: a project holds diagrams; B adds a target field to the project |

A cloud's own word for its tenant (Patrii and OpenStack call it a project) is never used for a Clutter object in B's code; it is a connector-side field such as `patrii_project_id`.

## Level 1: how B attaches to A

| Option | What it is | Status |
| --- | --- | --- |
| 1. Build B next to A | A stays as it is. B is a new, separate part of the same app, backend services and frontend screens, with its own tests. Connectors plug into B. | **Main priority** (ADR-006) |
| 2. B reuses parts of A | Same structure, but B calls existing A code instead of copying it. `backend/api/generic` (responses, Postgres access, the membership check) and the JWT sign-in are the candidates. | Fallback |
| 3. Turn A into the adapter | Edit A, strip its AWS-only parts, split the Terraform engine, migrate the database. AWS becomes one more connector. | Avoid as a starting move; reachable later, piece by piece |

Why Option 1: A is a working application, and every change to it means retesting every AWS path. Leaving A alone keeps that work safe, and puts all new work and tests in B.

The trade-off of Option 2: once B depends on parts of A, a change there can break B. A shared piece needs its own tests before B calls it.

### The seams: where B touches A even in Option 1

These are unavoidable and named here so that Option 1 does not drift into Option 2 without a decision:

1. **The UI target choice.** A new screen asks where a diagram deploys: AWS goes to A's existing screens, Custom goes to B's new target screens.
2. **Shared sign-in and the JWT authorizer.** Users sign in once. B verifies A's JWT.
3. **The shared database.** Orgs, projects and diagrams stay A's tables. B adds a target field on projects and new tables for targets, instances and credentials.
4. **A's security defects.** B inherits A's sign-in, its database and its membership check, so the defects in `.claude/findings/NOW.md` that sit on those paths are B's defects too. Fixing them is the one change to A's behaviour this plan requires (phase 0). The open generation endpoint and the database's row-level security are the two that touch shared paths directly.

Any other change to A is a decision, recorded in `docs/decisions.md` before it is made.

## Level 2: inside B

### B1 or B2

Users pick B1, A (AWS) or B2. B1 is built first: it needs nothing we do not have. B2 needs information we do not have yet: how targets such as TierHive and PatriCloud work inside the companies that use them. The same connectors serve both; in B2 they become instance connectors that each company owns.

### Standard features, connectors and instances

Each connector declares, per standard feature, how it treats it. This is the capability manifest (ADR-001).

| Treatment | Meaning | Example (an Acme TierHive instance) |
| --- | --- | --- |
| as-is | the feature maps straight across | a: compute VM, b: bucket |
| extended | the feature exists, with more for this connector or instance | c: config runner plus a custom image |
| removed | the feature does not apply | d: no serverless functions |
| new | something only this target or instance has | e: GPU node |

Shared behaviour lives in the standard features. Differences live in the connector or the instance, never in the standard set. The UI hides what a target cannot do instead of failing at deploy time.

The first standard features come from A's real resource types: compute VM (EC2 today), object storage (S3), config runner (Ansible over SSM), serverless function (Lambda). DynamoDB and API Gateway follow as features only connectors that have them declare.

Principles carried from the first design:

1. **Capability-based, not lowest common denominator.** A common-denominator model would remove Lambda, API Gateway and DynamoDB from every user to make room for a target that lacks them.
2. **Target-native nodes first.** A node is "Patrii VPS" or "AWS EC2" under the standard feature it maps to. Generic nodes that deploy unchanged to several targets can come later, once two connectors exist to learn from.
3. **One owner per resource definition.** The connector's manifest, in Go, is the single source. B's catalog route, palette and config panel read it; nothing is maintained beside it. (A's five-place drift is not repeated in B.)
4. **B's core never names a connector.** It asks the registry for the project's target and calls the interface. A `switch target` in the core is a defect.
5. **Credentials are the connector's shape, stored B's way.** Each connector declares its credential schema and how to verify it. B stores a reference to an encrypted secret, never the secret in a plain column, and never logs it.
6. **State lives with the target where it allows it.** For Patrii, Terraform state for a customer's diagram belongs in that customer's object storage, with locking, not in Clutter's US bucket.

## Level 3: how B works

### Parts

| Part | Job |
| --- | --- |
| B API | B's own Go service and routes; the inbound standard (below) |
| Translator | turns the stored diagram into a neutral graph not tied to AWS |
| Capability check | compares the graph with the chosen connector's manifest and flags unsupported pieces before anything runs |
| Job runner | queues the job, tracks status and logs, as A does today |
| Connector interface | the one contract every connector implements |
| Connectors 1 … n | talk to PatriCloud, General, TierHive and future targets |
| Shared Postgres and S3 | A's orgs, projects and diagrams, plus B's target, instance and credential tables |

### One deploy through B

1. The user clicks Deploy and picks a target instance (for example Acme's TierHive).
2. B API sends the diagram to the translator.
3. The translator builds the neutral graph and runs the capability check.
4. The result comes back: OK, or the unsupported pieces.
5. B API queues the job (status QUEUED).
6. The job runner calls the connector: validate, then plan.
7. The connector applies on the target, creating the VM, bucket and so on.
8. The target returns status and resource ids.
9. The connector returns logs and state to the job runner (status COMPLETED).
10. The UI polls for status, as A does today.

### The connector interface (first cut)

The plan's contract is validate, plan, apply, destroy and logs. The capability manifest and credentials need methods too. A first cut, to be settled in phase 1:

```go
// Package connectors. Each target implements Connector and registers itself.
type Connector interface {
    ID() string                                        // "patrii", "general", "tierhive"
    Manifest() Manifest                                // features (as-is, extended, removed, new), fields, defaults, allowed values
    Credentials() CredentialSpec                       // what an instance supplies, and how the UI asks for it
    VerifyInstance(ctx context.Context, i Instance) error // proves an instance's credentials work before it is saved
    Validate(g Graph, i Instance) []Problem            // refuses unsupported nodes and bad values before anything runs
    Plan(ctx context.Context, g Graph, i Instance, w Workspace) (PlanResult, error)
    Apply(ctx context.Context, g Graph, i Instance, w Workspace) (RunResult, error)
    Destroy(ctx context.Context, i Instance, w Workspace) (RunResult, error)
    Logs(ctx context.Context, run RunRef) (LogStream, error)
}
```

The 2026-10-26 first cut was a `Provider` interface with `Resources`, `Validate`, `Render`, `Regions`, `Credentials`, `VerifyAccount`, `RunnerEnv` and `StateBackend` (in git at commit `7b49222`). `Resources` became `Manifest`; `Render`, `RunnerEnv` and `StateBackend` moved inside the shared Terraform runner that `Plan` and `Apply` use; `Regions` moved into the manifest.

How a connector does plan and apply is its own business, but most should share one way (ADR-002): render HCL for an existing Terraform provider and hand it to a shared Terraform runner that holds state with a lock. Plan, apply, state and drift then stay in Terraform, as in Terraform's own core and provider split, and Clutter does not create resources through cloud APIs itself. A connector calls a target's API directly only when that target has no Terraform provider and no standard API (see Patrii Path C). Remote configuration (A's Ansible over SSM) is not in the first cut: Patrii and most non-AWS targets have no SSM equivalent, so the config runner feature waits for a choice between cloud-init at boot, SSH through a bastion, or a pull agent.

What each part replaces in A, for the day AWS moves into B (Option 3, later):

| B part | Replaces in A |
| --- | --- |
| `Manifest` | the type constants, the label switch, the seed rows, the palette list and the config panel option lists |
| `Validate` | per-generator `ValidateVariables`, plus the input validation that is missing today |
| plan and apply through the Terraform runner | the generator files, the template prefix, IAM from edges, the fixed `provider "aws"` block |
| `Credentials`, `VerifyInstance` | the CloudFormation link and role-ARN handlers, which store the ARN unverified |
| instance credentials into the runner | the role ARN and external id passed to the deployer, and the STS step in its script |
| the runner's state backend | the local state file synced to S3 without a lock |
| the region list in the manifest | the region list in `generic`, the schema enum and the frontend's own list |

## The inbound standard: B API

### Principles

1. **Clutter's model is the contract.** Callers send intent; connectors turn it into each target's resources. A caller never sends an ARN, a Terraform block or a target's API path as the standard's vocabulary.
2. **Every caller resolves to a member.** A service credential is a new way to mint an identity that still passes the one membership check (`CheckOrganizationMembershipPSQL`), never a bypass of it. Google sign-in stays one client of the same rule.
3. **Compile and run are one authenticated sequence.** A public webhook that compiles, and a diagram save that does not (as in A), cannot be the contract.
4. **B API is the only versioned surface.** `/v1`, one error envelope, one id style, an idempotency key on every create. Neither A nor Patrii has idempotency today, and Patrii's own changelog records a retried create starting duplicate billable servers.
5. **A's trust boundary is not standardized.** The admin-sized customer role and the open compiler are fixed before any other product is invited in.

### The objects

| Object | What it is | In A today |
| --- | --- | --- |
| Organization | the tenant | organization CRUD; the creator is the only member; no invite route (the frontend members API is a mock) |
| Project | holds diagrams; B adds its target | project CRUD; name column 32 characters while the API schema allows 100 |
| Desired state | the diagram, as a neutral graph the standard translates to and from the canvas document | diagram CRUD; save does not compile |
| Target | a connector type (X), with its manifest | none: AWS is implicit |
| Instance | one configured setup of a target (I), with a credential reference and region | the AWS-named role table and its two-step CloudFormation link |
| Workspace | an environment inside an instance | none |
| Run | validate, plan, apply or destroy; one resource to poll, events to subscribe to | Terraform runs in `diagram_deployment_logs`, Ansible in `jobs`: two tables, polled logs, no events |
| Catalog | the features a target accepts, read from its manifest | the seed table, the generator switch and the config panel: three lists that drift |

Not in the standard until a handler exists: member invites and roles, token refresh and revoke, and diagram history (A writes it, never exposes it).

### Where B runs

B1 is a service other people can run, so it cannot depend on Clutter's own API Gateway and Lambdas. The default is one Go service in a container that runs anywhere: hosted by us next to A, or self-hosted. The Terraform runner is a second process that sits where it can reach the target and the state; whoever runs it holds the target credentials and the state. Hosting moves custody, not the contract (ADR-004).

## The connectors

### General (custom)

Built first, in phase 1, because it needs no partner. Its meaning is still open (question 2 below). The default proposal has two modes:

- **Terraform with a named provider:** the instance names a Terraform provider and supplies its credentials, and the manifest exposes the resources of that provider the team chooses to support.
- **Existing hosts:** the instance is a list of hosts the customer already has, reached over SSH (through a bastion where needed), and the config runner feature runs Ansible against them. This is also how a TierHive or Patrii server created by hand is used before those connectors exist.

### PatriCloud

Patrii does not yet publish a documented customer API: its REST API docs and its own Terraform provider are both "coming soon", and no public OpenStack endpoint was found. `api.patrii.cloud` is live and serves the console (bearer session tokens, project-scoped API keys, unversioned paths such as `/compute/servers`), but with no OpenAPI file and no version to pin. The homepage promises "full API compatibility" with Terraform and Ansible but never names Nova, Neutron or Keystone. There are three paths, and the choice is open (ADR-003):

- **Path A (preferred):** Patrii exposes public OpenStack endpoints (Keystone v3 with application credentials, Nova, Neutron, Cinder, Octavia, Designate) and an S3 endpoint. The connector emits `terraform-provider-openstack` HCL and uses a Keystone application credential with access rules and an expiry as the instance credential. This is the most standard path and also works for any other OpenStack cloud.
- **Path B:** Patrii ships its `patrii/patrii` Terraform provider. The connector emits that provider's HCL and uses a Patrii project API key.
- **Path C:** the connector calls the console's REST API directly (the second research run's recommendation). It works today, but the write schemas are not in the console bundle and would have to be captured from a real console session, and any console release can break it. If chosen, it needs idempotency on Clutter's side and a contract test suite run against a Patrii test project, and the connector loses Terraform's plan, state and drift handling (ADR-002).

The lead's recommendation is to ask Patrii first and build Path A or B; Path C only if Patrii confirms its REST API will be the supported surface and publishes its OpenAPI file. What would change this: Patrii stating that OpenStack endpoints will never be public and no Terraform provider is planned.

First Patrii features, once there is an API: compute VM (server with keypair, security group, floating IP, cloud-init), network and router, block volume, object storage bucket. Load balancer, DNS and managed databases follow. Serverless function, API Gateway and DynamoDB have no Patrii equivalent and are marked removed in the Patrii manifest.

### TierHive

TierHive (KernelKeepers LTD) is an alpha hourly NAT VPS host with no public API, CLI or Terraform provider today; the operator says the API ships with its beta, "later in 2026 or early 2027" (`docs/research/tierhive/2026-10-30-tierhive-research.md`). A TierHive connector waits for that API. Until then, a TierHive VPS the customer created by hand is reachable through the General connector as an existing host over SSH. Its manifest, when built: compute VM as-is, config runner over SSH, load balancer new, object storage and serverless removed.

### AWS

Stays in A. It moves into B as a connector only later and piece by piece (Option 3 as a destination), once B's interface has proven general enough for it.

## Build order

| Phase | Work | Done when |
| --- | --- | --- |
| 0. Make the seams safe | Authenticate `POST /terraform-engine` and make save-then-compile one authenticated sequence; validate and escape every value that reaches a template; ownership checks on every child id; row-level security or a closed Data API on the database; set the Google client id on log-in so it rejects tokens minted for other apps; narrow the customer role; verify a role before storing it; a lock on state. Make `go test ./...` green offline and add Go build, vet and test to CI. | The open defects in `.claude/findings/NOW.md` that touch shared paths are closed with tests, and CI fails on a Go break. |
| 1. Connector interface, B1 skeleton, General connector | B's Go service with `/v1` (one error envelope, idempotency keys on every create, one run resource, service credentials that resolve to a member), sign-in through A's JWT, the target, instance and credential tables plus the project target field, the translator, the capability check, the job runner with a shared Terraform runner, the target choice screen, and the General connector. | A diagram deploys through B and the General connector to a test target and destroys cleanly; another program can do the same with a service credential; A's AWS path is untouched and still works. |
| 2. Entity connectors | PatriCloud (Path A or B, depending on Patrii's answer) and TierHive. Manifest, credential verify, state in the target's own storage where it has one. | A diagram with a VM, network and volume deploys to a Patrii test project and destroys cleanly; the same for TierHive. |
| 3. B2 and instance connectors | Once partner details exist. | Decided with the client, recorded as an ADR, before work starts. |
| Later, optional. AWS into B | Move AWS behind the connector interface piece by piece. | Generated HCL for a set of fixture diagrams is byte-identical before and after each piece. |
| Hosting model | SaaS on AWS, hosted on Patrii, or self-hosted B1 (ADR-004 holds the default). | Decided with the client, recorded as an ADR. |

## Questions that block or shape the plan

The open questions, each with its default, are kept in one list: `.claude/findings/NOW.md` § Open questions. Questions 1 to 6 and 8 there shape this design; for Patrii, also the five questions at the end of `docs/research/patricloud/2026-10-26-patricloud-research.md`.
