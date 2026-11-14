# Implementation plan: from the design to a working B0

The order to build `system-b-adapter-layer.md` in, what each stage changes, how it is tested, and when it is done. The design says what B is and why; this file says how it gets built. Each stage's status is in `.claude/findings/NOW.md` § The order. The design was checked before any code on 2026-11-13: an independent review, an AWS template spike and a DevStack test (`docs/research/openstack/2026-11-13-devstack-and-block-mapping.md`).

## How the work runs

- **One implementation branch, `impl/b0`,** cut from `main` once this plan is merged, carries stages 1 to 6. Each stage is reviewed as it lands on the branch (every check, the smoke test, and a fresh reviewer where the next point says), and the branch goes to `main` by one pull request when stage 6 is done. Stage 7 waits for the credentials. After a merge, the fork's `main` goes to the client's repo by pull request.
- A builder writes the stage; the person reviewing runs every check and the smoke test themselves; a fresh reviewer attacks any stage that touches sign-in, tenancy, credentials or generated code. Findings are resolved before merge.
- The person commits, pushes, merges and deploys. No session deploys.
- **The docs move with the code.** Each stage's pull request updates the owner doc of every fact it changes (`docs/README.md` says which), its row in `.claude/findings/NOW.md`, and the folder README's expected results. A stage is not done while a doc still describes the old state.
- A's 87 CRLF files (52 of them Go) keep their line endings (`git diff --stat` before committing).

## Testing without the client's credentials

Nothing waits for the client except stage 7.

| Fully testable on a laptop | How |
| --- | --- |
| A, except real deploys | A2, the smoke test, Go and frontend tests, `terraform validate` |
| B's API, sign-in, tables, connections, credential encryption | B's Go tests, and smoke checks through A2 |
| The connector contract | a mock connector and the shared contract tests, in CI |
| Real OpenStack deploys | General's OpenStack connector against DevStack |
| B's AWS output | `terraform validate`, and the golden test for A's template move |
| The whole editor flow | a browser against A2; AWS deployments stop at the AWS call |
| CloudFormation and IAM | `cfn-lint`, `terraform validate` |

Left for the credentials: real AWS deploys by A and B, the AWS role link end to end, hosting world 1, the client's Google sign-in, and the hosted demo.

## Stage 0: housekeeping

The decisions are recorded (ADR-013 to ADR-017), the design was checked on 2026-11-13, and the questions for the client are in `.claude/findings/NOW.md` § What we need from the client. **Done when:** this branch is merged and the fork's `main` reaches the client's repo by pull request.

## Stage 1: make A safe

- **Phase 0** (`.claude/findings/NOW.md` § Phase 0), in this order: item 6 (Go tests offline, and CI runs every package), 1 (authenticate generation, generic error bodies), 3 (allow-lists and HCL escaping, including `${` and `%{`, through one shared escape function that B reuses), 5 (one shared ownership helper in `generic`), 10 (A's runner gets no database string, one task per run), 2 (row-level security), 4 (the Google audience check), 6b to 6d; items 7 to 9 in code only.
- **A's template code moves out of `internal`** to `backend/api/generic/tftemplate/`, with a loader that reads S3 for A and disk for B and tests. A golden test that renders fixture diagrams from disk is written first, and its output stays byte-identical across the move.
- **JWT verification moves** from the authorizer's `internal` package to `generic`, so A's authorizer and B share one implementation.
- **Region:** the generator's fixed `us-west-2` reads the environment's region (`ca-central-1` in the cloud).
- **Manual cloud steps become code**, so stage 7 is mostly filling in config: the API Gateway stage, the Google client id from configuration, the API address passed into the frontend build, versioned runner image tags, the platform state backend chosen at `terraform init`, and the Supabase webhook replaced by item 1's save-then-generate step.
- **Done when:** every phase 0 item that can be checked locally is done, the golden test passes, smoke is at 0 fail, and CI runs all Go packages.

## Stage 2: a test cloud on the laptop

DevStack in a Lima virtual machine, as in the research note. Proven on one laptop on 2026-11-13. The team gets a short start-and-stop guide with stage 4. **Done when:** the test configuration applies and destroys a VM, network, firewall and volume.

## Stage 3: B's core

- A new Go module, `backend/b` (Go 1.25.3, `require` plus `replace ../api` to import `generic`): one HTTP server with a connection pool.
- Tables in a new idempotent `backend/storage-sql/b-tables.sql`: connections (organization, type, name, region, status, secret reference, role-template version), deployments (diagram, connection, settings, exclusions, status), runs (deployment, action, status, diagram history version, times, log key). Loaded by A2 as `30-b-tables.sql` and applied by B at start-up.
- Sign-in through `generic`'s JWT verification. Every deployment action checks that the caller is a member of the organization, and that the diagram and the connection belong to it.
- The `connectors` package: the interface from the design doc (taking a `Deployment`), a registry, a mock connector, and the shared contract tests.
- The translator, the capability check (with per-deployment exclusions), the job runner, the isolated run task (ADR-017), the Terraform runner (state per deployment, locked), and the credential store (a local key in A2; Secrets Manager in the cloud).
- API `/v1`: connections (create, verify, list, delete), deployments (create, compatibility), runs (plan, apply, destroy, status, logs), catalog (manifests). Deletes refuse while deployments are live.
- A2: B on `127.0.0.1:8790`, started and stopped by `npm run dev` and `npm run stop`; smoke gains B checks. A's route table and its test are untouched.
- CI: vet and test `backend/b`.
- **Done when:** the mock connector passes the contract tests in CI, a run moves through queued, running and completed with logs, a cross-tenant test is refused, and smoke is at 0 fail.

## Stage 4: General's OpenStack connector

The manifest (VM, network and subnet, firewall, volume; bucket, function, table and HTTP API marked removed), the credential spec (an application credential, or `clouds.yaml` fields), verification by a Keystone token request, rendering for `terraform-provider-openstack` `~> 3.4`, and plan, apply, destroy and logs through the shared runner. B's runner needs a route to DevStack (Lima port forwarding, or the runner inside the same VM). **Done when:** a building-block diagram deploys to DevStack through B and destroys cleanly.

## Stage 5: the AWS connector

A's five templates (a main and an outputs file each), unchanged, through `generic/tftemplate`; three new templates (network, firewall, volume), uploaded by the platform Terraform like the others; small override files where a template lacks an input; B's own edge-to-IAM step; the deployment id in Terraform addresses and cloud-side names; A's role table read as AWS connections; and the CloudFormation template trusting B's runner role too. A test renders A's files from disk and runs `terraform validate`, so a change to A's templates that breaks B fails in CI. **Done when:** the same diagram's AWS deployment validates locally; it deploys and destroys in stage 7.

## Stage 6: the frontend and the whole flow

- B's own editor, chosen at the page level: a diagram whose saved document has `engine: "blocks"` opens it; any other diagram opens A's editor, unchanged.
- New feature folders for connections, deployments and the catalog, with `NEXT_PUBLIC_B_API_ENDPOINT`.
- The Connections page, the building-block palette and forms from manifests, and the deploy panel with one row per deployment (compatibility, exclusions, preview, deploy, destroy, status, logs). "New diagram" creates a building-block diagram.
- A's nodes, labels, image paths and account gate stay as they are. Locally, A2 answers B's AWS verification with a stub, as it does for A.
- **Done when:** the local demo below runs end to end.

## Stage 7: the cloud

The platform Terraform adds B's container on Fargate, its own cluster and runner role, and Secrets Manager access; the person applies it with `npm run deploy -- prod` (`environments.md`). **Done when:** the 12-step test in `environments.md` and the demo in `system-b-adapter-layer.md` § What the user sees both pass in the cloud.

| Credentials day, after stages 1 to 6 | Time |
| --- | --- |
| Fill in the ignored files (`prod.tfvars`, `prod.backend.hcl`, the frontend's `.env.local`) and sign in to AWS | under an hour |
| Console tasks no repo can do: the Google client, DNS, the second AWS account | an hour or two |
| Bootstrap the state bucket, plan and deploy, push the images, load the schema | about two hours |
| Link the test AWS account; start a DevStack VM for demos | under an hour |
| Run the tests and the demo, and fix what the first real run finds (most likely permissions and settings) | a day, maybe more |

## Stage 8 and later

Patrii as an OpenStack connection when it opens; DigitalOcean as the second General connector; General's existing-servers mode (`general-ssh`) once the config runner is chosen; TierHive when it has an API; the optional Clutter sandbox connection; blocks across clouds in one diagram; B1, then B2; retiring A's own AWS flow. Live collaboration is another team's work, on the stable diagram document.

## What runs locally when stages 1 to 6 are done

`npm run dev` starts Postgres, A (through A2), B and the website; DevStack runs in its own VM. In the browser:

1. Sign in.
2. **Connections:** add the local fake AWS account and DevStack's OpenStack; both show as verified.
3. **New diagram:** drag in a VM, network, firewall, volume, bucket and function, and connect them.
4. **Deploy panel:** "AWS: ready"; "OpenStack: 2 blocks not supported (bucket, function)", which the user leaves out of that deployment.
5. **Preview Terraform** for each deployment.
6. **Deploy to OpenStack:** live status and logs; the VM, network and volume appear in DevStack; **Destroy** removes them.
7. **Deploy to AWS:** valid Terraform is rendered, and the run stops at the AWS call with a clear "needs a real AWS account" message.
8. Old AWS diagrams open in A's editor and work as before.

From the terminal: `npm run smoke` (A and B, 0 fail), every Go and frontend test, the contract tests and the golden test.
