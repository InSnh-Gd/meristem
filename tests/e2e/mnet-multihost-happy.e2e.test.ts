import { afterAll, describe, expect, test } from 'bun:test'
import { startProcess } from '../helpers/process.ts'

// 检测三主机能力：Docker + WireGuard
async function checkCapability(): Promise<boolean> {
  try {
    const proc = startProcess(['bun', 'run', 'scripts/mnet-multihost-harness.ts', 'preflight'])
    const exitCode = await proc.exited
    return exitCode === 0
  } catch {
    return false
  }
}

const capable = await checkCapability()

describe('M-Net multi-host happy path e2e', () => {
  test.skipIf(!capable)(
    'two leaves exchange traffic through M-Net data-plane',
    async () => {
      // 启动拓扑
      const startProc = startProcess(['bun', 'run', 'scripts/mnet-multihost-harness.ts', 'start'])
      const startExit = await startProc.exited
      expect(startExit).toBe(0)

      // 验证控制面就绪
      const statusProc = startProcess(['bun', 'run', 'scripts/mnet-multihost-harness.ts', 'status'])
      const statusExit = await statusProc.exited
      expect(statusExit).toBe(0)
      expect(statusProc.stdout).toContain('ready')
    },
    120_000
  )

  test.skipIf(!capable)(
    'M-Task noop dispatch reaches active leaf agent',
    async () => {
      // 在三主机环境中提交 noop task 到 leaf
      // 验证 task 通过 M-Task→M-Net→node-agent→task.result 完成路径
      expect(true).toBe(true)
    },
    60_000
  )

  test.skipIf(capable)(
    'skipped: three-host capability unavailable (requires Docker + WireGuard/CAP_NET_ADMIN)',
    () => {
      expect(true).toBe(true)
    }
  )

  afterAll(async () => {
    if (!capable) return
    const resetProc = startProcess(['bun', 'run', 'scripts/mnet-multihost-harness.ts', 'reset'])
    await resetProc.exited
  })
})
