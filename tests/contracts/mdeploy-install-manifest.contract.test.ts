import { describe, expect, it } from 'bun:test'
import {
  decodeMDeployInstallerManifestV01,
  isLegacyGeneratedMDeployInstallerPlaceholderV01,
  validateMDeployInstallerManifestV01
} from '../../packages/contracts/src/index.ts'

const productionManifest = {
  schemaVersion: 'mdeploy.install-manifest@0.1.0',
  profile: 'production-podman',
  proposal: {
    sourceRef: {
      repositoryUrl: 'https://github.com/InSnh-Gd/meristem.git',
      branch: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'deployments/production.json',
      digest: {
        algorithm: 'sha256',
        value: 'a'.repeat(64)
      },
      syncedAt: '2026-08-12T00:00:00.000Z'
    },
    diffSummary: {
      added: 1,
      changed: 2,
      removed: 0,
      summary: 'Promote signed production desired state'
    }
  }
}

describe('M-Deploy installer manifest contract', () => {
  it('decodes a non-secret local compose manifest', () => {
    const manifest = {
      schemaVersion: 'mdeploy.install-manifest@0.1.0',
      profile: 'local-compose',
      local: { profiles: ['opensearch', 'redis', 'apisix'] }
    }

    const decoded = decodeMDeployInstallerManifestV01(manifest)

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.profile).toBe('local-compose')
  })

  it('requires a pinned production Git commit, sha256 digest, and credential-free repository URL', () => {
    expect(validateMDeployInstallerManifestV01(productionManifest).ok).toBe(true)

    const mutableCommit = structuredClone(productionManifest)
    mutableCommit.proposal.sourceRef.commit = 'main'
    expect(validateMDeployInstallerManifestV01(mutableCommit)).toEqual({
      ok: false,
      error: {
        code: 'installer_manifest_invalid',
        message: 'production sourceRef.commit must be an immutable Git commit'
      }
    })

    const credentialsInUrl = structuredClone(productionManifest)
    credentialsInUrl.proposal.sourceRef.repositoryUrl = 'https://token@example.com/meristem.git'
    expect(validateMDeployInstallerManifestV01(credentialsInUrl)).toEqual({
      ok: false,
      error: {
        code: 'installer_manifest_invalid',
        message: 'production sourceRef.repositoryUrl must not include credentials'
      }
    })

    // 查询串携带 secret 材料同样视为凭据泄露，必须拒绝。
    for (const secretKey of ['token', 'access_token', 'key']) {
      const querySecret = structuredClone(productionManifest)
      querySecret.proposal.sourceRef.repositoryUrl = `https://git.example.com/meristem.git?${secretKey}=plaintext`
      expect(validateMDeployInstallerManifestV01(querySecret)).toEqual({
        ok: false,
        error: {
          code: 'installer_manifest_invalid',
          message: 'production sourceRef.repositoryUrl must not include credentials'
        }
      })
    }
    // 生产清单 URL 禁止任何查询串：大小写/别名/编码变体也一律拒绝。
    for (const query of ['TOKEN=plaintext', 'api_key=plaintext', 'x-access-token=plaintext', 'Access_Token=plaintext']) {
      const queryVariant = structuredClone(productionManifest)
      queryVariant.proposal.sourceRef.repositoryUrl = `https://git.example.com/meristem.git?${query}`
      expect(validateMDeployInstallerManifestV01(queryVariant)).toEqual({
        ok: false,
        error: {
          code: 'installer_manifest_invalid',
          message: 'production sourceRef.repositoryUrl must not include credentials'
        }
      })
    }
  })

  it('rejects only the exact generated production placeholder manifest', () => {
    const placeholder = structuredClone(productionManifest)
    placeholder.proposal.sourceRef = {
      repositoryUrl: 'https://git.example.com/org/meristem.git',
      branch: 'refs/heads/main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'deploy/production',
      digest: { algorithm: 'sha256', value: 'ab'.repeat(32) },
      syncedAt: '1970-01-01T00:00:00.000Z'
    }
    placeholder.proposal.diffSummary = {
      added: 0,
      changed: 0,
      removed: 0,
      summary: 'initial desired state'
    }

    const decoded = decodeMDeployInstallerManifestV01(placeholder)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(isLegacyGeneratedMDeployInstallerPlaceholderV01(decoded.value)).toBe(true)

    expect(validateMDeployInstallerManifestV01(placeholder)).toEqual({
      ok: false,
      error: {
        code: 'installer_manifest_invalid',
        message: 'production sourceRef still contains deploy init placeholders'
      }
    })

    const operatorEdited = structuredClone(placeholder)
    operatorEdited.proposal.diffSummary.summary = 'operator authored desired state'
    const editedDecoded = decodeMDeployInstallerManifestV01(operatorEdited)
    expect(editedDecoded.ok).toBe(true)
    if (!editedDecoded.ok) return
    expect(isLegacyGeneratedMDeployInstallerPlaceholderV01(editedDecoded.value)).toBe(false)
    expect(validateMDeployInstallerManifestV01(operatorEdited).ok).toBe(true)
  })

  it('rejects profiles outside the supported local install allowlist and unexpected fields', () => {
    expect(
      validateMDeployInstallerManifestV01({
        schemaVersion: 'mdeploy.install-manifest@0.1.0',
        profile: 'local-compose',
        local: { profiles: ['opensearch', 'opensearch'] }
      })
    ).toEqual({
      ok: false,
      error: {
        code: 'installer_manifest_invalid',
        message: 'local profiles must not contain duplicates'
      }
    })

    expect(
      decodeMDeployInstallerManifestV01({
        schemaVersion: 'mdeploy.install-manifest@0.1.0',
        profile: 'local-compose',
        local: { profiles: [] },
        token: 'must-not-be-accepted'
      }).ok
    ).toBe(false)
  })
})
