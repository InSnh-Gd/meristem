import { describe, expect, it } from 'bun:test'
import { resolveAgentReportedStatus } from '../../services/node-agent/src/node-agent-runtime.ts'

// ---------------------------------------------------------------------------
// 心跳自报状态契约：
// - 未入网（network-pending 哨兵）必须报 healthy，否则与 M-Net join 的
//   healthy 前置条件形成死锁（无成员身份 → 运行时同步 404 → degraded → 无法 join）。
// - 已入网后由运行态决定：healthy / 非 healthy → degraded。
// ---------------------------------------------------------------------------

describe('node-agent heartbeat reported status', () => {
  it('未入网（network-pending）一律报 healthy', () => {
    expect(resolveAgentReportedStatus('network-pending', 'stopped')).toBe('healthy')
    expect(resolveAgentReportedStatus('network-pending', 'degraded')).toBe('healthy')
  })

  it('已入网后按运行态上报', () => {
    expect(resolveAgentReportedStatus('net-123', 'healthy')).toBe('healthy')
    expect(resolveAgentReportedStatus('net-123', 'degraded')).toBe('degraded')
    expect(resolveAgentReportedStatus('net-123', 'stopped')).toBe('degraded')
  })
})
