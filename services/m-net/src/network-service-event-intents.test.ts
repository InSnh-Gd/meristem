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

describe('createNetworkService inline dispatch after commit', () => {
  /**
   * 回归守卫：事件意图只在事务内持久化是不够的——正常路径必须在提交后立即投递**本次变更的**
   * intent（按 intentId 限定范围），否则事件要等到下一个 30s sweep，且请求延迟会随 pending
   * 积压扩大。对四个变更端口逐一断言，避免只守住 delete 而其余端口悄悄退化。
   */
  function serviceFor(
    fixture: DeleteNetworkFixture,
    counter: Record<string, unknown>,
    order: string[]
  ) {
    const db = fromPartial<MNetDb>({
      transaction: (fn: (value: unknown) => Promise<unknown>) => {
        order.push('transaction')
        return fn(deleteNetworkTx(fixture, counter as never))
      }
    })
    return createNetworkService({
      db,
      profileStore: createInMemoryProfileStore(),
      dispatchEvents: async intentId => {
        order.push(`dispatch:${intentId}`)
      }
    })
  }

  it('dispatches the committed deletion intent after the transaction', async () => {
    const counter = {
      transaction: 0,
      deletedTables: [] as string[],
      insertedTables: [] as string[]
    }
    const order: string[] = []
    const service = serviceFor({ networkExists: true }, counter, order)

    await service.deleteNetwork({ networkId: 'network-a', correlationId: 'corr-1' })

    expect(order).toHaveLength(2)
    expect(order[0]).toBe('transaction')
    expect(order[1]).toMatch(/^dispatch:.+/)
  })

  it('does not dispatch on an idempotent tombstone replay (no new intent exists)', async () => {
    const counter = {
      transaction: 0,
      deletedTables: [] as string[],
      insertedTables: [] as string[]
    }
    const order: string[] = []
    const service = serviceFor(
      { networkExists: false, tombstoneRows: [{ networkId: 'network-a' }] },
      counter,
      order
    )

    const result = await service.deleteNetwork({ networkId: 'network-a' })

    expect(result).toEqual({ ok: true, value: { networkId: 'network-a' } })
    // 幂等重放不写 intent，也不投递；否则反复 DELETE 会反复扫描 outbox。
    expect(order).toEqual(['transaction'])
  })

  it('does not dispatch when a precondition rejects the deletion', async () => {
    const counter = {
      transaction: 0,
      deletedTables: [] as string[],
      insertedTables: [] as string[]
    }
    const order: string[] = []
    const service = serviceFor(
      { networkExists: true, membershipRows: [{ nodeId: 'node-1' }] },
      counter,
      order
    )

    const result = await service.deleteNetwork({ networkId: 'network-a' })

    expect(result.ok).toBe(false)
    expect(order).toEqual(['transaction'])
  })

  it('does not fail the committed mutation when the inline dispatch throws', async () => {
    const counter = {
      transaction: 0,
      deletedTables: [] as string[],
      insertedTables: [] as string[]
    }
    const db = fromPartial<MNetDb>({
      transaction: (fn: (value: unknown) => Promise<unknown>) =>
        fn(deleteNetworkTx({ networkExists: true }, counter as never))
    })
    const service = createNetworkService({
      db,
      profileStore: createInMemoryProfileStore(),
      dispatchEvents: async () => {
        throw new Error('eventbus offline')
      }
    })

    const result = await service.deleteNetwork({ networkId: 'network-a', correlationId: 'corr-1' })

    // 事件已在事务内持久化，投递失败只留 pending 交给 sweep，不能把已提交变更翻成错误。
    expect(result).toEqual({ ok: true, value: { networkId: 'network-a' } })
  })

  it('dispatches the committed intent for createNetwork, after the profile state write', async () => {
    const order: string[] = []
    const db = fromPartial<MNetDb>({
      select: () => ({
        from: () => {
          const chain = Object.assign(Promise.resolve([]), {
            where: () => chain,
            limit: () => chain
          })
          return chain
        }
      }),
      transaction: async (fn: (value: unknown) => Promise<unknown>) => {
        order.push('transaction')
        return fn({
          select: () => ({
            from: () => {
              const chain = Object.assign(Promise.resolve([]), {
                where: () => chain,
                limit: () => chain,
                for: () => chain
              })
              return chain
            }
          }),
          insert: () => ({ values: () => Promise.resolve([]) })
        })
      }
    })
    const profileStore = createInMemoryProfileStore()
    const originalSetNetworkState = profileStore.setNetworkState.bind(profileStore)
    profileStore.setNetworkState = async (networkId, state) => {
      order.push('profile-state')
      return originalSetNetworkState(networkId, state)
    }
    const service = createNetworkService({
      db,
      profileStore,
      dispatchEvents: async intentId => {
        order.push(`dispatch:${intentId}`)
      }
    })

    const result = await service.createNetwork({ name: 'net-1', correlationId: 'corr-1' })

    expect(result.ok).toBe(true)
    // 先写 profile 状态再投递：created 事件的消费方不应观察到状态行缺失。
    expect(order).toHaveLength(3)
    expect(order[0]).toBe('transaction')
    expect(order[1]).toBe('profile-state')
    expect(order[2]).toMatch(/^dispatch:.+/)
  })
})
