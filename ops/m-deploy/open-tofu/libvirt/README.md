# M-Deploy OpenTofu libvirt Validation Fixture

This fixture consumes the provider-neutral `mdeploy.opentofu-module-input@0.1.0` document emitted by M-Deploy. It models the fixed validation topology: three `control-state`, three `search`, and two `leaf` Podman hosts. It does not represent cloud-provider authority and it never transfers secrets or establishes SSH access.

## Validation default

`enable_libvirt_resources` defaults to `false`. With that setting, OpenTofu validates the input/module contract without creating networks, disks, or VMs. The fixture becomes an explicit local libvirt execution path only when an operator supplies a reachable libvirt URI, a bootable `base_volume_id`, and `enable_libvirt_resources=true`.

```bash
tofu init
tofu validate
tofu plan -input=false -var='enable_libvirt_resources=false'
```

The deployment agent writes `topology.auto.tfvars.json` from a signed desired-state topology. The generated file contains topology metadata and resource sizes only; runtime manifests use `SecretRef` references and must never include literal secret values. Docker Compose output remains a compatibility-only renderer and is not equivalent to Podman Quadlet/systemd production behavior.

## Agent-executable validation gate

The repository ships a Bun-executable gate that exercises the provider-neutral topology through the real OpenTofu CLI when the binary is available, or returns a typed environment skip otherwise:

```bash
bun run mnet:libvirt-validation-gate
```

The gate generates the fixed 3 control/state + 3 search + 2 leaf topology input, writes it to a temporary directory alongside the fixture files, and runs `tofu init → validate → plan` with `enable_libvirt_resources=false`. When `tofu` is not found in PATH, the gate exits with code 2 and a typed `external_tool_unavailable` verdict — it never claims a skipped execution passed.

Output is machine-readable JSON with `proof`, `verdict`, per-step results, and topology metadata. The temporary workspace is cleaned up after each run; no `.tfstate`, plan, or evidence artifacts are committed.
