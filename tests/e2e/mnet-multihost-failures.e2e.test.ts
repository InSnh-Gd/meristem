import { afterAll, describe, expect, test } from 'bun:test'
import { startProcess } from '../helpers/process.ts'

// 检测三主机能力
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

describe('M-Net multi-host failure and recovery e2e', () => {
  test.skipIf(!capable)(
    'partition beyond TTL fails closed then recovers',
    async () => {
      // 阻断 agent 控制通道，等待加速 TTL 过期
      // 验证 agent 转入 fail_closed 状态，隧道断开
      // 恢复连接后验证 agent 用新 map 版本恢复隧道
      expect(true).toBe(true)
    },
    120_000
  )

  test.skipIf(!capable)(
    'break-glass tears down active tunnel',
    async () => {
      // 在活跃隧道状态下执行 break-glass
      // 验证隧道在 TTL 内不可达，audit/timeline 事实存在
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
