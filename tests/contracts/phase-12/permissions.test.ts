import { describe, expect, it } from 'bun:test'

describe('Phase 12 contract type decode', () => {
  it('approval permission literals include policy:approval-read', async () => {
    const { approvalPermissions, permissions } = await import('../../../packages/contracts/src/literals.ts')
    expect(approvalPermissions).toContain('policy:approval-read')
    expect(approvalPermissions).toContain('policy:approval-approve')
    expect(approvalPermissions).toContain('policy:approval-reject')
    expect(approvalPermissions).toContain('policy:approval-manage')
    expect(permissions).toContain('policy:approval-read')
  })

  it('role permissions include approval permissions for security-admin', async () => {
    const { rolePermissions } = await import('../../../packages/policy/src/index.ts')
    expect(rolePermissions['security-admin']).toContain('policy:approval-read')
    expect(rolePermissions['security-admin']).toContain('policy:approval-approve')
    expect(rolePermissions['security-admin']).toContain('policy:approval-reject')
    expect(rolePermissions['admin']).toContain('policy:approval-read')
    expect(rolePermissions['admin']).not.toContain('policy:approval-approve')
    expect(rolePermissions['operator']).not.toContain('policy:approval-read')
  })
})
