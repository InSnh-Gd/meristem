import { describe, expect, it } from 'bun:test'
import { redeemJoinTicket } from '@m-net/agent/agent-runtime-session-enrollment.ts'
import { applyHeartbeat } from '@m-net/agent/agent-runtime-session-heartbeat.ts'
import { bindSession } from '@m-net/agent/agent-runtime-session-state.ts'
import { deriveForcedRelayEligibility } from '@m-net/forced-relay/forced-relay-eligibility.ts'
import { executeForcedRelayChange } from '@m-net/forced-relay/forced-relay-execution.ts'
import { applyNetwork } from '@m-net/migration/migration-engine-application.ts'
import { assessOffline } from '@m-net/migration/migration-engine-locks.ts'
import { getStoredMigration } from '@m-net/migration/migration-engine-storage.ts'

describe('M-Net module split contracts', () => {
  it('keeps extracted responsibilities directly importable', () => {
    // Given: 各职责模块以独立入口承载原有实现。
    const extractedResponsibilities = [
      applyNetwork,
      assessOffline,
      getStoredMigration,
      bindSession,
      redeemJoinTicket,
      applyHeartbeat,
      deriveForcedRelayEligibility,
      executeForcedRelayChange
    ]

    // When: 契约测试直接加载这些职责入口。
    const exportKinds = extractedResponsibilities.map(value => typeof value)

    // Then: 每个入口仍提供可调用的原有实现。
    expect(exportKinds).toEqual([
      'function',
      'function',
      'function',
      'function',
      'function',
      'function',
      'function',
      'function'
    ])
  })
})
