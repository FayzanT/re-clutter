# Clutter architecture for an external adapter

Scope is the code in this repository as it existed on 2026-10-26. README claims are cited only where they were checked against handlers or Terraform. No string `PatriCloud` appears in the repo. The PDF was not text-extracted.

## What is the public HTTP API?

### Takeaway
API Gateway REST (regional, name `clutter-api`) exposes about 31 methods, one Lambda per method, with no `/v1` prefix and no `aws_api_gateway_deployment` or `aws_api_gateway_stage` in this Terraform. Almost every method uses the custom JWT authorizer. Three do not: `POST /log-in`, `GET /resources`, and `POST /terraform-engine`. IDs are path params for organizations and accounts, query params for projects, diagrams, and logs.

### Cited Findings
- Gateway resource, REQUEST authorizer on header `Authorization`, authorizer result TTL 0, body-only request validator: [backend/infra/modules/api-gateway/main.tf](../../../../backend/infra/modules/api-gateway/main.tf). Method auth is `CUSTOM` only when `jwt_authorizer_id` is set, otherwise `NONE`: [backend/infra/modules/templates/api-lambda-integration/main.tf](../../../../backend/infra/modules/templates/api-lambda-integration/main.tf).
- Paths and methods are declared in [backend/infra/main.tf](../../../../backend/infra/main.tf) (path modules from about line 809, integrations from about line 1214). A search of `backend/infra` found no `aws_api_gateway_stage` or `aws_api_gateway_deployment`.
- Every JSON response from `generic.Response` sets `Access-Control-Allow-Origin: *` and allows `Content-Type,Authorization`: [backend/api/generic/responses.go](../../../../backend/api/generic/responses.go).
- Frontend clients call the same paths via `NEXT_PUBLIC_API_ENDPOINT` and send the raw JWT as `Authorization` (no `Bearer` prefix) in [frontend/clutter/src/lib/features/organization/api.ts](../../../../frontend/clutter/src/lib/features/organization/api.ts), [frontend/clutter/src/lib/features/projects/api.ts](../../../../frontend/clutter/src/lib/features/projects/api.ts), [frontend/clutter/src/lib/features/diagram/api.ts](../../../../frontend/clutter/src/lib/features/diagram/api.ts), [frontend/clutter/src/lib/features/logs/api.ts](../../../../frontend/clutter/src/lib/features/logs/api.ts), [frontend/clutter/src/lib/features/runs/api.ts](../../../../frontend/clutter/src/lib/features/runs/api.ts), [frontend/clutter/src/lib/features/codeUpload/api.ts](../../../../frontend/clutter/src/lib/features/codeUpload/api.ts), [frontend/clutter/src/lib/features/user/api.ts](../../../../frontend/clutter/src/lib/features/user/api.ts), [frontend/clutter/src/lib/features/resources/api.ts](../../../../frontend/clutter/src/lib/features/resources/api.ts).
- README table says every route except login is authenticated, says `POST /terraform-engine` is auth Yes, says the runner supports plan, and says account link is `POST /organization/{id}/accounts` without `{accountId}`: [README.md](../../../../README.md) around lines 311–343. The Terraform integrations contradict the auth and path claims.

Routes that exist as Lambda integrations (method, path, auth, body or query):

| Method | Path | Auth | Request shape (code) | Notes |
|---|---|---|---|---|
| POST | `/log-in` | none | `{ "token": "<Google ID token>" }` schema [log-in.json](../../../../backend/infra/modules/templates/api-models/schemas/log-in.json) | 201 `{ message, token, exp, user_data }`. Handler `log-in` `handler` |
| GET | `/cloudformation-stack-url/{organizationId}` | JWT | query `accountName` required, `region` optional | 200 `{ message, data: { account_id, url } }`. Handler `stack-url-generator` `handler` |
| POST | `/organization` | JWT | `{ organizationName, description? }` [organization-create.json](../../../../backend/infra/modules/templates/api-models/schemas/organization-create.json) | Creates org and inserts caller as the only member |
| GET | `/organization` | JWT | none | Lists orgs for the caller |
| PUT | `/organization/{organizationId}` | JWT | `{ organizationName? , description? }` [organization-update.json](../../../../backend/infra/modules/templates/api-models/schemas/organization-update.json) | |
| DELETE | `/organization/{organizationId}` | JWT | none | |
| GET | `/organization/{organizationId}/accounts` | JWT | none | Membership-checked |
| POST | `/organization/{organizationId}/accounts/{accountId}` | JWT | `{ "role_arn": "arn:aws:iam::123456789012:role/AllowClutterToDeployTerraformRole-<8 chars>" }` [organization-submit-account-role-arn.json](../../../../backend/infra/modules/templates/api-models/schemas/organization-submit-account-role-arn.json) | Completes a row created by the URL endpoint |
| DELETE | `/organization/{organizationId}/accounts/{accountId}` | JWT | none | |
| POST | `/project` | JWT | `{ organizationId, name, description? }` [project-create.json](../../../../backend/infra/modules/templates/api-models/schemas/project-create.json) | JSON `name` maxLength 100; SQL column is `VARCHAR(32)` |
| GET | `/project` | JWT | query `organizationId` required, `projectId` optional | [project/get/main.go](../../../../backend/api/project/get/main.go) `handler` |
| PUT | `/project` | JWT | query `projectId`; body same schema as create, including `organizationId` and `name` | [project/update/main.go](../../../../backend/api/project/update/main.go) |
| DELETE | `/project` | JWT | query `organizationId` and `projectId` | [project/delete/main.go](../../../../backend/api/project/delete/main.go) |
| POST | `/diagram` | JWT | `{ projectId, name }` [diagram-create.json](../../../../backend/infra/modules/templates/api-models/schemas/diagram-create.json) | Name pattern is letters, digits, apostrophe, single spaces, max 32 |
| GET | `/diagram` | JWT | query `projectId` required, `diagramId` optional | [diagram/get/main.go](../../../../backend/api/diagram/get/main.go) |
| PUT | `/diagram` | JWT | `{ projectId, diagramId, name?, data?: { nodes, edges } }` [diagram-update.json](../../../../backend/infra/modules/templates/api-models/schemas/diagram-update.json) | `data.nodes` and `data.edges` are untyped arrays at the gateway |
| DELETE | `/diagram` | JWT | query `projectId` and `diagramId` | [diagram/delete/main.go](../../../../backend/api/diagram/delete/main.go) |
| POST | `/terraform-command-runner` | JWT | `{ organizationId, projectId, diagramId, command, accountAccessRoleId?, region? }` [terraform-command-runner.json](../../../../backend/infra/modules/templates/api-models/schemas/terraform-command-runner.json) | `command` enum is only `apply` or `destroy`. `accountAccessRoleId` is not required by the schema. 200 `{ message, data: { commandId, taskArn } }` |
| GET | `/terraform-engine/logs` | JWT | query `orgId`, `projId`, `diagramId` | |
| GET | `/terraform-engine/logs/url` | JWT | query `orgId`, `projId`, `diagramId`, `deploymentId`, `file` | Returns a URL |
| GET | `/terraform-engine/logs/live` | JWT | query `orgId`, `projId`, `diagramId`, `taskArn`, optional `nextToken` | |
| GET | `/terraform-engine/logs/recent-activity` | JWT | query `orgId`, `diagramId` | |
| POST | `/terraform-engine/code-upload/presigned-url` | JWT | `{ org_id, project_id, diagram_id, lambda_resource_name, runtime }` | Runtimes hard-coded in `runtimeHandlers` in [code-upload/main.go](../../../../backend/api/terraform-engine/code-upload/main.go). No API Gateway model |
| POST | `/terraform-engine` | none | Supabase-shaped `{ type, table, schema, record, old_record }` | [terraform-engine/create/main.go](../../../../backend/api/terraform-engine/create/main.go) `handler`. CORS module also lists GET, but no GET integration exists |
| POST | `/ansible/jobs` | JWT | `{ account_access_role_id, target_instance_ids, playbook_id \| playbook_s3_key, config_id?, extra_vars? }` [ansible-job-submit.json](../../../../backend/infra/modules/templates/api-models/schemas/ansible-job-submit.json) | 202 `{ message, data: { job_id, status: "QUEUED" } }` |
| GET | `/ansible/jobs` | JWT | optional query `status`, `job_type` | Filtered by `created_by`, `LIMIT 50`. Not wrapped by the frontend `runsApi` |
| GET | `/ansible/jobs/{jobId}` | JWT | none | |
| GET | `/ansible/jobs/{jobId}/logs` | JWT | none | Not wrapped by `runsApi` |
| POST | `/ansible/playbooks/upload-url` | JWT | `{ file_name, project_id, diagram_id }` [ansible-playbook-upload-create.json](../../../../backend/infra/modules/templates/api-models/schemas/ansible-playbook-upload-create.json) | Caller then PUTs the file to S3 |
| GET | `/user-information` | JWT | none | |
| GET | `/resources` | none | none | Reads `supported_resources`. Frontend calls it with no token |

`ansible-run-task` is not an HTTP route. It is an SQS event source on queue `ansible_jobs`: [backend/infra/main.tf](../../../../backend/infra/main.tf) `aws_lambda_event_source_mapping.ansible_sqs_trigger`.

### Inferences
- A non-browser client can call the JWT routes if it already holds a Clutter JWT. It cannot discover a versioned contract: there is no OpenAPI document, only per-route JSON models, and several routes (logs, code upload, resources, account list) have no model at all.
- `POST /terraform-engine` is a public compiler. Anyone who can reach the stage can POST a diagram record and write Terraform into the Clutter S3 layout `{org}/{project}/{diagram}`.
- README “~31 endpoints” matches the integration count if login, resources, and the four Ansible reads/writes are included. The README auth column does not match the Terraform.

### Gaps
- The deployed stage name and base URL are not in this Terraform. `NEXT_PUBLIC_API_ENDPOINT` is an env var, not a path prefix in code.
- Exact success JSON for organization, project, and diagram create/update was not copied field-by-field from every handler. Frontend types assume `{ data: ... }` via `ApiEnvelope`. Login does not use that envelope.
- PDF partner decisions were not extracted.

## What is the domain model and where is it enforced?

### Takeaway
The durable model is a Postgres schema of users, organizations, binary membership, AWS role rows, projects, React-Flow-shaped diagrams plus history, deployment-log rows, jobs, and playbooks. Enforcement is split: column constraints in SQL, a second catalog table in a seed script, per-Lambda checks, and a UI that treats the diagram as a canvas. There is no role column and no organization id on jobs.

### Cited Findings
- Tables in [backend/storage-sql/application-tables.sql](../../../../backend/storage-sql/application-tables.sql):
  - `users`: id, unique email, full_name, picture_url.
  - `organizations`: id, name `VARCHAR(32)`, description `VARCHAR(300)`, `created_by`, unique `(created_by, name)`.
  - `organization_members`: `(organization_id, member_id)` only. No role, no invite state.
  - `aws_account_access_roles`: id, organization_id, `unique_id VARCHAR(8)`, `account_name VARCHAR(32)`, nullable `role_arn`, `external_id VARCHAR(36)`, status check `incomplete | complete | revoked`.
  - `projects`: id, organization_id, created_by, name `VARCHAR(32)`, description `VARCHAR(300)`, unique `(organization_id, name)`.
  - `diagrams`: id, project_id, name `VARCHAR(32)`, `data JSONB NOT NULL`, latest_update_by/at. Unique `(project_id, name)`.
  - `diagram_history`: `(diagram_id, version)` primary key, name, data, comment.
  - `diagram_deployment_logs`: `(diagram_id, command_id)`, command enum `apply | destroy`, status `RUNNING | SUCCESS | FAILED`.
  - `jobs`: id, `job_type` `ansible | terraform`, status `QUEUED | STARTING | RUNNING | COMPLETED | FAILED`, `created_by` nullable, ansible fields, terraform fields including `role_arn` and `assume_role_external_id`. No `organization_id`.
  - `playbooks`: id, diagram_id, org_id, project_id, file_name, s3_key, uploaded_by.
- `supported_resources` is not in `application-tables.sql`. It is created and seeded in [backend/storage-sql/seed-resources.sql](../../../../backend/storage-sql/seed-resources.sql) with labels `Lambda`, `S3`, `DynamoDB`, `API Gateway`, `EC2 Container`, plus a JSON `variables` array. That script enables RLS and a policy granting `anon` all permissions on that table only.
- Diagram JSON shape in Go is a React Flow document: nodes have `id`, `type`, `position`, `data`, optional `variables`, optional `measured`; edges have `id`, `source`, `target`: [backend/api/generic/models_diagram.go](../../../../backend/api/generic/models_diagram.go) `DiagramLayout`.
- Diagram update checks node `id` and `type`, edge `id`, `source`, and `target`, then inserts the previous row into `diagram_history` with comment `"Auto-saved before update"`: [backend/api/diagram/update/main.go](../../../../backend/api/diagram/update/main.go) `handler`. It does not check `data.label` against `supported_resources`.
- Org tenancy for most handlers is `generic.CheckOrganizationMembershipPSQL` in [backend/api/generic/membership.go](../../../../backend/api/generic/membership.go): org must exist (404) and the user must be in `organization_members` (403). Creator is inserted in the same transaction as the org: [backend/api/organization/create/main.go](../../../../backend/api/organization/create/main.go) `handler`.
- There is no HTTP member API. [frontend/clutter/src/lib/features/members/api.ts](../../../../frontend/clutter/src/lib/features/members/api.ts) keeps `MOCK_MEMBERS` in process memory and assigns a string role such as `"Project Admin"`.
- Resource types the compiler accepts are a Go switch, not the seed table: `ParseResourceType` maps `lambda`, `dynamodb`, `s3`, `api gateway` / `api-gateway`, `ec2` / `ec2 container`: [backend/api/terraform-engine/create/internal/generator/resources/mapper.go](../../../../backend/api/terraform-engine/create/internal/generator/resources/mapper.go).
- Two run records exist. Terraform apply/destroy writes `diagram_deployment_logs` inside [backend/api/terraform-command-runner/main.go](../../../../backend/api/terraform-command-runner/main.go) `handler` via `InsertIntoLogTable`. Ansible writes `jobs` and an SQS message in [backend/api/ansible/submit-job/main.go](../../../../backend/api/ansible/submit-job/main.go) `handler`. `jobs.job_type` allows `terraform`, but the HTTP Terraform path does not insert a `jobs` row.
- Job list is `WHERE created_by = $1` plus `LIMIT 50`, not by organization: [backend/api/ansible/list-jobs/main.go](../../../../backend/api/ansible/list-jobs/main.go) `handler`. `BuildJobResponse` returns `role_arn` when present and accepts `assumeRoleExternalId` but does not put it on the map: [backend/api/generic/job_response.go](../../../../backend/api/generic/job_response.go).
- Postgres is not created in the Terraform that was read. Lambdas receive `PSQL_CONNECTION_STRING`. The compiler README still describes Supabase webhooks: [backend/api/terraform-engine/create/README.md](../../../../backend/api/terraform-engine/create/README.md).

### Inferences
- The domain an adapter can rely on is org → project → diagram (JSONB canvas) → AWS role row, plus two execution logs that do not share a schema.
- “Membership” is a boolean. The UI’s roles are not data.
- A diagram save is valid even when the canvas cannot compile. Compilation is a separate, unauthenticated POST.

### Gaps
- Whether production Postgres is Supabase, RDS, or something else is not fixed by a `resource` in the Terraform searched. The connection string is a variable.
- No read of every handler’s SQL was done for delete cascades. The SQL file itself uses `ON DELETE CASCADE` from org down through diagrams and playbooks.

## How is identity done? Is there an API-key or service-account path?

### Takeaway
Identity is Google ID token in, Clutter HS256 JWT out, checked by a Lambda authorizer. There is no API key, no service account, no refresh route, and no second credential type anywhere in the Go, TypeScript, or Terraform that was searched.

### Cited Findings
- `POST /log-in` calls `idtoken.Validate` with `GOOGLE_CLIENT_ID`, looks up `users` by email, inserts or updates name and picture, then signs a JWT: [backend/api/log-in/main.go](../../../../backend/api/log-in/main.go) `handler`.
- JWT claims are `sub`, `email`, `full_name`, `picture_url`, `created_at`, and `exp` 24 hours ahead. Algorithm is HS256 with `JWT_SECRET`: [backend/api/log-in/internal/jwtGeneration.go](../../../../backend/api/log-in/internal/jwtGeneration.go) `GenerateUserJWT`.
- The authorizer reads `Authorization`, parses with `jwt.WithValidate(false)`, then manually checks string claims and `exp`. The comment says “Google ID Token”; the code verifies the Clutter JWT, not Google: [backend/api/authorizer/main.go](../../../../backend/api/authorizer/main.go) `handler` and [backend/api/authorizer/internal/jwtValidation.go](../../../../backend/api/authorizer/internal/jwtValidation.go) `ParseAndVerifyJWTClaims`. Allowed requests put `id`, `email`, `name`, `picture_url`, `created_at` on the authorizer context. Handlers then call `generic.GetUserDataFromAuthorizerContext`.
- Authorizer cache TTL is 0: [backend/infra/modules/api-gateway/main.tf](../../../../backend/infra/modules/api-gateway/main.tf).
- A repo search for `api_key`, `api-key`, `service account`, `Idempotency`, and `x-api-key` in Go, TypeScript, Terraform, and SQL returned no matches.
- The browser stores the JWT in cookie `clutter_token` with `Max-Age` of 7 days and also keeps Google profile JSON in `localStorage` key `google_data`: [frontend/clutter/src/lib/features/user/api.ts](../../../../frontend/clutter/src/lib/features/user/api.ts). The JWT itself expires in 24 hours.
- README’s description of Google validate then JWT issue matches the login Lambda: [README.md](../../../../README.md) around lines 467–471. The same README says the authorizer validates the JWT on every API call, which is false for `GET /resources` and `POST /terraform-engine`.

### Inferences
- PatriCloud, or any other backend, cannot call Clutter as itself. It would have to present a Google ID token for a human who is already an `organization_members` row, then reuse that user’s 24-hour JWT.
- `WithValidate(false)` means library checks for issuer, audience, and `exp` are off. Expiry is checked only in the authorizer after a type assertion to `time.Time`. A bad `exp` type returns an authorizer error instead of a Deny policy.
- Cookie lifetime longer than token lifetime will look like a random 401 to a client that trusts the cookie.

### Gaps
- No measurement of whether API Gateway is configured, outside this repo, with an API key or IAM auth on the stage. This Terraform sets method authorization to `NONE` or `CUSTOM` only.

## How is an AWS account linked, and what runs where?

### Takeaway
Linking is a two-call handshake plus a human click in the customer AWS console. Clutter stores an external id and later a role ARN. Terraform and Ansible execute as Fargate tasks in Clutter’s account; those tasks assume `AllowClutterToDeployTerraformRole-<8 chars>` in the customer account. Generated Terraform and state stay in Clutter S3.

### Cited Findings
- `GET /cloudformation-stack-url/{organizationId}` checks membership, builds stack name `Clutter-<org>-<account>-TerraformDeployerRoleStack-<uniqueId>`, generates `externalId` as a UUID, inserts `aws_account_access_roles` with status default `incomplete` (role ARN null), and returns a CloudFormation console URL. Template URL and Clutter account id come from env `CLOUDFORMATION_TEMPLATE_URL` and `CLUTTER_ACCOUNT_ID`. Region defaults to `generic.DefaultRegion` (`us-west-2`) and must be in `SupportedRegions`: [backend/api/cloudformation/stack-url-generator/main.go](../../../../backend/api/cloudformation/stack-url-generator/main.go) `handler`, [backend/api/generic/regions.go](../../../../backend/api/generic/regions.go).
- The template in-repo is [backend/infra/modules/s3/uploads/client_side_terraform_deployer_role.yaml](../../../../backend/infra/modules/s3/uploads/client_side_terraform_deployer_role.yaml). It creates role `AllowClutterToDeployTerraformRole-${UniqueId}` trusted only by `arn:aws:iam::${AccountId}:role/TerraformDeployerFargateTaskRole` when `sts:ExternalId` matches. The inline policy is `ec2:*`, `lambda:*`, `apigateway:*`, `dynamodb:*`, `s3:*`, `iam:*`, `ssm:*`, `logs:*`, and `iam:PassRole` to `ec2.amazonaws.com` and `lambda.amazonaws.com`.
- `POST .../accounts/{accountId}` sets `role_arn` and `status = 'complete'` only when the row is still `incomplete` and the ARN’s suffix equals `unique_id`: [backend/api/organization/accounts/submit-role-arn/main.go](../../../../backend/api/organization/accounts/submit-role-arn/main.go) `handler`. The gateway regex locks the role name: [organization-submit-account-role-arn.json](../../../../backend/infra/modules/templates/api-models/schemas/organization-submit-account-role-arn.json).
- Clutter side of assume-role: IAM role `TerraformDeployerFargateTaskRole` may `sts:AssumeRole` on `arn:aws:iam::*:role/AllowClutterToDeployTerraformRole-*` and may read/write the Clutter S3 bucket: [backend/infra/modules/fargate/main.tf](../../../../backend/infra/modules/fargate/main.tf).
- Apply/destroy: the Lambda in Clutter calls `ecs.RunTask` with launch type Fargate, public IP enabled, cluster from env, and container env `AWS_REGION`, `TERRAFORM_DIRECTORY` (`{org}/{project}/{diagram}/terraform`), `CLIENT_ROLE_ARN`, `ASSUME_ROLE_EXTERNAL_ID`, `COMMAND`, `COMMAND_ID`, `PSQL_CONNECTION_STRING`, `DIAGRAM_ID`. The ECS client itself uses `generic.DefaultRegion` (`us-west-2`), not the requested customer region: [backend/api/terraform-command-runner/main.go](../../../../backend/api/terraform-command-runner/main.go) `handler`.
- Ansible: `submit-job` `handler` loads `role_arn` and `external_id` for a `complete` row, inserts `jobs`, then `sqs.SendMessage` with `job_id`, `job_type=ansible`, playbook key, instance ids, extra vars, org/project/diagram ids, `role_arn`, and `assume_role_external_id`. `run-task` `handler` starts Fargate (`LaunchTypeFargate`) from that queue. The run-task Lambda also has `ec2:StartInstances`, `ec2:DescribeInstances`, and `ec2:DescribeInstanceStatus` on `Resource: "*"` in Clutter: [backend/infra/main.tf](../../../../backend/infra/main.tf) `ansible-run-task-ec2-start-policy`.
- Compiler output path is `s3://{S3_BUCKET_NAME}/{orgID}/{projectID}/{diagramID}/`: [backend/api/terraform-engine/create/main.go](../../../../backend/api/terraform-engine/create/main.go) `handler`. Templates come from `TEMPLATE_BUCKET_NAME`.
- Gateway model for region defaults the description to `us-east-1` ([terraform-command-runner.json](../../../../backend/infra/modules/templates/api-models/schemas/terraform-command-runner.json)). Go and the account-link frontend default `us-west-2`.

### Inferences
- Clutter-hosted: API, authorizer, Postgres, S3 (generated Terraform, playbooks, lambda zips, logs), SQS, ECS/Fargate, the assume-role principal.
- Customer-hosted: the IAM role and every resource Terraform creates after assume-role (EC2, Lambda, S3, DynamoDB, API Gateway in that account). The customer must click the console URL; nothing in this API creates the stack for them.
- The customer role is broader than the five diagram resource types. `iam:*` and `s3:*` on `*` are in the template the product asks the customer to deploy.
- An adapter can start the link and can submit the ARN. It cannot finish linking without a principal that can create that stack in the customer account.

### Gaps
- The Fargate container image that actually calls `sts:AssumeRole` and `terraform apply` was not read. The contract is the env vars passed by the runner Lambda.
- Whether Ansible reaches customer instances via SSM under the assumed role, or via the Clutter Lambda’s `ec2:StartInstances`, was not traced past the SQS payload and the customer role’s `ssm:*`.

## Where is business logic duplicated, and what is hardcoded?

### Takeaway
The compiler, membership checks, and SQL constraints live in Go. The canvas, resource-specific form behavior, and member roles live in Next.js. Several contracts are duplicated and already disagree: plan vs apply/destroy, project name length, default region, and which routes are authenticated.

### Cited Findings
- Each feature folder reimplements `apiFetch` (same `Authorization: token` header). Nine `api.ts` files under `frontend/clutter/src/lib/features/`. That is transport duplication, not domain duplication.
- Resource palette data is supposed to come from `GET /resources`. The editor still special-cases labels inside the UI: `ConfigPanel.tsx` branches on `resourceDef?.label === "API Gateway"`, `"S3"`, and `"DynamoDB"`: [frontend/clutter/src/app/(diagram)/projects/[projectId]/diagram/[diagramId]/_components/nodes/ConfigPanel.tsx](../../../../frontend/clutter/src/app/(diagram)/projects/[projectId]/diagram/[diagramId]/_components/nodes/ConfigPanel.tsx). The compiler has its own label switch in `ParseResourceType`. The seed file is a third list.
- Frontend `runTerraform` types `command` as `"apply" | "destroy" | "plan"`: [frontend/clutter/src/lib/features/diagram/api.ts](../../../../frontend/clutter/src/lib/features/diagram/api.ts). Gateway enum is `apply` and `destroy` only. README also says plan: [README.md](../../../../README.md) line 335.
- Project name: JSON schema maxLength 100 ([project-create.json](../../../../backend/infra/modules/templates/api-models/schemas/project-create.json)) versus `projects.name VARCHAR(32)` ([application-tables.sql](../../../../backend/storage-sql/application-tables.sql)).
- Diagram update validation in Go is structural (id/type/source/target). Variable required-ness for Lambda, S3, and the others is described in seed JSON and again in each `ResourceGenerator.ValidateVariables`. ConfigPanel applies yet another presentation of those fields.
- Membership logic is not duplicated in the client. The client sends ids and the Lambda calls `CheckOrganizationMembershipPSQL`. The members screen does not call that table at all.
- Hardcoding to AWS: resource types, IAM template, role name prefix, EC2 instance id pattern `^i-[0-9a-f]{8,17}$` in both the job schema and `submit-job` `ec2IDPattern`, Lambda runtimes in `code-upload` `runtimeHandlers`, region allow-list.
- Hardcoding to this UI: diagram `type`, `position`, `measured`, edge `animated`. The editor is `@xyflow/react` (`ReactFlowProvider` in the diagram page).
- Hardcoding to one deployment: role name `TerraformDeployerFargateTaskRole`, bucket env vars, `CLUTTER_ACCOUNT_ID`, template URL, ECS cluster and task definition ARNs, SQS queue URL, one `JWT_SECRET`, one `GOOGLE_CLIENT_ID`. No tenant or product id in the token or the paths.
- `POST /terraform-engine` is not called from any `frontend/clutter/src/lib/features/*/api.ts`. Diagram update does not invoke the generator. The only in-repo description of the trigger is the Supabase webhook README under the Lambda.

### Inferences
- An adapter that speaks HTTP can skip the React canvas and still store a diagram, but it must emit React Flow JSON, not a neutral resource graph.
- An adapter that only saves diagrams will not produce Terraform. Nothing in the update Lambda compiles.
- Adding a sixth resource type means editing the seed, `ParseResourceType`, a new generator, S3 templates, and ConfigPanel branches. There is no plugin slot.

### Gaps
- ConfigPanel is large; only the label branches and the resource lookup were read, not every field rule. Some UI validation may be stricter than the Lambda and was not line-audited.

## What would an external caller be unable to do today without the Next.js UI?

### Takeaway
Most writes already have HTTP handlers, so a script with a user JWT can create orgs, projects, diagrams, start apply/destroy, upload a playbook, and enqueue Ansible. It cannot obtain that JWT without Google, cannot manage members, cannot finish AWS linking without a console click, and cannot rely on diagram save to generate Terraform.

### Cited Findings
- Callable with a JWT, from the route table above: org CRUD, project CRUD, diagram CRUD, account list/delete, role-ARN submit, CloudFormation URL, terraform command, log reads, code-upload presign, ansible job submit/get, playbook presign, user-information.
- `GET /resources` and `POST /terraform-engine` are callable with no JWT.
- Not callable because no route exists: invite member, remove member, set a role, list users, refresh a token, revoke a token, register a service account, run `plan`, read diagram history as its own endpoint (history is written, not exposed as a route in the integrations).
- Member UI actions only mutate `MOCK_MEMBERS`: [members/api.ts](../../../../frontend/clutter/src/lib/features/members/api.ts).
- Linking still requires the customer to open `data.url` and create the stack. The API only mints the URL and later stores the ARN.
- S3 upload is a second hop the UI performs (`PUT` to `upload_url` with `x-amz-server-side-encryption: AES256`) in `runsApi.uploadPlaybookFileToS3` and `codeUploadApi.uploadLambdaCodeToS3`. An external caller can do that PUT without Next.js, but only after the presign call.
- `runsApi` does not wrap `GET /ansible/jobs` or `GET /ansible/jobs/{jobId}/logs`. Those routes exist; the UI client omits them. An external caller can use them.
- Live logs are poll-based (`nextToken`, `taskArn`), not a websocket. The UI comment in `logs/api.ts` says `STOPPED` is terminal and the server `isComplete` flag is preferred. An external caller can poll the same GET.
- Diagram editing (drag, connect, ConfigPanel) has no API of its own. The API is “replace `data`”. The shape is the canvas document.

### Inferences
- “Without the Next.js UI” is not the same as “without a human.” Account linking and Google login both stop at a human or at Google.
- The things that are UI-only today are: Google button and token cookie, canvas editing, member administration, and any `plan` button that the type system allows but the gateway model rejects.

### Gaps
- No browser pass was run. Whether some screens call `fetch` outside `lib/features/*/api.ts` was not exhaustively proven. The feature API modules are the clients the task named, and route inventory came from Terraform.

## Where should an adapter sit, and what gaps block a standard interface?

### Takeaway
The adapter should sit in front of API Gateway and translate a stable resource API into these handlers. It should not sit inside Next.js. The blocking gaps are machine identity, the unwired and unauthenticated compiler, the human CloudFormation step, and a diagram document that is a UI file rather than a cloud model.

### Cited Findings
Seams that already exist and are the right width:

- HTTP edge: one method resource per Lambda in [backend/infra/main.tf](../../../../backend/infra/main.tf) integrations, all `AWS_PROXY`. An adapter can target those paths without linking Go packages.
- Identity mint: `GenerateUserJWT` and the authorizer `handler`. Any service credential has to be added beside the Google exchange in `log-in` `handler`, then recognized in the authorizer. There is nowhere else tokens are issued.
- Tenancy: `CheckOrganizationMembershipPSQL`. Handlers repeat the same 403/404 mapping. That function is the single membership rule, and it only knows user id plus org id.
- Diagram interchange: `generic.DiagramLayout` and `PUT /diagram` body `data`. That struct is what both the editor and the compiler read.
- Compile step: `terraform-engine/create` `handler` → `generator.NewTerraformGenerator` → `resources.ParseResourceType` / `GetGenerator` → S3 writer. Payload type is `SupabaseWebhookPayload` in [backend/api/terraform-engine/create/internal/structs.go](../../../../backend/api/terraform-engine/create/internal/structs.go).
- Terraform run contract: container env set in `terraform-command-runner` `handler` (`CLIENT_ROLE_ARN`, `ASSUME_ROLE_EXTERNAL_ID`, `TERRAFORM_DIRECTORY`, `COMMAND`, `COMMAND_ID`).
- Ansible run contract: SQS body built in `submit-job` `handler` (`job_id`, `role_arn`, `assume_role_external_id`, `playbook_s3_key`, `target_instance_ids`).
- Account link contract: URL generator insert plus `submit-role-arn` update plus the role name regex and the CloudFormation template.

Gaps that are in the code, not just style:

- No path version. Routes are `/organization`, `/project`, `/diagram`, not `/v1/...`.
- No gateway deployment or stage resource in this Terraform, so this repo does not by itself publish the API.
- No idempotency key on create, on the account-link insert (each GET creates a new incomplete row; duplicate name is 409), or on job submit (new UUID every call). Resubmitting a completed role ARN returns 400 “role ARN already submitted”.
- Handler-per-Lambda: each directory under `backend/api/` has its own `main()` and `lambda.Start(handler)`. Shared code is one module, [backend/api/go.mod](../../../../backend/api/go.mod), package `generic`, which mixes HTTP responses, Postgres, diagram types, regions, and job JSON.
- Error bodies are not one schema. Login uses `error` plus `message`. Many handlers use `message`. Some use `error` as a string. Status for a missing authorizer context is 500 in org create and account handlers, and 401 in diagram update and ansible submit.
- `accountAccessRoleId` is optional in the gateway model and required in practice; a missing id becomes a database error response from the runner (500 “failed to retrieve role ARN”).
- Job tenancy is the creating user, and `role_arn` is copied onto the JSON response. External id is not copied by `BuildJobResponse`, but it is stored on `jobs` and sent through SQS in plaintext in the message body.
- Public `POST /terraform-engine` has no signature check. `HasDataChanged` is commented out. The handler does not verify `type` or `table`.
- Diagram history is written and never read by an HTTP integration in `main.tf`.
- CORS is `*`.
- Customer role template grants `iam:*` and `s3:*` on `*`.

### Inferences
- A thin adapter can map “create diagram / run apply / poll logs” onto existing routes once it has a user JWT. It cannot honestly claim a multi-tenant platform API until the identity and compile seams change.
- The smallest code changes that would make an adapter safe, without a rewrite: require the JWT (or a webhook secret) on `POST /terraform-engine` and call that compiler from diagram update, or document a single authenticated “compile” body that is not a Supabase webhook; add a non-human caller that still ends in `CheckOrganizationMembershipPSQL`; stop returning `role_arn` from job JSON; fix the project-name length so the gateway and the table agree; add a version prefix only at the adapter, leaving these paths as the internal dialect.

### Gaps
- No measurement of how often diagram update and the webhook stay in sync in a running environment. In this repo they are not connected.

## Quality judgment: what is solid, what is brittle, what must be fixed before others connect?

### Takeaway
The org/project/diagram CRUD path and the membership check are real and test-backed enough to wrap. The execution path is a working AWS integration with a dangerous customer role and two different job models. It is not ready to be the standard other products call until machine auth, the public compiler, and the account-link trust boundary are fixed.

### Cited Findings
Solid, as implemented:

- One membership function used by org, project, diagram, account, logs, playbook upload, code upload, terraform runner, and ansible submit. Tests exist beside it: `backend/api/tests/generic/membership_test.go`, `authorization_test.go`, `diagram_auth_integration_test.go`.
- Diagram update writes history inside the same transaction, with `MAX(version)+1`, which matches the README claim about `diagram_history`.
- Account link is a deliberate two-phase row (`incomplete` then `complete`) and the ARN must carry the server-generated 8-character id. That is tighter than “paste any role ARN.”
- Ansible submit validates instance ids, rejects both playbook id and s3 key, caps extra vars, and on SQS failure marks the job `FAILED`. Queue has a DLQ in Terraform.
- Fargate task role is scoped to assume only `AllowClutterToDeployTerraformRole-*`, not arbitrary roles.
- Go tests cover ansible job helpers and generic auth. The task’s ~22% figure was not re-counted here. Frontend test files were not part of this API read; the task states there are none.

Brittle:

- Authorizer comment, `WithValidate(false)`, 24-hour token, 7-day cookie, and TTL 0 do not form a session system. There is no revocation list.
- README, gateway models, SQL, and TypeScript disagree on plan, auth, project name length, and default region (`us-east-1` in the model description, `us-west-2` in Go).
- `generic` is the shared kernel and also the HTTP helper. A change to diagram JSON or CORS touches every Lambda that imports it.
- Terraform apply does not go through `jobs`. Ansible does not go through `diagram_deployment_logs`. An adapter cannot poll one “run” resource.
- `supported_resources` can drift from `ParseResourceType`. The UI special-cases three labels.
- `GET` that creates a database row (`cloudformation-stack-url`) is not safe to retry. Each call inserts a new account placeholder.
- Gateway body validator does not validate query params. Log and project ids are checked only in Go, unevenly.
- `list-jobs` returns at most 50 rows and includes `role_arn`.
- Customer CloudFormation is `iam:*` and `s3:*`. That is the trust boundary other companies would be asked to click.
- `POST /terraform-engine` unauthenticated, and diagram save does not call it. The feature the product is named for is not on the authenticated write path.
- No stage in Terraform. Shipping this API to another team depends on console or out-of-repo state.
- Login and several handlers return raw `err.Error()` to the client (`invalid Google token`, SQL errors).

Must be fixed before this is a standard other products connect to (not a rewrite):

- A non-browser identity. Today the only mint path is `idtoken.Validate` then `GenerateUserJWT`. Without that, PatriCloud can only impersonate a Google user.
- Close `POST /terraform-engine` (authorizer or shared secret) and make diagram save and compile one authenticated sequence. Otherwise adapters will either fail to deploy or depend on an unauthenticated webhook.
- Do not publish the current customer role template as the integration contract. Narrow `iam:*` / `s3:*` before other accounts are asked to deploy it, or the adapter is standardizing a full-admin cross-account role.
- One error envelope and one id style (path versus `organizationId` versus `orgId`) at the adapter boundary. Do not make callers learn both.
- Idempotency on account-link creation and on job submit, or callers will create duplicate incomplete accounts and duplicate Ansible runs.
- Stop treating `jobs.created_by` as the tenant key, and stop returning `role_arn` on the job payload, before an external platform lists jobs.
- Align project name length and drop `plan` from the public type until a handler exists. Shipping the README’s route table as the contract would document routes and auth that the Terraform does not implement.

### Inferences
- Readiness is “internal product API with a browser login,” not “platform API.” The seams are visible and local. The blockers are a handful of trust and contract bugs, not the absence of a framework.
- Wrapping Next.js would wrap mocks (members) and a canvas. Wrapping API Gateway wraps the real model, plus the public compiler and the admin role, which have to be fixed in Clutter before the wrapper is safe.

### Gaps
- Test percentage and “no frontend tests” were taken as the task’s prior measurement, not re-derived.
- Runtime behavior of a deployed stage (throttling, WAF, actual CORS on the stage) is outside this repo.
- The final report PDF was not extracted, so no partner decision from that file is included.
