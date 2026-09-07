import { rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  decodeMDeployInstallerManifestV01,
  isLegacyGeneratedMDeployInstallerPlaceholderV01,
  validateMDeployInstallerManifestV01,
  type MDeployInstallerManifestV01FromSchema,
  type MDeployLocalInstallerManifestV01FromSchema,
  type MDeployProductionInstallerManifestV01FromSchema
} from '../../../../packages/contracts/src/index.ts'
import { collectGitProvenance } from './deploy-git-provenance.ts'
import { success } from './shared.ts'
import type { CliRunResult } from './types.ts'

export const DEFAULT_MANIFEST_PATH = 'meristem.deploy.json'
export const LOCAL_PROFILE_ALLOWLIST = ['opensearch', 'redis', 'apisix'] as const

type InstallerProfile = 'local-compose' | 'production-podman'
type DeployManifestFailureCode =
  | 'manifest_invalid'
  | 'manifest_read_failed'
  | 'manifest_write_failed'

type ExistingManifest = {
  readonly manifest: MDeployInstallerManifestV01FromSchema
}

export type InitManifestInput = {
  readonly manifestPath: string
  readonly profile: string | undefined
  readonly cwd: string
}

/** 安装器边界错误保留可机器识别的失败码，同时为 CLI 操作者提供可执行的修复提示。 */
export class DeployManifestError extends Error {
  override readonly name = 'DeployManifestError'

  constructor(
    readonly code: DeployManifestFailureCode,
    message: string
  ) {
    super(message)
  }
}

/** 读取并离线校验安装清单；任何结构或语义问题都在产生副作用或公开 API 调用之前失败。 */
export async function readValidManifest(
  manifestPath: string
): Promise<MDeployInstallerManifestV01FromSchema> {
  const existing = await readDecodedManifest(manifestPath)
  const validated = validateMDeployInstallerManifestV01(existing.manifest)
  if (!validated.ok) {
    throw new DeployManifestError(
      'manifest_invalid',
      `deploy manifest invalid: ${validated.error.message}`
    )
  }
  return validated.value
}

/** 生成或复用安装清单；生产清单只在 Git provenance 完整收集后才写入磁盘。 */
export async function initManifest(input: InitManifestInput): Promise<CliRunResult> {
  const profile = installerProfile(input.profile)
  const existing = await readExistingManifest(input.manifestPath)
  if (existing !== undefined) {
    if (existing.manifest.profile !== profile) {
      throw new DeployManifestError(
        'manifest_invalid',
        `existing deploy manifest profile is ${existing.manifest.profile}; requested profile is ${profile}`
      )
    }
    if (
      profile === 'production-podman' &&
      isLegacyGeneratedMDeployInstallerPlaceholderV01(existing.manifest)
    ) {
      await writeManifestAtomically(input.manifestPath, await productionManifest(input.cwd))
      return success({
        written: input.manifestPath,
        profile,
        upgraded: true,
        next: 'run: meristem deploy validate'
      })
    }
    return success({
      written: input.manifestPath,
      profile,
      reused: true,
      next: nextStep(profile)
    })
  }

  const manifest =
    profile === 'local-compose' ? localManifest() : await productionManifest(input.cwd)
  await writeManifestAtomically(input.manifestPath, manifest)
  return success({ written: input.manifestPath, profile, next: nextStep(profile) })
}

/** 输出已通过离线语义校验的清单摘要；这不替代 M-Deploy/agent 的远端信任复核。 */
export async function validateManifest(manifestPath: string): Promise<CliRunResult> {
  const manifest = await readValidManifest(manifestPath)
  if (manifest.profile === 'local-compose') {
    return success({
      valid: true,
      profile: manifest.profile,
      local: { profiles: manifest.local.profiles }
    })
  }
  return success({
    valid: true,
    profile: manifest.profile,
    proposal: { sourceRef: manifest.proposal.sourceRef, diffSummary: manifest.proposal.diffSummary }
  })
}

/** 合并本地 profile 参数并在构造子进程参数前收紧到安装器允许清单。 */
export function mergeProfiles(existing: readonly string[], override: string | undefined): string[] {
  const unique = [
    ...new Set([
      ...existing,
      ...(override
        ? override
            .split(',')
            .map(profile => profile.trim())
            .filter(Boolean)
        : [])
    ])
  ]
  if (unique.length === 0) {
    throw new DeployManifestError(
      'manifest_invalid',
      'at least one local profile is required (e.g. --profiles opensearch,redis,apisix)'
    )
  }
  for (const profile of unique) {
    if (!LOCAL_PROFILE_ALLOWLIST.some(allowed => allowed === profile)) {
      throw new DeployManifestError(
        'manifest_invalid',
        `unsupported local profile "${profile}"; allowed: ${LOCAL_PROFILE_ALLOWLIST.join(',')}`
      )
    }
  }
  return unique
}

async function productionManifest(
  cwd: string
): Promise<MDeployProductionInstallerManifestV01FromSchema> {
  return {
    schemaVersion: 'mdeploy.install-manifest@0.1.0',
    profile: 'production-podman',
    proposal: {
      sourceRef: await collectGitProvenance(cwd),
      diffSummary: { added: 0, changed: 0, removed: 0, summary: 'initial desired state' }
    }
  } satisfies MDeployProductionInstallerManifestV01FromSchema
}

function localManifest(): MDeployLocalInstallerManifestV01FromSchema {
  return {
    schemaVersion: 'mdeploy.install-manifest@0.1.0',
    profile: 'local-compose',
    local: { profiles: [] }
  } satisfies MDeployLocalInstallerManifestV01FromSchema
}

async function readExistingManifest(manifestPath: string): Promise<ExistingManifest | undefined> {
  if (!(await Bun.file(manifestPath).exists())) return undefined
  return await readDecodedManifest(manifestPath)
}

async function readDecodedManifest(manifestPath: string): Promise<ExistingManifest> {
  let rawText: string
  let raw: unknown
  try {
    rawText = await Bun.file(manifestPath).text()
    raw = JSON.parse(rawText)
  } catch (error) {
    throw new DeployManifestError(
      'manifest_read_failed',
      `cannot read deploy manifest ${manifestPath}: ${errorMessage(error)}`
    )
  }
  const decoded = decodeMDeployInstallerManifestV01(raw)
  if (!decoded.ok) {
    throw new DeployManifestError(
      'manifest_invalid',
      `deploy manifest invalid: ${decoded.error.message}`
    )
  }
  return { manifest: decoded.value }
}

async function writeManifestAtomically(
  manifestPath: string,
  manifest: MDeployInstallerManifestV01FromSchema
): Promise<void> {
  const temporaryPath = join(
    dirname(manifestPath),
    `.${basename(manifestPath)}.${crypto.randomUUID()}.tmp`
  )
  try {
    await Bun.write(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await rename(temporaryPath, manifestPath)
  } catch (error) {
    try {
      await rm(temporaryPath, { force: true })
    } catch (cleanupError) {
      throw new DeployManifestError(
        'manifest_write_failed',
        `cannot write deploy manifest ${manifestPath}: ${errorMessage(error)}; temporary cleanup failed: ${errorMessage(cleanupError)}`
      )
    }
    throw new DeployManifestError(
      'manifest_write_failed',
      `cannot write deploy manifest ${manifestPath}: ${errorMessage(error)}`
    )
  }
}

function installerProfile(value: string | undefined): InstallerProfile {
  const profile = value ?? 'local-compose'
  if (profile === 'local-compose' || profile === 'production-podman') return profile
  throw new DeployManifestError(
    'manifest_invalid',
    '--profile must be local-compose or production-podman'
  )
}

function nextStep(profile: InstallerProfile): string {
  return profile === 'local-compose'
    ? 'run: meristem deploy install --profiles opensearch,redis,apisix'
    : 'run: meristem deploy validate'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
