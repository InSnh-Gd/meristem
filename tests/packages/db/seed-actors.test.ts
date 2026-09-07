import { describe, expect, it } from 'bun:test'
import { localSeedActors } from '../../../packages/db/src/seed-actors.ts'

describe('local seed actor roles', () => {
  it('maps the second security administrator to the existing security-admin role exactly once', () => {
    const secondSecurityAdmin = localSeedActors.filter(actor => actor.id === 'security-admin-2')

    expect(secondSecurityAdmin).toEqual([
      { id: 'security-admin-2', displayName: 'Security Admin 2', roleId: 'security-admin' }
    ])
    expect(new Set(localSeedActors.map(actor => actor.id)).size).toBe(localSeedActors.length)
  })

  it('keeps the local role vocabulary unchanged while assigning every actor to a seeded role', () => {
    expect(new Set(localSeedActors.map(actor => actor.roleId))).toEqual(
      new Set(['viewer', 'operator', 'admin', 'security-admin'])
    )
  })
})
