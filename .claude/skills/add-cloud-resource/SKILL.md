---
name: add-cloud-resource
description: The checklist for adding a new canvas resource (a cloud service a user can drag onto the diagram) or changing an existing one's fields, defaults or template, in System A (AWS) or in a System B connector. Lists every place a resource is defined so none drifts. Fire before adding or changing a resource type, a template, or a resource's variables.
---

# Add or change a cloud resource

First decide which system the resource belongs to.

- **B's AWS connector:** reuse A's template file if one exists; a new AWS block gets a new `*.tf.tmpl` under `backend/infra/modules/s3/uploads/aws/<service>/` and its own `aws_s3_object` in `backend/infra/modules/s3/main.tf`, plus its entry in the AWS connector's manifest. A's generator, seed, palette and config panel are not touched.
- **A new cloud, not a new resource:** if an approved Terraform provider reaches it, it is a new General connector (`general-<provider>`): pin the provider, write its manifest, credential spec and verification call, pass the contract tests, add it to the allow-list (`docs/architecture/system-b-adapter-layer.md` § General). It gets a named connector of its own only when no approved provider reaches it.
- **A connector in System B** (a General connector such as OpenStack, or any other target): the resource is a feature in that connector's manifest, in Go, and nowhere else. B's catalog route, palette and config panel read the manifest. Mark it as-is, extended or new against the standard features (`docs/architecture/system-b-adapter-layer.md`). Do not add it to any of the five A places below.
- **System A (AWS):** A is changed only at the named seams (ADR-006), so a new AWS resource is a decision; record it in `docs/decisions.md` first. Then follow the rest of this skill.

In A, a resource is defined in five places that must agree. They already drift (the Lambda runtime is `nodejs24.x` in the config panel and `nodejs24` in code upload; the default runtime differs between the seed and the generator). Every A resource change touches all five.

## Before you start

1. Run `ground-before-building` for the Terraform resource: read its Registry page at the provider version the generated code pins, and confirm the target cloud actually runs the service.
2. Decide the variables: name, type, required, default, allowed values. Write the allowed values once, in Go, and have every other place read or mirror them.

## The five places in A

| # | Place | What to add or change |
| --- | --- | --- |
| 1 | Generator (`backend/api/terraform-engine/create/internal`) | The `ResourceType` constant in `structs.go`; the label case and generator case in `generator/resources/mapper.go`; a generator file in `generator/resources/` implementing `ResourceGenerator` (validate every variable here, per `engineering-conventions` invariant 2). If the resource takes part in edges, the IAM rules in `generator/iam/`. |
| 2 | Templates (`backend/infra/modules/s3/uploads/<provider>/<service>/`) | `main.tf.tmpl` and `outputs.tf.tmpl`. Every user value is already validated or escaped before it reaches the template. |
| 3 | Template upload (`backend/infra/modules/s3/main.tf`) | One `aws_s3_object` per template file, with its `etag`. Without this the template does not exist at run time. |
| 4 | Seed (`backend/storage-sql/seed-resources.sql`) | The `supported_resources` row: label (must equal the canvas node label and the mapper case), display name, description, variables JSON with the same defaults as the Go code. |
| 5 | Frontend (`frontend/clutter/src/app/(diagram)/.../_components/`) | The palette entry and icon (`Palette.tsx`, `public/<provider>/`), the field controls and option lists in `nodes/ConfigPanel.tsx`, and the node component. |

Also check: the JSON schemas in `backend/infra/modules/templates/api-models/schemas/` if a request body changes, and any handler that hard-codes the option list (code upload hard-codes runtimes).

## Prove it

- A generator unit test that renders the template with valid input, and one per rejected input (bad name, value outside the allow-list, a string carrying `"`, `${` or a newline). The existing generator tests load templates from live S3 and fail offline; read the template from disk in yours.
- `go -C backend/api build ./...`, `vet` and `test` on the generator package.
- Read the rendered `.tf` and run `terraform fmt -check` and `terraform validate` on it in the scratchpad (`init -backend=false`).
- Grep the label across the repo and confirm all five places use the same spelling.
