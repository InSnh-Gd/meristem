import { describe, expect, it } from 'bun:test'
import { fromPartial } from '@total-typescript/shoehorn'
import type { MNetDb } from './clients.ts'
import { type RemoveMemberFixture, removeMemberTx } from './network-service-fakes.ts'
import { createNetworkService } from './network-service.ts'
import { createInMemoryProfileStore } from './profile/profile-store.ts'

/**
 * removeMember 的 correlationId 透传 seam（DFW-032 剩余项）。
 * 从 network-service.test.ts 拆出以守单文件 500 行预算（MERISTEM-DEV §8.2）：
 * 这里只覆盖「Core 透传的 correlationId 是否进入 post-commit map 刷新」这一点。
 */

function serviceWithRefreshCapture(fixture: RemoveMemberFixture, captured: string[]) {
  const counter = { transaction: 0, deletedTables: [] as string[] }
  const db = fromPartial<MNetDb>({
    transaction: (fn: (value: unknown) => Promise<unknown>) => {
      counter.transaction += 1
      return fn(removeMemberTx(fixture, counter))
    }
  })
  return createNetworkService({
    db,
    profileStore: createInMemoryProfileStore(),
    refreshNetworkMap: async (_networkId, correlationId) => {
      captured.push(correlationId)
    }
  })
}

describe('createNetworkService.removeMember correlationId', () => {
  it('threads the caller correlationId into the post-commit map refresh', async () => {
    // Core 审计（auth.correlationId）与 M-Net map 刷新/事件必须共享同一条链路 id。
    const captured: string[] = []
    const service = serviceWithRefreshCapture(
      { networkExists: true, membershipRows: [{ nodeId: 'leaf-1' }] },
      captured
    )

    const result = await service.removeMember({
      networkId: 'network-a',
      nodeId: 'leaf-1',
      correlationId: 'corr-from-core'
    })

    expect(result).toEqual({ ok: true, value: { networkId: 'network-a', nodeId: 'leaf-1' } })
    expect(captured).toEqual(['corr-from-core'])
  })

  it('falls back to a locally generated correlationId when the caller omits it', async () => {
    const captured: string[] = []
    const service = serviceWithRefreshCapture(
      { networkExists: true, membershipRows: [{ nodeId: 'leaf-1' }] },
      captured
    )

    const result = await service.removeMember({ networkId: 'network-a', nodeId: 'leaf-1' })

    expect(result).toEqual({ ok: true, value: { networkId: 'network-a', nodeId: 'leaf-1' } })
    expect(captured).toHaveLength(1)
    expect(captured[0]).toBeTruthy()
  })

  it('does not refresh the map on a typed failure', async () => {
    const captured: string[] = []
    const service = serviceWithRefreshCapture({ networkExists: false }, captured)

    const result = await service.removeMember({
      networkId: 'network-a',
      nodeId: 'leaf-1',
      correlationId: 'corr-from-core'
    })

    expect(result).toEqual({
      ok: false,
      error: { code: 'network.not_found', message: 'network not found' }
    })
    expect(captured).toEqual([])
  })
})
