import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ociTargets,
  resolveOciTarget,
  scanBuildContextForSecrets,
  validateOciStaticPreflight,
  validateOciTargetInventory,
  validateDigestPinnedImage,
  validateOciBuildPreflight,
  validatePromotionMetadata
} from '../../scripts/oci-pipeline.ts'

const currentDigest = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const rollbackDigest = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'

function storageRef(name: string) {
  return {
    uri: `oci://registry.example/meristem/metadata/${name}`,
    digest: { algorithm: 'sha256', value: currentDigest },
    redactionStatus: 'metadata_only'
  } as const
}

function ociRef(artifact: 'signature' | 'attestation', predicateType?: string) {
  return {
    uri: `oci://registry.example/meristem/core@sha256:${currentDigest}?artifact=${artifact}`,
    digest: { algorithm: 'sha256', value: currentDigest },
    redactionStatus: 'metadata_only' as const,
    subjectDigest: { algorithm: 'sha256', value: currentDigest },
    artifact,
    ...(predicateType ? { predicateType } : {}),
    verification: {
      tool: 'cosign' as const,
      operation:
        artifact === 'signature'
          ? ('download-signature' as const)
          : ('download-attestation' as const)
    }
  }
}

function promotionFixture() {
  return {
    schemaVersion: 'mdeploy.promotion@0.1.0',
    promotionId: 'promotion-oci-001',
    sourceEnvironment: 'staging',
    targetEnvironment: 'production',
    artifact: {
      schemaVersion: 'mdeploy.image-artifact@0.1.0',
      imageReference: `registry.example/meristem/core@sha256:${currentDigest}`,
      digest: { algorithm: 'sha256', value: currentDigest },
      sbomRef: storageRef('core.sbom.spdx.json'),
      provenanceRef: storageRef('core.intoto.jsonl'),
      signatureRef: storageRef('core.sigstore.json'),
      signer: {
        kind: 'cosign-keyless',
        identity: 'release@meristem.example',
        issuer: 'https://token.actions.githubusercontent.com'
      },
      verifiedAt: '2026-07-21T00:01:00.000Z'
    },
    approvalActor: 'security-admin-2',
    rollbackPointer: {
      environment: 'production',
      digest: { algorithm: 'sha256', value: rollbackDigest },
      promotionId: 'promotion-oci-000'
    },
    promotedAt: '2026-07-21T00:05:00.000Z',
    correlationId: 'corr-promotion-oci-001'
  } as const
}

describe('OCI build and promotion pipeline contracts', () => {
  it('declares every deployable service, Core, and the M-UI static artifact exactly once', () => {
    expect(ociTargets.map(target => target.name)).toEqual([
      'core',
      'm-deploy',
      'm-eventbus',
      'm-extension',
      'm-log',
      'm-net',
      'm-policy',
      'm-task',
      'm-ui-bff',
      'node-agent',
      'm-ui'
    ])
    expect(ociTargets.filter(target => target.kind === 'static-artifact')).toEqual([
      expect.objectContaining({ name: 'm-ui' })
    ])
    expect(resolveOciTarget('m-deploy')).toEqual({
      ok: true,
      value: expect.objectContaining({
        activation: 'host-adapter-required',
        entrypoint: 'services/m-deploy/src/serve.ts'
      })
    })
    expect(readFileSync(join(import.meta.dir, '../../services/m-deploy/src/serve.ts'), 'utf8')).toContain(
      'serveProductionMDeployApp'
    )
    expect(validateOciTargetInventory()).toEqual({ ok: true, value: [] })
    const coreTarget = resolveOciTarget('core')
    if (!coreTarget.ok) throw new Error(coreTarget.error.message)
    expect(validateOciStaticPreflight(coreTarget.value)).toEqual({
      ok: true,
      value: []
    })
    const uiTarget = resolveOciTarget('m-ui')
    if (!uiTarget.ok) throw new Error(uiTarget.error.message)
    expect(validateOciStaticPreflight(uiTarget.value)).toEqual({ ok: true, value: [] })
  })

  it('requires immutable base images while allowing static dry-run preflight without installed OCI tools', () => {
    const pinned = `ghcr.io/oven-sh/bun@sha256:${currentDigest}`
    expect(validateDigestPinnedImage(pinned)).toEqual({ ok: true, value: pinned })
    expect(validateDigestPinnedImage('ghcr.io/oven-sh/bun:1')).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'base_image_not_pinned' })
    })
    const context = mkdtempSync(join(tmpdir(), 'meristem-oci-preflight-'))
    try {
      expect(
        validateOciBuildPreflight({
          bunBaseImage: pinned,
          staticBaseImage: `caddy@sha256:${currentDigest}`,
          contextDir: context,
          requireExternalTools: false
        })
      ).toEqual({ ok: true, value: [] })
    } finally {
      rmSync(context, { recursive: true, force: true })
    }
  })

  it('accepts immutable promotion metadata that reuses the T9 provenance and rollback contracts', () => {
    expect(validatePromotionMetadata(promotionFixture())).toEqual({
      ok: true,
      value: promotionFixture()
    })
  })

  it('accepts typed OCI referrer evidence with an explicit Cosign retrieval operation', () => {
    const promotion = promotionFixture()
    const referrerPromotion = {
      ...promotion,
      artifact: {
        ...promotion.artifact,
        sbomRef: ociRef('attestation', 'spdxjson'),
        provenanceRef: ociRef('attestation', 'slsaprovenance'),
        signatureRef: ociRef('signature')
      }
    }

    expect(validatePromotionMetadata(referrerPromotion)).toEqual({
      ok: true,
      value: referrerPromotion
    })
  })

  it('scans a non-excluded build context for secret material', () => {
    const context = mkdtempSync(join(tmpdir(), 'meristem-oci-context-'))
    try {
      writeFileSync(
        join(context, 'service.ts'),
        'const apiCredential = "-----BEGIN PRIVATE KEY-----"\n'
      )
      writeFileSync(join(context, 'clean.ts'), 'export const ready = true\n')

      expect(scanBuildContextForSecrets(context)).toEqual(['service.ts'])
    } finally {
      rmSync(context, { recursive: true, force: true })
    }
  })
})
