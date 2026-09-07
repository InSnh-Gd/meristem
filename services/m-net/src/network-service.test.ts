import { describe, expect, it } from 'bun:test'
import { fromPartial } from '@total-typescript/shoehorn'
import { type networkMemberships, networks } from '../../../packages/db/src/schema.ts'
import type { MNetDb } from './clients.ts'
import { createNetworkService } from './network-service.ts'
import { createInMemoryProfileStore } from './profile-store.ts'

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
        profileVersion: 'm-net@0.3.0',
        status: 'active',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'network-a',
        name: 'Network A',
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
