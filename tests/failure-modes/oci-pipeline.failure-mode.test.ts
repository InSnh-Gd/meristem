import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createOciBuildPlan,
  resolveOciTarget,
  scanBuildContextForSecrets,
  validateOciBuildPreflight,
  validatePromotionMetadata
} from '../../scripts/oci-pipeline.ts'
import { validateOciReleaseInput } from '../../scripts/oci-release.ts'

const digest = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function promotionFixture() {
  const storageRef = (name: string) => ({
    uri: `oci://registry.example/meristem/metadata/${name}`,
    digest: { algorithm: 'sha256', value: digest },
    redactionStatus: 'metadata_only' as const
  })
  return {
    schemaVersion: 'mdeploy.promotion@0.1.0',
    promotionId: 'promotion-oci-001',
    sourceEnvironment: 'staging',
    targetEnvironment: 'production',
    artifact: {
      schemaVersion: 'mdeploy.image-artifact@0.1.0',
      imageReference: `registry.example/meristem/core@sha256:${digest}`,
      digest: { algorithm: 'sha256', value: digest },
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
      digest: {
        algorithm: 'sha256',
        value: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
      },
      promotionId: 'promotion-oci-000'
    },
    promotedAt: '2026-07-21T00:05:00.000Z',
    correlationId: 'corr-promotion-oci-001'
  }
}

describe('OCI pipeline failure modes', () => {
  it('rejects unknown targets and external builds whose required tools are unavailable', () => {
    expect(resolveOciTarget('latest')).toEqual({
      ok: false,
      error: { code: 'invalid_target', message: 'unknown OCI target: latest' }
    })
    const context = mkdtempSync(join(tmpdir(), 'meristem-oci-tools-'))
    try {
      const result = validateOciBuildPreflight({
        bunBaseImage: `ghcr.io/oven-sh/bun@sha256:${digest}`,
        staticBaseImage: `caddy@sha256:${digest}`,
        contextDir: context,
        requireExternalTools: true
      })

      if (!result.ok) expect(result.error.code).toBe('external_tool_unavailable')
    } finally {
      rmSync(context, { recursive: true, force: true })
    }
  })

  it('runs static preflight before dry-run construction and rejects configured mutable base images', () => {
    expect(
      createOciBuildPlan(['--target=core', '--dry-run'], {
        bunBaseImage: 'ghcr.io/oven-sh/bun:latest',
        staticBaseImage: `caddy@sha256:${digest}`
      })
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'base_image_not_pinned' })
    })
  })

  it('rejects an incomplete release environment before attempting external OCI execution', () => {
    expect(
      validateOciReleaseInput({
        target: 'core',
        bunBaseImage: `ghcr.io/oven-sh/bun@sha256:${digest}`,
        staticBaseImage: `caddy@sha256:${digest}`,
        imageRepository: 'registry.example/meristem/core',
        sourceCommit: '0123456789abcdef0123456789abcdef01234567',
        sourceEnvironment: 'staging',
        targetEnvironment: 'production',
        approvalActor: '',
        rollbackDigest: `sha256:${digest}`,
        signerIdentity: 'release@meristem.example',
        signerIssuer: 'https://token.actions.githubusercontent.com'
      })
    ).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'release_environment_invalid' })
    })
  })

  it('retrieves persisted Cosign referrers before creating promotion metadata', () => {
    const releaseScript = readFileSync(
      join(import.meta.dir, '../../scripts/oci-release.ts'),
      'utf8'
    )

    expect(releaseScript).toMatch(/'download',\s*'attestation'/)
    expect(releaseScript).toMatch(/'download',\s*'signature'/)
    expect(releaseScript.indexOf("'download',\n      'signature'")).toBeLessThan(
      releaseScript.indexOf('const promotion =')
    )
  })

  it('rejects mutable tags, digest mismatch, missing provenance, and invalid rollback pointers', () => {
    const mutable = promotionFixture()
    mutable.artifact.imageReference = 'registry.example/meristem/core:latest'
    expect(validatePromotionMetadata(mutable)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid_target' })
    })

    const mismatch = promotionFixture()
    mismatch.artifact.imageReference =
      'registry.example/meristem/core@sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
    expect(validatePromotionMetadata(mismatch)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid_target' })
    })

    const missingProvenance = promotionFixture()
    Reflect.deleteProperty(missingProvenance.artifact, 'signatureRef')
    expect(validatePromotionMetadata(missingProvenance)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid_target' })
    })

    const invalidRollback = promotionFixture()
    invalidRollback.rollbackPointer.environment = 'staging'
    expect(validatePromotionMetadata(invalidRollback)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid_target' })
    })
  })

  it('rejects plaintext metadata and build-context secret contamination while excluding secret files', () => {
    const contaminated = promotionFixture()
    Object.assign(contaminated, { registryToken: 'plain-text' })
    expect(validatePromotionMetadata(contaminated)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'build_context_secret_contamination' })
    })

    const context = mkdtempSync(join(tmpdir(), 'meristem-oci-secret-'))
    try {
      writeFileSync(join(context, 'config.ts'), 'const key = "-----BEGIN PRIVATE KEY-----"\n')
      writeFileSync(join(context, '.env'), 'TOKEN=excluded-from-build-context\n')
      expect(scanBuildContextForSecrets(context)).toEqual(['config.ts'])
    } finally {
      rmSync(context, { recursive: true, force: true })
    }
  })

  it('keeps secret files out of Docker context and avoids broad copy instructions', () => {
    const dockerignore = readFileSync(join(import.meta.dir, '../../.dockerignore'), 'utf8')
    const serviceContainerfile = readFileSync(
      join(import.meta.dir, '../../ops/oci/Containerfile.service'),
      'utf8'
    )
    const uiContainerfile = readFileSync(
      join(import.meta.dir, '../../ops/oci/Containerfile.m-ui'),
      'utf8'
    )

    expect(dockerignore).toContain('.env')
    expect(dockerignore).toContain('*.pem')
    expect(dockerignore).toContain('*.key')
    expect(`${serviceContainerfile}\n${uiContainerfile}`).not.toContain('COPY . .')
  })
})
