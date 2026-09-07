import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  MDeployImageArtifactV01Schema,
  MDeployPromotionV01Schema,
  MDeployRollbackPointerV01Schema,
  MDeployRuntimeDriverSelectionV01Schema,
  MDeployRuntimeHealthV01Schema,
  validateMDeployImageArtifactV01,
  validateMDeployRuntimeDriverSelectionV01
} from '../../packages/contracts/src/index.ts'

const digest = {
  algorithm: 'sha256',
  value: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
} as const

const storageRef = (name: string) => ({
  uri: `oci://registry.example/meristem/metadata/${name}`,
  digest,
  redactionStatus: 'metadata_only' as const
})

const podmanRuntime = {
  schemaVersion: 'mdeploy.runtime-driver-selection@0.1.0',
  runtimeClass: 'production',
  runtimeDriver: 'podman',
  unitManager: 'quadlet-systemd',
  iacDriver: 'opentofu',
  selectedAt: '2026-07-13T00:00:00.000Z',
  selectedBy: 'm-deploy-controller'
} as const

const imageArtifact = {
  schemaVersion: 'mdeploy.image-artifact@0.1.0',
  imageReference: `registry.example/meristem/core@sha256:${digest.value}`,
  digest,
  sbomRef: storageRef('core.sbom.spdx.json'),
  provenanceRef: storageRef('core.intoto.jsonl'),
  signatureRef: storageRef('core.sigstore.json'),
  signer: {
    kind: 'cosign-keyless',
    identity: 'release@meristem.example',
    issuer: 'https://token.actions.githubusercontent.com'
  },
  verifiedAt: '2026-07-13T00:01:00.000Z'
} as const

function assertRoundTrip(schema: Schema.Codec<unknown>, value: unknown) {
  const decoded = Schema.decodeUnknownSync(schema)(value)
  const encoded = Schema.encodeSync(schema)(decoded)
  expect(Schema.decodeUnknownSync(schema)(encoded)).toEqual(decoded)
}

describe('M-Deploy runtime, provenance, and promotion contracts', () => {
  it('keeps Podman Quadlet/systemd as production and Docker Compose as compatibility-only', () => {
    const production = validateMDeployRuntimeDriverSelectionV01(podmanRuntime)
    const dockerRuntime = {
      schemaVersion: 'mdeploy.runtime-driver-selection@0.1.0',
      runtimeClass: 'compatibility',
      runtimeDriver: 'docker',
      unitManager: 'docker-compose',
      iacDriver: 'disabled',
      selectedAt: '2026-07-13T00:00:00.000Z',
      selectedBy: 'compatibility-harness'
    } as const
    const compatibility = validateMDeployRuntimeDriverSelectionV01(dockerRuntime)

    expect(production).toEqual({ ok: true, value: podmanRuntime })
    expect(compatibility).toEqual({ ok: true, value: dockerRuntime })
    assertRoundTrip(MDeployRuntimeDriverSelectionV01Schema, podmanRuntime)
    assertRoundTrip(MDeployRuntimeDriverSelectionV01Schema, dockerRuntime)
  })

  it('round-trips an immutable image artifact with complete provenance', () => {
    const result = validateMDeployImageArtifactV01(imageArtifact)

    expect(result).toEqual({ ok: true, value: imageArtifact })
    assertRoundTrip(MDeployImageArtifactV01Schema, imageArtifact)
  })

  it('preserves promotion environment, artifact trust, approval, and rollback metadata', () => {
    const promotion = {
      schemaVersion: 'mdeploy.promotion@0.1.0',
      promotionId: 'promotion-001',
      sourceEnvironment: 'staging',
      targetEnvironment: 'production',
      artifact: imageArtifact,
      approvalActor: 'security-admin-2',
      rollbackPointer: {
        environment: 'production',
        digest: {
          algorithm: 'sha256',
          value: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
        },
        promotionId: 'promotion-000'
      },
      promotedAt: '2026-07-13T00:05:00.000Z',
      correlationId: 'corr-promotion-001'
    } as const

    const decoded = Schema.decodeUnknownSync(MDeployPromotionV01Schema)(promotion)

    expect(decoded).toEqual(promotion)
    expect(decoded.sourceEnvironment).toBe('staging')
    expect(decoded.targetEnvironment).toBe('production')
    expect(decoded.artifact.digest).toEqual(digest)
    expect(decoded.artifact.sbomRef).toEqual(imageArtifact.sbomRef)
    expect(decoded.artifact.provenanceRef).toEqual(imageArtifact.provenanceRef)
    expect(decoded.artifact.signatureRef).toEqual(imageArtifact.signatureRef)
    expect(decoded.artifact.signer).toEqual(imageArtifact.signer)
    expect(decoded.approvalActor).toBe('security-admin-2')
    expect(decoded.rollbackPointer.promotionId).toBe('promotion-000')
    assertRoundTrip(MDeployRollbackPointerV01Schema, promotion.rollbackPointer)
  })

  it('round-trips production runtime health with immutable-image verification evidence', () => {
    const runtimeHealth = {
      schemaVersion: 'mdeploy.runtime-health@0.1.0',
      agentId: 'agent-1',
      hostId: 'host-1',
      runtime: podmanRuntime,
      health: 'healthy',
      checkedAt: '2026-07-13T00:06:00.000Z',
      checks: {
        runtimeAvailable: true,
        unitManagerAvailable: true,
        immutableImageVerified: true
      },
      appliedImageDigest: digest
    } as const

    assertRoundTrip(MDeployRuntimeHealthV01Schema, runtimeHealth)
  })
})
