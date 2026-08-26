// 兼容入口重新导出 OCI 发布校验，并保留既有 CLI 执行路径。

import { validateOciReleaseInput } from './oci-release-validation.ts'
import { release } from './oci-release-workflow.ts'

export type { OciReleaseInput } from './oci-release-validation.ts'
export { validateOciReleaseInput } from './oci-release-validation.ts'

function environmentInput(): unknown {
  return {
    target: process.env.OCI_TARGET,
    bunBaseImage: process.env.OCI_BUN_BASE_IMAGE,
    staticBaseImage: process.env.OCI_STATIC_BASE_IMAGE,
    imageRepository: process.env.OCI_RELEASE_IMAGE_REPOSITORY,
    sourceCommit: process.env.OCI_SOURCE_COMMIT ?? process.env.GITHUB_SHA,
    sourceEnvironment: process.env.OCI_SOURCE_ENVIRONMENT,
    targetEnvironment: process.env.OCI_TARGET_ENVIRONMENT,
    approvalActor: process.env.OCI_APPROVAL_ACTOR,
    rollbackDigest: process.env.OCI_ROLLBACK_DIGEST,
    signerIdentity: process.env.COSIGN_IDENTITY,
    signerIssuer: process.env.COSIGN_OIDC_ISSUER
  }
}

async function main(): Promise<void> {
  const input = validateOciReleaseInput(environmentInput())
  if (!input.ok) throw new Error(`${input.error.code}: ${input.error.message}`)
  const result = await release(input.value)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  console.log(JSON.stringify({ status: 'released', promotion: result.value }, null, 2))
}

if (import.meta.main) await main()
