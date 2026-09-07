import * as Schema from 'effect/Schema'
import { err, ok, type Result } from '../../../common/src/result.ts'
import { MDeployDiffSummaryV01Schema } from './mdeploy-operations.ts'
import { MDeployGitSourceRefV01Schema } from './mdeploy-common.ts'

/** M-CLI 安装清单只描述可验证的部署意图，永不承载 token、密钥或 SecretProvider 明文。 */
export const MDeployInstallerManifestSchemaVersionV01Schema = Schema.Literals([
  'mdeploy.install-manifest@0.1.0'
])
export type MDeployInstallerManifestSchemaVersionV01FromSchema =
  typeof MDeployInstallerManifestSchemaVersionV01Schema.Type

const LocalProfileSchema = Schema.Literals(['opensearch', 'redis', 'apisix'])

export const MDeployLocalInstallerManifestV01Schema = Schema.Struct({
  schemaVersion: MDeployInstallerManifestSchemaVersionV01Schema,
  profile: Schema.Literal('local-compose'),
  local: Schema.Struct({ profiles: Schema.Array(LocalProfileSchema) })
})
export type MDeployLocalInstallerManifestV01FromSchema =
  typeof MDeployLocalInstallerManifestV01Schema.Type

export const MDeployProductionInstallerManifestV01Schema = Schema.Struct({
  schemaVersion: MDeployInstallerManifestSchemaVersionV01Schema,
  profile: Schema.Literal('production-podman'),
  proposal: Schema.Struct({
    sourceRef: MDeployGitSourceRefV01Schema,
    diffSummary: MDeployDiffSummaryV01Schema
  })
})
export type MDeployProductionInstallerManifestV01FromSchema =
  typeof MDeployProductionInstallerManifestV01Schema.Type

export const MDeployInstallerManifestV01Schema = Schema.Union([
  MDeployLocalInstallerManifestV01Schema,
  MDeployProductionInstallerManifestV01Schema
])
export type MDeployInstallerManifestV01FromSchema = typeof MDeployInstallerManifestV01Schema.Type

export type MDeployInstallerManifestValidationFailure = {
  code: 'installer_manifest_invalid'
  message: string
}

/** 仅识别历史 deploy init 生成的完整占位清单，避免把操作者编辑过的生产清单误判为可替换草稿。 */
export function isLegacyGeneratedMDeployInstallerPlaceholderV01(
  manifest: MDeployInstallerManifestV01FromSchema
): boolean {
  if (manifest.profile !== 'production-podman') return false

  const { diffSummary, sourceRef } = manifest.proposal
  return (
    manifest.schemaVersion === 'mdeploy.install-manifest@0.1.0' &&
    sourceRef.repositoryUrl === 'https://git.example.com/org/meristem.git' &&
    sourceRef.branch === 'refs/heads/main' &&
    sourceRef.commit === '0123456789abcdef0123456789abcdef01234567' &&
    sourceRef.path === 'deploy/production' &&
    sourceRef.digest.algorithm === 'sha256' &&
    sourceRef.digest.value === 'ab'.repeat(32) &&
    sourceRef.syncedAt === '1970-01-01T00:00:00.000Z' &&
    diffSummary.added === 0 &&
    diffSummary.changed === 0 &&
    diffSummary.removed === 0 &&
    diffSummary.summary === 'initial desired state'
  )
}

/**
 * 安装器在任何本地副作用或公开 API 调用之前校验清单。
 * production 只接受不可变 Git 指针；签名和最终准入仍由 M-Deploy/agent 在拉取时复核。
 */
export function decodeMDeployInstallerManifestV01(
  input: unknown
): Result<MDeployInstallerManifestV01FromSchema, MDeployInstallerManifestValidationFailure> {
  if (!installerManifestHasOnlySupportedFields(input)) {
    return err({
      code: 'installer_manifest_invalid',
      message: 'installer manifest contains unsupported fields'
    })
  }
  try {
    return ok(Schema.decodeUnknownSync(MDeployInstallerManifestV01Schema)(input))
  } catch (error) {
    return err({ code: 'installer_manifest_invalid', message: errorMessage(error) })
  }
}

/**
 * 清单结构正确后继续执行部署语义校验，避免可变 sourceRef 或带凭据 URL 进入提案链。
 */
export function validateMDeployInstallerManifestV01(
  input: unknown
): Result<MDeployInstallerManifestV01FromSchema, MDeployInstallerManifestValidationFailure> {
  const decoded = decodeMDeployInstallerManifestV01(input)
  if (!decoded.ok) return decoded

  if (decoded.value.profile === 'local-compose') {
    const uniqueProfiles = new Set(decoded.value.local.profiles)
    if (uniqueProfiles.size !== decoded.value.local.profiles.length) {
      return err({
        code: 'installer_manifest_invalid',
        message: 'local profiles must not contain duplicates'
      })
    }
    return decoded
  }

  if (isLegacyGeneratedMDeployInstallerPlaceholderV01(decoded.value)) {
    return err({
      code: 'installer_manifest_invalid',
      message: 'production sourceRef still contains deploy init placeholders'
    })
  }
  const { sourceRef } = decoded.value.proposal
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu.test(sourceRef.commit)) {
    return err({
      code: 'installer_manifest_invalid',
      message: 'production sourceRef.commit must be an immutable Git commit'
    })
  }
  if (hasMDeployGitSourceRefCredentials(sourceRef.repositoryUrl)) {
    return err({
      code: 'installer_manifest_invalid',
      message: 'production sourceRef.repositoryUrl must not include credentials'
    })
  }
  if (sourceRef.digest.algorithm !== 'sha256' || !/^[0-9a-f]{64}$/iu.test(sourceRef.digest.value)) {
    return err({
      code: 'installer_manifest_invalid',
      message: 'production sourceRef.digest must be a canonical sha256 digest'
    })
  }
  return decoded
}

/** Git sourceRef URL 禁止用户信息和查询串，避免凭据进入可提交的生产清单。 */
export function hasMDeployGitSourceRefCredentials(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.username.length > 0 || url.password.length > 0) return true
    // production 清单 URL 禁止任何查询串：denylist 无法穷举 api_key、x-access-token 等别名
    // 与大小写/百分号编码变体，直接拒绝 ?... 才是最稳妥的凭据边界。
    return url.search.length > 0
  } catch {
    // 无法用 URL 解析时（如部分 scp/畸形写法），仍以正则兜底拒绝明显的凭据形态。
    if (/:\/\/[^/]+@/u.test(value)) return true
    return /[?&](token|access_token|key|secret|password|auth)=/iu.test(value)
  }
}

/** 安装清单显式拒绝未知字段，防止调用方误以为 token 或 host command 被 CLI 接受。 */
function installerManifestHasOnlySupportedFields(input: unknown): boolean {
  if (!isRecord(input) || !hasOnlyKeys(input, ['schemaVersion', 'profile', 'local', 'proposal'])) {
    return false
  }

  if (input.profile === 'local-compose') {
    const local = input.local
    return isRecord(local) && hasOnlyKeys(local, ['profiles'])
  }

  if (input.profile === 'production-podman') {
    const proposal = input.proposal
    if (!isRecord(proposal) || !hasOnlyKeys(proposal, ['sourceRef', 'diffSummary'])) return false
    const sourceRef = proposal.sourceRef
    const diffSummary = proposal.diffSummary
    return (
      isRecord(sourceRef) &&
      hasOnlyKeys(sourceRef, ['repositoryUrl', 'branch', 'commit', 'path', 'digest', 'syncedAt']) &&
      isRecord(sourceRef.digest) &&
      hasOnlyKeys(sourceRef.digest, ['algorithm', 'value']) &&
      isRecord(diffSummary) &&
      hasOnlyKeys(diffSummary, ['added', 'changed', 'removed', 'summary'])
    )
  }

  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
