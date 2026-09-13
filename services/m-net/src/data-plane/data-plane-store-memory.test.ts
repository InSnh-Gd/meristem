import { describe, expect, it } from 'bun:test'
import { createInMemoryDataPlaneStores } from '@m-net/data-plane/data-plane-store-memory.ts'

describe('in-memory nodePublicKeys.listByNode ordering', () => {
  it('returns newest createdAt first, matching the pg ORDER BY created_at DESC contract', async () => {
    const dp = createInMemoryDataPlaneStores()
    await dp.nodePublicKeys.upsert({
      nodeId: 'n1',
      keyId: 'wg-old',
      publicKey: `${'A'.repeat(43)}=`,
      fingerprint: 'fp-old',
      algorithm: 'wireguard-x25519',
      createdAt: '2026-01-01T00:00:00.000Z',
      rotationCounter: 0,
      status: 'active'
    })
    await dp.nodePublicKeys.upsert({
      nodeId: 'n1',
      keyId: 'wg-new',
      publicKey: `${'B'.repeat(43)}=`,
      fingerprint: 'fp-new',
      algorithm: 'wireguard-x25519',
      createdAt: '2026-06-01T00:00:00.000Z',
      rotationCounter: 1,
      status: 'active'
    })
    const keys = await dp.nodePublicKeys.listByNode('n1')
    // materializeMembers 取 .find(非 bootstrap) —— 必须拿到最新，而非 Map 插入序的第一个。
    expect(keys[0]?.keyId).toBe('wg-new')
  })
})
