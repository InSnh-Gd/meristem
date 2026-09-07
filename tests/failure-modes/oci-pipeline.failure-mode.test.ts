import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateWorkspaceManifestCoverage } from '../../scripts/oci-manifest-coverage.ts'
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
    // 发布流程正文已拆分至 oci-release-workflow.ts；oci-release.ts 仅保留 CLI 入口。
    const releaseScript = readFileSync(
      join(import.meta.dir, '../../scripts/oci-release-workflow.ts'),
      'utf8'
    )

    expect(releaseScript).toMatch(/'download',\s*'attestation'/)
    expect(releaseScript).toMatch(/'download',\s*'signature'/)
    // 断言取证顺序而非源码缩进：签名 referrer 必须先落盘，才能生成 promotion 元数据。
    expect(releaseScript.search(/'download',\s*'signature'/)).toBeLessThan(
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

  it('scans source subtrees that enter the build context but skips dockerignore-covered secret files', () => {
    // packages/config、嵌套 tests 与 packages/secrets 源码都会进入构建上下文，
    // preflight 的内容扫描不得因路径 segment 或后缀命中而跳过它们；
    // 只有 dockerignore 真正排除的路径（根级密钥文件、packages/secrets/**）才豁免。
    const context = mkdtempSync(join(tmpdir(), 'meristem-oci-secrets-pkg-'))
    try {
      writeFileSync(join(context, 'config.ts'), 'export const safe = true\n')
      writeFileSync(join(context, '.env'), 'TOKEN=excluded-from-build-context\n')
      for (const leaked of [
        'packages/secrets/leak.ts',
        'packages/config/leak.ts',
        'apps/m-ui/tests/leak.ts',
        'services/example/prod.key',
        // dockerignore 后缀规则大小写敏感：大写后缀与 prod.env 之类文件名不被排除，必须扫描
        'services/example/ID_RSA.PEM',
        'packages/config/prod.env'
      ]) {
        const leakPath = join(context, leaked)
        mkdirSync(join(leakPath, '..'), { recursive: true })
        writeFileSync(leakPath, 'export const key = "-----BEGIN RSA PRIVATE KEY-----"\n')
      }
      mkdirSync(join(context, 'packages/secrets'), { recursive: true })
      writeFileSync(
        join(context, 'packages/secrets/prod.key'),
        'export const key = "-----BEGIN RSA PRIVATE KEY-----"\n'
      )

      expect([...scanBuildContextForSecrets(context)].sort()).toEqual([
        'apps/m-ui/tests/leak.ts',
        'packages/config/leak.ts',
        'packages/config/prod.env',
        'packages/secrets/leak.ts',
        'services/example/ID_RSA.PEM',
        'services/example/prod.key'
      ])
    } finally {
      rmSync(context, { recursive: true, force: true })
    }
  })

  it('accepts workspace manifest coverage when every bun.lock workspace is COPYed', () => {
    const result = validateWorkspaceManifestCoverage()
    expect(result.ok).toBe(true)
  })

  it('rejects dependency images whose manifest COPY list drifts from bun.lock workspaces', () => {
    const context = mkdtempSync(join(tmpdir(), 'meristem-oci-manifest-drift-'))
    try {
      writeFileSync(
        join(context, 'bun.lock'),
        JSON.stringify({
          workspaces: {
            '': { name: 'meristem' },
            'apps/core': { name: '@meristem/app-core' },
            'packages/ghost': { name: '@meristem/ghost' }
          }
        })
      )
      for (const dockerfile of [
        'ops/docker/Dockerfile.service',
        'ops/docker/Dockerfile.bootstrap',
        'apps/m-ui/Dockerfile'
      ]) {
        const dockerfilePath = join(context, dockerfile)
        mkdirSync(join(dockerfilePath, '..'), { recursive: true })
        writeFileSync(
          dockerfilePath,
          'FROM oven/bun:1-alpine AS deps\nWORKDIR /app\nCOPY package.json bun.lock ./\nCOPY apps/core/package.json apps/core/package.json\nCOPY packages/unknown/package.json packages/unknown/package.json\n'
        )
      }

      const result = validateWorkspaceManifestCoverage(context)
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'workspace_manifest_drift',
          message: expect.stringContaining('packages/ghost')
        }
      })
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'workspace_manifest_drift',
          message: expect.stringContaining('packages/unknown')
        }
      })
    } finally {
      rmSync(context, { recursive: true, force: true })
    }
  })
})
