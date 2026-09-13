import { describe, expect, it } from 'bun:test'
import { fromPartial } from '@total-typescript/shoehorn'
import type { MNetDb } from './clients.ts'
import {
  deleteNetworkTx,
  type DeleteNetworkFixture,
  removeMemberTx,
  type RemoveMemberFixture
} from './network-service-fakes.ts'
import { createNetworkService } from './network-service.ts'
import { createInMemoryProfileStore } from './profile/profile-store.ts'

/**
 * 网络变更事务里的 event-intent / tombstone 写入（ADR-N05）。
 * 从 network-service.test.ts 拆出以守单文件 500 行预算：这里只断言「变更与事件意图同事务」。
 */

describe('createNetworkService deleteNetwork event-intent and tombstone', () => {
  function serviceFor(fixture: DeleteNetworkFixture, counter: Record<string, unknown>) {
    const db = fromPartial<MNetDb>({
      transaction: (fn: (value: unknown) => Promise<unknown>) =>
        fn(deleteNetworkTx(fixture, counter as never))
    })
    return createNetworkService({ db, profileStore: createInMemoryProfileStore() })
  }

  it('writes the tombstone and the deletion event intent inside the deletion transaction', async () => {
    const counter = {
      transaction: 0,
      deletedTables: [] as string[],
      insertedTables: [] as string[]
    }
    const service = serviceFor({ networkExists: true }, counter)

    const result = await service.deleteNetwork({
      networkId: 'network-a',
      correlationId: 'corr-delete-1'
    })

    expect(result).toEqual({ ok: true, value: { networkId: 'network-a' } })
    // 墓碑与事件意图都必须在删除事务内写入，否则会出现「网络已删但无删除事件/无法幂等重试」。
    expect(counter.insertedTables).toEqual([
      'mnet_network_tombstones',
      'mnet_network_event_intents'
    ])
  })

  it('returns idempotent success for a tombstoned network without writing a second event', async () => {
    const counter = {
      transaction: 0,
      deletedTables: [] as string[],
      insertedTables: [] as string[]
    }
    const service = serviceFor(
      { networkExists: false, tombstoneRows: [{ networkId: 'network-a' }] },
      counter
    )

    const result = await service.deleteNetwork({ networkId: 'network-a' })

    expect(result).toEqual({ ok: true, value: { networkId: 'network-a' } })
    // 重试 DELETE：墓碑已存在 → 幂等 200，且不重复发事件（outbox 已负责）。
    expect(counter.insertedTables).toEqual([])
    expect(counter.deletedTables).toEqual([])
  })

  it('returns network.not_found when neither the row nor a tombstone exists', async () => {
    const counter = {
      transaction: 0,
      deletedTables: [] as string[],
      insertedTables: [] as string[]
    }
    const service = serviceFor({ networkExists: false }, counter)

    const result = await service.deleteNetwork({ networkId: 'network-a' })

    expect(result).toEqual({
      ok: false,
      error: { code: 'network.not_found', message: 'network not found' }
    })
    expect(counter.insertedTables).toEqual([])
  })
})

describe('createNetworkService removeMember event-intent', () => {
  function serviceFor(fixture: RemoveMemberFixture, counter: Record<string, unknown>) {
    const db = fromPartial<MNetDb>({
      transaction: (fn: (value: unknown) => Promise<unknown>) =>
        fn(removeMemberTx(fixture, counter as never))
    })
    return createNetworkService({ db, profileStore: createInMemoryProfileStore() })
  }

  it('writes the membership-removed intent inside the cleanup transaction', async () => {
    const counter = {
      transaction: 0,
      deletedTables: [] as string[],
      insertedTables: [] as string[]
    }
    const service = serviceFor(
      { networkExists: true, membershipRows: [{ nodeId: 'leaf-1' }] },
      counter
    )

    const result = await service.removeMember({
      networkId: 'network-a',
      nodeId: 'leaf-1',
      correlationId: 'corr-remove-1'
    })

    expect(result).toEqual({ ok: true, value: { networkId: 'network-a', nodeId: 'leaf-1' } })
    expect(counter.insertedTables).toEqual(['mnet_network_event_intents'])
  })
})
