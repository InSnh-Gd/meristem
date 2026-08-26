import { createOciBuildPlan } from './oci-pipeline.ts'

/** OCI 镜像或发布证据使用的规范摘要。 */
export type Digest = {
  readonly algorithm: 'sha256' | 'sha512'
  readonly value: string
}

/** OCI 发布工作流所需的已验证环境输入。 */
export type OciReleaseInput = {
  readonly target: string
  readonly bunBaseImage: string
  readonly staticBaseImage: string
  readonly imageRepository: string
  readonly sourceCommit: string
  readonly sourceEnvironment: string
  readonly targetEnvironment: string
  readonly approvalActor: string
  readonly rollbackDigest: string
  readonly signerIdentity: string
  readonly signerIssuer: string
}

/** OCI 发布前置检查或执行过程产生的可报告失败。 */
export type ReleaseFailure = {
  readonly code:
    | 'release_environment_invalid'
    | 'release_execution_failed'
    | 'evidence_referrer_unavailable'
  readonly message: string
}

/** OCI 发布执行与前置检查共享的显式成功或失败结果。 */
export type ReleaseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ReleaseFailure }

function readString(input: unknown, field: string): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const value = Reflect.get(input, field)
  return typeof value === 'string' ? value.trim() : undefined
}

function parseDigest(value: string): Digest | undefined {
  const match = /^(sha256|sha512):([a-f0-9]{64}|[a-f0-9]{128})$/.exec(value)
  if (!match || match[1] === undefined || match[2] === undefined) return undefined
  const algorithm = match[1]
  if (algorithm !== 'sha256' && algorithm !== 'sha512') return undefined
  const expectedLength = algorithm === 'sha256' ? 64 : 128
  return match[2].length === expectedLength ? { algorithm, value: match[2] } : undefined
}

function isRepository(value: string): boolean {
  const imageName = value.slice(value.lastIndexOf('/') + 1)
  return (
    /^[a-z0-9][a-z0-9.:/_-]*$/i.test(value) &&
    value.includes('/') &&
    !value.includes('@') &&
    !imageName.includes(':')
  )
}

/** 在执行任何注册表、签名或发布操作前验证 OCI 发布输入。 */
export function validateOciReleaseInput(input: unknown): ReleaseResult<OciReleaseInput> {
  const target = readString(input, 'target')
  const bunBaseImage = readString(input, 'bunBaseImage')
  const staticBaseImage = readString(input, 'staticBaseImage')
  const imageRepository = readString(input, 'imageRepository')
  const sourceCommit = readString(input, 'sourceCommit')
  const sourceEnvironment = readString(input, 'sourceEnvironment')
  const targetEnvironment = readString(input, 'targetEnvironment')
  const approvalActor = readString(input, 'approvalActor')
  const rollbackDigest = readString(input, 'rollbackDigest')
  const signerIdentity = readString(input, 'signerIdentity')
  const signerIssuer = readString(input, 'signerIssuer')
  if (
    !target ||
    !bunBaseImage ||
    !staticBaseImage ||
    !imageRepository ||
    !sourceCommit ||
    !sourceEnvironment ||
    !targetEnvironment ||
    !approvalActor ||
    !rollbackDigest ||
    !signerIdentity ||
    !signerIssuer
  ) {
    return {
      ok: false,
      error: { code: 'release_environment_invalid', message: 'release environment is incomplete' }
    }
  }
  if (!isRepository(imageRepository)) {
    return {
      ok: false,
      error: {
        code: 'release_environment_invalid',
        message: 'OCI_RELEASE_IMAGE_REPOSITORY must be an untagged OCI repository'
      }
    }
  }
  if (!/^[a-f0-9]{40,64}$/.test(sourceCommit)) {
    return {
      ok: false,
      error: {
        code: 'release_environment_invalid',
        message: 'OCI_SOURCE_COMMIT must be a full immutable source commit'
      }
    }
  }
  if (sourceEnvironment === targetEnvironment) {
    return {
      ok: false,
      error: {
        code: 'release_environment_invalid',
        message: 'release source and target environments must differ'
      }
    }
  }
  if (!parseDigest(rollbackDigest)) {
    return {
      ok: false,
      error: {
        code: 'release_environment_invalid',
        message: 'OCI_ROLLBACK_DIGEST must be a canonical sha256 or sha512 digest'
      }
    }
  }
  const buildPlan = createOciBuildPlan([`--target=${target}`], { bunBaseImage, staticBaseImage })
  if (!buildPlan.ok) {
    return {
      ok: false,
      error: { code: 'release_environment_invalid', message: buildPlan.error.message }
    }
  }
  return {
    ok: true,
    value: {
      target,
      bunBaseImage,
      staticBaseImage,
      imageRepository,
      sourceCommit,
      sourceEnvironment,
      targetEnvironment,
      approvalActor,
      rollbackDigest,
      signerIdentity,
      signerIssuer
    }
  }
}

/** OCI 发布工作流内部复用的 digest 解析与失败结果构造。 */
export const ociReleaseValidation = { parseDigest }
