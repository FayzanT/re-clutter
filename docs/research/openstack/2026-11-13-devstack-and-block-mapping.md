# DevStack on Apple Silicon, and one diagram rendered for two clouds (2026-11-13)

Two checks of the design in `docs/architecture/system-b-adapter-layer.md` before any B code is written: can a real OpenStack run on a team laptop, and does one building-block diagram really turn into valid Terraform for both AWS and OpenStack. Both passed. The spike code itself stayed outside the repo; what it showed is recorded here.

## DevStack on the laptop

Machine: Apple M4 Pro, 24 GB, macOS 27.2.

| Step | Result |
| --- | --- |
| VM tool | Lima 2.3 (Homebrew, no admin password), Apple's VZ engine, `--nested-virt` |
| VM | Ubuntu 24.04.5, arm64, 4 CPUs, 12 GB, 40 GB disk, no folders shared with the Mac |
| Hardware virtualization inside the VM | `/dev/kvm` present, so `LIBVIRT_TYPE=kvm` (full speed, no emulation) |
| DevStack | version 2027.1, default services, `stack.sh` completed in 550 seconds |
| Arm-specific workarounds | none needed (the `etcd` fix reported for other Arm hosts was not required) |
| Boot one VM by hand | cirros 0.6.3 aarch64, `m1.tiny`, ACTIVE in 6 seconds, deleted cleanly |
| Terraform apply | network, subnet, router with the external gateway, security group and rule, VM, volume and attachment: 9 resources in 21 seconds; OpenStack showed the VM ACTIVE and the volume in use |
| Terraform destroy | 9 resources in 8 seconds; nothing left |

Two facts that matter for the OpenStack connector:

- **Provider version.** The current `terraform-provider-openstack` is 3.4.0 (Terraform registry). Version 1.54 cannot find block storage on current DevStack, because the catalog now lists it under the type `block-storage`; 3.4 works. Pin `~> 3.4`.
- **Where Terraform runs.** The VM's network is not reachable from the Mac, so the test ran Terraform inside the VM, where DevStack's own credentials file already sits. When B runs locally, its runner needs a route to DevStack (port forwarding through Lima, or B's runner inside the same VM).

How to repeat it: install Lima, create the VM with the settings above, clone DevStack as a `stack` user with a `local.conf` that sets the passwords, `HOST_IP`, `LIBVIRT_TYPE=kvm` and `disable_service tempest`, run `stack.sh`, then apply the test configuration.

## One diagram, two clouds

One sample diagram in building blocks (VM, network, firewall, volume, bucket, function, table, HTTP API, with edges for VM on network, volume on VM, firewall on VM, function reads bucket and table, HTTP API invokes function), with two deployments.

**AWS, `ca-central-1`, two deployments of the same diagram:** rendered from A's five templates (a main and an outputs file each) read from disk, unchanged, plus three new templates (network, firewall, volume) and B's own edge-to-IAM step. Both deployments print `Success! The configuration is valid.` (AWS provider 5.100.0). Findings:

- Two of A's templates need small override files: EC2 has no input for a subnet or security group, and API Gateway's deployment trigger hashes a field that is empty when routes are added separately.
- A's EC2 template pins an x86 image, so instance types must be limited to x86 (no Graviton) until image choice is added.
- A's IAM role names come from the Terraform address, so the deployment id must be part of the address as well as the cloud-side names. With that, the two deployments share no name.
- Values that reach HCL as strings were escaped (`\`, `"`, `${`, `%{`, newlines); environment variable keys, HTTP methods, names, regions, instance types and runtimes were allow-listed; name lengths were capped to AWS limits.
- A function block's code needs B's own code store and must be staged in the run's folder before `terraform init`; A's code-upload layout is A's own.
- Not checked: `terraform plan` and `apply` against real AWS (no account yet).

**OpenStack:** the same diagram, with bucket, function, table and HTTP API left out of the deployment (OpenStack's manifest marks them removed), is the DevStack test above: applied and destroyed for real.

So the mapping table in the design doc holds, with the corrections it now carries: the router needs the cloud's external network, the VM needs a floating IP when it must be reachable, and three AWS templates are new.

## Defects in A found on the way

Recorded in `.claude/findings/NOW.md` § Open defects: the API Gateway to Lambda edge never routes traffic, its fixed `statement_id` makes a second API on one function fail at apply time, A's Lambdas get no basic execution role so they cannot write logs, "reads" edges also grant Put and Delete, the EC2 template's x86 pin, and a dead `aws_apigatewayv2_api` reference.

## Sources

- Terraform registry, `terraform-provider-openstack/openstack` versions (3.4.0 latest on 2026-11-13): <https://registry.terraform.io/providers/terraform-provider-openstack/openstack/latest>
- DevStack documentation: <https://docs.openstack.org/devstack/latest/>
- DevStack with nested KVM: <https://docs.openstack.org/devstack/latest/guides/devstack-with-nested-kvm.html>
- Arm's DevStack guide (Ubuntu 24.04 on Arm, `etcd` note): <https://learn.arm.com/learning-paths/servers-and-cloud-computing/openstack-on-azure/devtstack-deployment/>
