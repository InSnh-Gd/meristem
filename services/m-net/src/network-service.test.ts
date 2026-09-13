import { describe, expect, it } from 'bun:test'
import { readdirSync } from 'node:fs'
import { fromPartial } from '@total-typescript/shoehorn'
import { type networkMemberships, networks } from '../../../packages/db/src/schema.ts'
import type { MNetDb } from './clients.ts'
import {
  deleteNetworkTx,
  type DeleteNetworkFixture,
  removeMemberTx,
  type RemoveMemberFixture
} from './network-service-fakes.ts'
import { createNetworkService } from './network-service.ts'
import { createInMemoryProfileStore } from './profile/profile-store.ts'

function createFakeDb(
  networkRows: Array<typeof networks.$inferSelect>,
  membershipRows: Array<typeof networkMemberships.$inferSelect>,
  filterCalls: { count: number }
): MNetDb {
  const membershipRowsWithFilterCount = new Proxy(membershipRows, {
    get(target, property, receiver) {
      if (property === 'filter') filterCalls.count += 1
      return Reflect.get(target, property, receiver)
    }
  })

  return fromPartial<MNetDb>({
    select: () => ({
      from: (table: unknown) =>
        Promise.resolve(table === networks ? networkRows : membershipRowsWithFilterCount)
    })
  })
}

describe('createNetworkService.listNetworks', () => {
  it('counts memberships without filtering the membership rows once per network', async () => {
    const now = new Date('2026-08-27T00:00:00.000Z')
    const networkRows = [
      {
        id: 'network-b',
        name: 'Network B',
        displayName: null,
        profileVersion: 'm-net@0.3.0',
        status: 'active',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'network-a',
        name: 'Network A',
        displayName: null,
        profileVersion: 'm-net-cn@0.3.0',
        status: 'active',
        createdAt: now,
        updatedAt: now
      }
    ] satisfies Array<typeof networks.$inferSelect>
    const membershipRows = [
      {
        networkId: 'network-a',
        nodeId: 'node-1',
        membershipMode: 'full',
        status: 'joined',
        joinedAt: now,
        updatedAt: now
      },
      {
        networkId: 'network-a',
        nodeId: 'node-2',
        membershipMode: 'restricted',
        status: 'joined',
        joinedAt: now,
        updatedAt: now
      }
    ] satisfies Array<typeof networkMemberships.$inferSelect>
    const filterCalls = { count: 0 }
    const service = createNetworkService({
      db: createFakeDb(networkRows, membershipRows, filterCalls),
      profileStore: createInMemoryProfileStore()
    })

    const result = await service.listNetworks()

    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: 'network-b',
          name: 'Network B',
          profileVersion: 'm-net@0.3.0',
          status: 'active',
          createdAt: '2026-08-27T00:00:00.000Z',
          memberCount: 0
        },
        {
          id: 'network-a',
          name: 'Network A',
          profileVersion: 'm-net-cn@0.3.0',
          status: 'active',
          createdAt: '2026-08-27T00:00:00.000Z',
          memberCount: 2
        }
      ]
    })
    expect(filterCalls.count).toBe(0)
  })
})

describe('createNetworkService.deleteNetwork', () => {
  function createTransactionDb(
    fixture: DeleteNetworkFixture,
    counter: { transaction: number; deletedTables: string[]; locks?: string[] }
  ): MNetDb {
    return fromPartial<MNetDb>({
      transaction: (fn: (value: unknown) => Promise<unknown>) => {
        counter.transaction += 1
        return fn(deleteNetworkTx(fixture, counter))
      }
    })
  }

  function serviceFor(db: MNetDb) {
    return createNetworkService({ db, profileStore: createInMemoryProfileStore() })
  }

  it('runs the cascade cleanup inside a single transaction on success', async () => {
    const counter = { transaction: 0, deletedTables: [] as string[] }
    const service = serviceFor(createTransactionDb({ networkExists: true }, counter))

    const result = await service.deleteNetwork({ networkId: 'network-a' })

    expect(result).toEqual({ ok: true, value: { networkId: 'network-a' } })
    expect(counter.transaction).toBe(1)
    // 级联覆盖面 = 运营态表 + 成员/状态行 + networks 自身；留存台账表（facts/switch 子表）不在其中。
    expect(counter.deletedTables).toEqual([
      'mnet_tunnel_address_allocations',
      'mnet_relay_assignments',
      'mnet_network_map_renders',
      'mnet_partition_states',
      'mnet_data_plane_operation_locks',
      'mnet_profile_migrations',
      'mnet_profile_transitions',
      'mnet_suspended_operations',
      'network_memberships',
      'mnet_network_profile_states',
      'networks'
    ])
  })

  it('locks the networks row FOR UPDATE so concurrent joins cannot slip past the member gate', async () => {
    const counter = { transaction: 0, deletedTables: [] as string[], locks: [] as string[] }
    const service = serviceFor(createTransactionDb({ networkExists: true }, counter))

    await service.deleteNetwork({ networkId: 'network-a' })

    expect(counter.locks).toEqual(['update'])
  })

  it('propagates a mid-cascade failure instead of swallowing it (transaction rolls back)', async () => {
    const counter = { transaction: 0, deletedTables: [] as string[] }
    const service = serviceFor(
      createTransactionDb({ networkExists: true, deleteThrowsOn: 'network_memberships' }, counter)
    )

    // fake 的 transaction 不建模回滚，但必须证明错误不被 deleteNetwork 吞成 ok/typed err。
    await expect(service.deleteNetwork({ networkId: 'network-a' })).rejects.toThrow(
      'boom:network_memberships'
    )
  })

  it('returns network.not_found when the row never existed', async () => {
    const counter = { transaction: 0, deletedTables: [] as string[] }
    const service = serviceFor(createTransactionDb({ networkExists: false }, counter))

    const result = await service.deleteNetwork({ networkId: 'network-a' })

    expect(result).toEqual({
      ok: false,
      error: { code: 'network.not_found', message: 'network not found' }
    })
    expect(counter.deletedTables).toEqual([])
  })

  it('rejects deletion while members are present, inside the transaction', async () => {
    const counter = { transaction: 0, deletedTables: [] as string[] }
    const service = serviceFor(
      createTransactionDb({ networkExists: true, membershipRows: [{ nodeId: 'node-1' }] }, counter)
    )

    const result = await service.deleteNetwork({ networkId: 'network-a' })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'network.members_present',
        message: 'network still has members; remove them first'
      }
    })
    expect(counter.transaction).toBe(1)
    expect(counter.deletedTables).toEqual([])
  })

  it('refuses an enabled profile read from the state table inside the transaction', async () => {
    const counter = { transaction: 0, deletedTables: [] as string[] }
    const service = serviceFor(
      createTransactionDb({ networkExists: true, profileRows: [{ status: 'enabled' }] }, counter)
    )

    const result = await service.deleteNetwork({ networkId: 'network-a' })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'network.profile_not_disabled',
        message: 'network profile must be disabled before deletion'
      }
    })
    expect(counter.deletedTables).toEqual([])
  })

  it('rejects deletion while retained ledgers reference the network', async () => {
    const cases = [
      {
        fixture: { networkExists: true, factRows: [{ factId: 'fact-1' }] },
        code: 'network.closed_loop_facts_present',
        message: 'network still has closed-loop facts; prune them before deletion'
      },
      {
        fixture: { networkExists: true, switchMemberRows: [{ operationId: 'op-1' }] },
        code: 'network.switch_membership_present',
        message: 'network still belongs to a profile switch operation; it cannot be deleted'
      },
      {
        fixture: { networkExists: true, suspendedRows: [{ id: 'sus-1' }] },
        code: 'network.operation_suspended',
        message:
          'network has a non-terminal suspended policy operation; resolve or prune its ledger before deletion'
      }
    ] satisfies Array<{ fixture: DeleteNetworkFixture; code: string; message: string }>

    for (const { fixture, code, message } of cases) {
      const counter = { transaction: 0, deletedTables: [] as string[] }
      const service = serviceFor(createTransactionDb(fixture, counter))

      const result = await service.deleteNetwork({ networkId: 'network-a' })

      expect(result).toEqual({ ok: false, error: { code, message } })
      expect(counter.deletedTables).toEqual([])
    }
  })
})

describe('createNetworkService.removeMember', () => {
  /**
   * 与 deleteNetwork 的 fake 同型：network_memberships 的读数在删除后切换到
   * remainingMembershipRows，建模同事务「删后读」的可见性。
   */
  function createTransactionDb(
    fixture: RemoveMemberFixture,
    counter: { transaction: number; deletedTables: string[]; locks?: string[]; order: string[] }
  ): MNetDb {
    return fromPartial<MNetDb>({
      transaction: (fn: (value: unknown) => Promise<unknown>) => {
        counter.transaction += 1
        counter.order.push('transaction')
        return fn(removeMemberTx(fixture, counter))
      }
    })
  }

  function serviceFor(db: MNetDb, refreshNetworkMap?: () => Promise<void>) {
    return createNetworkService({
      db,
      profileStore: createInMemoryProfileStore(),
      ...(refreshNetworkMap ? { refreshNetworkMap: async () => refreshNetworkMap() } : {})
    })
  }

  it('runs the cleanup inside a single transaction on success', async () => {
    const counter = { transaction: 0, deletedTables: [] as string[], order: [] as string[] }
    const service = serviceFor(
      createTransactionDb({ networkExists: true, membershipRows: [{ nodeId: 'leaf-1' }] }, counter)
    )

    const result = await service.removeMember({ networkId: 'network-a', nodeId: 'leaf-1' })

    expect(result).toEqual({ ok: true, value: { networkId: 'network-a', nodeId: 'leaf-1' } })
    expect(counter.transaction).toBe(1)
    // 隧道分配与成员行按网络+节点删除；节点已退出所有网络，sidecar 期望态与公钥一并回收。
    expect(counter.deletedTables).toEqual([
      'mnet_tunnel_address_allocations',
      'network_memberships',
      'mnet_sidecar_desired_configs',
      'mnet_node_public_keys'
    ])
  })

  it('locks the networks row FOR UPDATE so concurrent joins cannot slip past the reclaim read', async () => {
    const counter = {
      transaction: 0,
      deletedTables: [] as string[],
      locks: [] as string[],
      order: [] as string[]
    }
    const service = serviceFor(
      createTransactionDb({ networkExists: true, membershipRows: [{ nodeId: 'leaf-1' }] }, counter)
    )

    await service.removeMember({ networkId: 'network-a', nodeId: 'leaf-1' })

    expect(counter.locks).toEqual(['update'])
  })

  it('propagates a mid-cleanup failure instead of swallowing it (transaction rolls back)', async () => {
    const counter = { transaction: 0, deletedTables: [] as string[], order: [] as string[] }
    const service = serviceFor(
      createTransactionDb(
        {
          networkExists: true,
          membershipRows: [{ nodeId: 'leaf-1' }],
          deleteThrowsOn: 'network_memberships'
        },
        counter
      )
    )

    await expect(
      service.removeMember({ networkId: 'network-a', nodeId: 'leaf-1' })
    ).rejects.toThrow('boom:network_memberships')
  })

  it('returns typed errors before any delete when network or membership is missing', async () => {
    const cases = [
      {
        fixture: { networkExists: false },
        code: 'network.not_found',
        message: 'network not found'
      },
      {
        fixture: { networkExists: true },
        code: 'network.member_not_found',
        message: 'node is not a network member'
      }
    ] satisfies Array<{ fixture: RemoveMemberFixture; code: string; message: string }>

    for (const { fixture, code, message } of cases) {
      const counter = { transaction: 0, deletedTables: [] as string[], order: [] as string[] }
      const refreshCalls: string[] = []
      const service = serviceFor(createTransactionDb(fixture, counter), async () => {
        refreshCalls.push('refresh')
      })

      const result = await service.removeMember({ networkId: 'network-a', nodeId: 'leaf-1' })

      expect(result).toEqual({ ok: false, error: { code, message } })
      expect(counter.deletedTables).toEqual([])
      // 失败路径不触发地图刷新。
      expect(refreshCalls).toEqual([])
    }
  })

  it('keeps node-scoped sidecar config and keys while the node retains other memberships', async () => {
    const counter = { transaction: 0, deletedTables: [] as string[], order: [] as string[] }
    const service = serviceFor(
      createTransactionDb(
        {
          networkExists: true,
          membershipRows: [{ nodeId: 'leaf-1' }],
          remainingMembershipRows: [{ networkId: 'network-b', nodeId: 'leaf-1' }]
        },
        counter
      )
    )

    const result = await service.removeMember({ networkId: 'network-a', nodeId: 'leaf-1' })

    expect(result).toEqual({ ok: true, value: { networkId: 'network-a', nodeId: 'leaf-1' } })
    expect(counter.deletedTables).toEqual([
      'mnet_tunnel_address_allocations',
      'network_memberships'
    ])
  })

  it('reclaims sidecar desired config and keys after the last membership, refreshing after commit', async () => {
    const counter = { transaction: 0, deletedTables: [] as string[], order: [] as string[] }
    const service = serviceFor(
      createTransactionDb(
        {
          networkExists: true,
          membershipRows: [{ nodeId: 'leaf-1' }],
          remainingMembershipRows: []
        },
        counter
      ),
      async () => {
        counter.order.push('refresh')
      }
    )

    const result = await service.removeMember({ networkId: 'network-a', nodeId: 'leaf-1' })

    expect(result).toEqual({ ok: true, value: { networkId: 'network-a', nodeId: 'leaf-1' } })
    expect(counter.deletedTables).toEqual([
      'mnet_tunnel_address_allocations',
      'network_memberships',
      'mnet_sidecar_desired_configs',
      'mnet_node_public_keys'
    ])
    // refresher 走 materialize/HTTP/eventbus，必须在事务提交之后调用，不能持锁等待外部服务。
    expect(counter.order).toEqual(['transaction', 'refresh'])
  })
})

describe('deleteNetwork foreign-key coverage guard', () => {
  /**
   * 新增以 network_id 外键挂 networks 的表时，若未被 deleteNetwork 处置，
   * 生产会在删 networks 行时 FK 违例 500。本守卫强制任何 schema 漂移在测试面直接失败，
   * 要求把新表显式登记为：级联清理 / 台账门禁 / 明确留存（带理由）。
   */
  const CASCADE_HANDLED = new Set([
    'network_memberships',
    'mnet_network_profile_states',
    'mnet_profile_transitions',
    'mnet_suspended_operations',
    'mnet_profile_migrations',
    'mnet_network_map_renders',
    'mnet_tunnel_address_allocations',
    'mnet_relay_assignments',
    'mnet_data_plane_operation_locks',
    'mnet_partition_states'
  ])
  const GATE_HANDLED = new Set(['mnet_closed_loop_facts', 'mnet_profile_switch_batch_members'])
  const RETAINED_WITH_DECISION = new Set([
    // switch results/snapshots 是留存台账：它们同时 FK 挂 operations，
    // 生命周期跟随切换操作而非网络；网络删除经 batch_members 门禁先行拒绝。
    // 依赖不变式：batch_members 行永不被其他路径清理（全仓无 delete(mnetProfileSwitchBatchMembers)），
    // 若未来引入成员清理而保留 results/snapshots，本门禁会静默失效，必须同步改级联。
    'mnet_profile_switch_results',
    'mnet_profile_switch_snapshots'
  ])

  it('every networks.id foreign key is registered against a delete-network decision', async () => {
    const schemaDirectory = new URL('../../../packages/db/src/schema/', import.meta.url)
    // 动态枚举，新增 schema 文件自动进入守卫范围，不依赖硬编码清单。
    const fileNames = readdirSync(new URL('.', schemaDirectory))
      .filter(fileName => fileName.endsWith('.ts') && fileName !== 'relations.ts')
      .sort()
    const referencing: string[] = []
    for (const fileName of fileNames) {
      const source = await Bun.file(new URL(fileName, schemaDirectory)).text()
      for (const match of source.matchAll(
        /export const \w+ = pgTable\(\s*'([a-z0-9_]+)'([\s\S]*?)(?=\nexport const|\s*$)/g
      )) {
        const table = match[1]
        const body = match[2]
        const normalized = body === undefined ? '' : body.replace(/\s+/g, '')
        if (table !== undefined && normalized.includes('()=>networks.id')) {
          referencing.push(table)
        }
      }
    }
    const unregistered = [...new Set(referencing)].filter(
      table =>
        !CASCADE_HANDLED.has(table) &&
        !GATE_HANDLED.has(table) &&
        !RETAINED_WITH_DECISION.has(table)
    )
    expect(
      unregistered,
      `tables referencing networks.id without a delete-network decision: ${unregistered.join(', ')}. ` +
        'Add them to the cascade list, a rejection gate, or record an explicit retention decision.'
    ).toEqual([])
    // 反向防漂移：登记的集合必须真实存在于 schema 引用列表中，防止幽灵条目掩盖缺口。
    const uniqueReferencing = [...new Set(referencing)]
    const registered = [...CASCADE_HANDLED, ...GATE_HANDLED, ...RETAINED_WITH_DECISION]
    expect(registered.filter(table => !uniqueReferencing.includes(table))).toEqual([])
    expect(uniqueReferencing).toHaveLength(
      CASCADE_HANDLED.size + GATE_HANDLED.size + RETAINED_WITH_DECISION.size
    )
  })
})
