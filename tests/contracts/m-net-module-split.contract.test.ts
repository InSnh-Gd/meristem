import { applyNetwork } from '../../services/m-net/src/migration-engine-application.ts'
import { assessOffline } from '../../services/m-net/src/migration-engine-locks.ts'
import { getStoredMigration } from '../../services/m-net/src/migration-engine-storage.ts'
import { bindSession } from '../../services/m-net/src/agent-runtime-session-state.ts'
import { redeemJoinTicket } from '../../services/m-net/src/agent-runtime-session-enrollment.ts'
import { applyHeartbeat } from '../../services/m-net/src/agent-runtime-session-heartbeat.ts'
import { deriveForcedRelayEligibility } from '../../services/m-net/src/forced-relay-eligibility.ts'
import { executeForcedRelayChange } from '../../services/m-net/src/forced-relay-execution.ts'

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
import { describe, expect, it } from 'bun:test'
