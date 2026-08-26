import { describe, expect, it } from 'bun:test'
import { runPreflightChecks } from '../../scripts/mnet-multihost-harness-preflight.ts'
import { runMNetV02LiveProof } from '../../scripts/mnet-v02-live-proof-workflow.ts'
import { validateOciReleaseInput } from '../../scripts/oci-release-validation.ts'

describe('script module split contracts', () => {
  it('keeps extracted entry-point responsibilities directly importable', async () => {
    // Given: 直接导入拆分后的 Harness、live proof 与 OCI 校验职责模块。
    const invalidTopology = await runMNetV02LiveProof({
      argv: ['bun', 'scripts/mnet-v02-live-proof.ts', '--topology=unsupported']
    })

    // When: 使用不完整 OCI 输入并检查 Harness 前置检查导出。
    const invalidRelease = validateOciReleaseInput({})

    // Then: 新职责入口保留原有可调用性与失败语义。
    expect(typeof runPreflightChecks).toBe('function')
    expect(invalidTopology.verdict).toBe('failure')
    expect(invalidRelease).toEqual({
      ok: false,
      error: { code: 'release_environment_invalid', message: 'release environment is incomplete' }
    })
  })
})
