# OCI Build, Evidence, and Promotion Pipeline

## 1. Scope and Authority

This pipeline packages Meristem's deployable runtimes without changing M-Deploy control behavior. Git remains the desired-state authority; M-Deploy remains responsible for validating and reconciling approved desired state through enrolled agents. OCI output supplies immutable artifacts and evidence metadata that the existing M-Deploy contracts consume.

The canonical executable contracts are:

- `packages/contracts/src/schemas/mdeploy-operations.ts#MDeployImageArtifactV01Schema`
- `packages/contracts/src/schemas/mdeploy-operations.ts#MDeployPromotionV01Schema`
- `packages/contracts/src/schemas/mdeploy-operations.ts#MDeployRollbackPointerV01Schema`

No separate promotion manifest is introduced here.

## 2. Target Inventory

The `scripts/oci-pipeline.ts` inventory is authoritative for build targets.

| Target | Image Kind | Runtime Entry | Activation Constraint |
|--------|------------|---------------|-----------------------|
| `core` | service | `apps/core/src/index.ts` | runnable |
| `m-deploy` | service | `services/m-deploy/src/serve.ts` | requires a production host-adapter module and configuration |
| `m-eventbus` | service | `services/m-eventbus/src/index.ts` | runnable |
| `m-extension` | service | `services/m-extension/src/index.ts` | runnable |
| `m-log` | service | `services/m-log/src/index.ts` | runnable |
| `m-net` | service | `services/m-net/src/index.ts` | runnable |
| `m-policy` | service | `services/m-policy/src/index.ts` | runnable |
| `m-task` | service | `services/m-task/src/index.ts` | runnable |
| `m-ui-bff` | service | `services/m-ui-bff/src/index.ts` | runnable |
| `node-agent` | service | `services/node-agent/src/index.ts` | runnable |
| `m-ui` | static artifact | SvelteKit static build served by Caddy | runnable |

`apps/m-cli/src/index.ts` is explicitly excluded: it is an operator client run through an admitted control-plane image, not an independently deployed service image. `services/m-deploy/src/index.ts` is likewise excluded because it is a library barrel; the deployed M-Deploy server is `serve.ts` and refuses to start unless `MERISTEM_MDEPLOY_HOST_ADAPTER_MODULE` supplies the documented Git, agent, controller, runtime, and controller-trust adapters.

Service images use `ops/oci/Containerfile.service`; M-UI uses the multi-stage `ops/oci/Containerfile.m-ui`. Both expect digest-pinned base images. The Containerfiles never copy a broad repository context.

## 3. Build and Attestation Procedure

All repository commands remain Bun-driven:

```bash
bun run oci:build --target=core --dry-run
bun run oci:build --target=m-ui --dry-run
```

Dry runs print the proposed Podman build, Syft SPDX SBOM, SLSA/in-toto provenance, and Cosign verification steps. They do not contact a registry and do not claim an image was signed.

Before an authorized release environment may perform an external build, it must supply digest-pinned `OCI_BUN_BASE_IMAGE` and `OCI_STATIC_BASE_IMAGE`, and it must provide `podman`, `syft`, and `cosign`. Missing dependencies are an explicit preflight failure. Private signing material and registry credentials must arrive only through the deployment environment's SecretProvider/CI credential boundary; they are never command arguments, metadata fields, or build-context files.

The approved release runner must produce and verify all of the following before emitting promotion metadata:

1. an OCI image digest and digest-only image reference;
2. an SPDX SBOM generated from that immutable image;
3. an in-toto/SLSA provenance attestation bound to the same digest and source commit;
4. a Cosign signature plus trusted signer identity/issuer verification; and
5. redacted storage references and their digests for the SBOM, provenance, and signature evidence.

`bun run oci:release` is the only repository command allowed to perform the external sequence. It accepts release values only through the environment, runs static and external-tool preflight first, then invokes Podman build/push, Syft SPDX generation, Cosign SBOM/provenance attestations, Cosign signing, and signature/attestation verification. After creation it downloads each Cosign registry referrer, records the downloaded referrer's digest, and emits the typed OCI-referrer evidence variant with a digest-pinned `oci://<repository>@<image-digest>?artifact=...` selection URI, subject digest, artifact kind, predicate type where applicable, and the required Cosign download operation. Consumers re-verify those selections with `cosign download signature`, `cosign download attestation --predicate-type spdxjson`, or `cosign download attestation --predicate-type slsaprovenance`, followed by the corresponding Cosign verify command. Promotion metadata is written only after all of those commands succeed. Missing configuration, Podman, Syft, Cosign, or retrievable registry referrers exits with a typed failure and never reports a dry run as a release.

## 4. Promotion and Rollback Metadata

Validate an externally generated promotion record before it is handed to M-Deploy/Git desired state:

```bash
bun run oci:promotion --input=promotion.json
```

The command uses `validateMDeployPromotionV01(...)` and refuses:

- mutable/tag-only image references or a digest that mismatches artifact metadata;
- missing SBOM, provenance, signature, signer, source, or target information;
- plaintext secret-bearing metadata;
- same-source/target environment promotion; and
- rollback pointers for another target environment, a non-canonical digest, or the digest being promoted.

Promotion output preserves the `sourceEnvironment`, `targetEnvironment`, image artifact, approval actor, source correlation, and a pointer to the distinct previously verified target digest. Rollback remains a separate M-Deploy policy- and Audit-protected operation; this pipeline only validates the pointer it will use.

## 5. Runtime Policy and CI

Production runtime remains Podman with Quadlet/systemd. Docker Compose is compatibility-only and is not evidence of production readiness or a valid production promotion path.

`.github/workflows/oci-static.yml` runs an all-target static preflight before every target's dry-run plan on pull requests and `main`. It validates inventory and command construction without registry, signing, or credentials. Static tests additionally check build-context exclusions and unsafe metadata paths:

```bash
bun test tests/contracts/oci-pipeline.contract.test.ts \
  tests/failure-modes/oci-pipeline.failure-mode.test.ts
```

## 6. External Constraints

- Registry availability, repository permissions, trusted OIDC identity, and Cosign policy are release-environment prerequisites.
- A missing Podman, Syft, or Cosign binary blocks a real build rather than downgrading evidence quality.
- No live registry push, remote signing, or deployment occurs from the repository's static/CI checks.
- M-Deploy host adapters, agent enrollment, policy quorum, Audit/evidence persistence, and runtime verification remain mandatory before a production apply.
