import { describe, expect, it } from 'bun:test'
import {
  decidePermission,
  type PolicyInput,
  rolePermissions
} from '../../../packages/policy/src/index.ts'

describe('decidePermission', () => {
  it('allows an actor with a matching permission', () => {
    const input: PolicyInput = {
      actor: 'viewer',
      action: 'core:read',
      permissions: ['core:read']
    }

    expect(decidePermission(input)).toEqual({
      actor: 'viewer',
      action: 'core:read',
      resource: 'core:read',
      result: 'allow',
      reasons: ['permission_present']
    })
  })

  it('denies an actor without a matching permission', () => {
    const input: PolicyInput = {
      actor: 'viewer',
      action: 'task:submit',
      permissions: ['core:read']
    }

    expect(decidePermission(input)).toEqual({
      actor: 'viewer',
      action: 'task:submit',
      resource: 'task:submit',
      result: 'deny',
      reasons: ['missing_permission:task:submit']
    })
  })

  it('defaults resource to action when resource is not provided', () => {
    const decision = decidePermission({
      actor: 'operator',
      action: 'task:submit',
      permissions: ['task:submit']
    })

    expect(decision.resource).toBe('task:submit')
  })

  it('preserves a custom resource in the result', () => {
    const decision = decidePermission({
      actor: 'operator',
      action: 'task:submit',
      permissions: ['task:submit'],
      resource: 'policy-test-resource'
    })

    expect(decision.resource).toBe('policy-test-resource')
  })
})

describe('rolePermissions', () => {
  it.each([
    'viewer',
    'operator',
    'admin',
    'security-admin',
    'break-glass-reviewer'
  ] as const)('has non-empty permissions for %s', actor => {
    expect(rolePermissions[actor].length).toBeGreaterThan(0)
  })

  it('gives admin all viewer permissions plus more', () => {
    for (const permission of rolePermissions.viewer) {
      expect(rolePermissions.admin).toContain(permission)
    }
    expect(rolePermissions.admin.length).toBeGreaterThan(rolePermissions.viewer.length)
  })

  it('gives security-admin audit read permission', () => {
    expect(rolePermissions['security-admin']).toContain('audit:read')
  })

  it('limits break-glass-reviewer to approval review without privileged operation permissions', () => {
    expect(rolePermissions['break-glass-reviewer']).toContain('policy:approval-read')
    expect(rolePermissions['break-glass-reviewer']).toContain('policy:approval-approve')
    expect(rolePermissions['break-glass-reviewer']).toContain('policy:approval-reject')
    expect(rolePermissions['break-glass-reviewer']).toContain('audit:read')
    expect(rolePermissions['break-glass-reviewer']).not.toContain('network:profile-enable')
    expect(rolePermissions['break-glass-reviewer']).not.toContain('network:profile-disable')
    expect(rolePermissions['break-glass-reviewer']).not.toContain('node:disable')
    expect(rolePermissions['break-glass-reviewer']).not.toContain('secret:reference')
  })

  it('limits node control permissions to admin roles only', () => {
    for (const actor of ['viewer', 'operator', 'break-glass-reviewer'] as const) {
      expect(rolePermissions[actor]).not.toContain('node:switch-role')
      expect(rolePermissions[actor]).not.toContain('node:disable')
      expect(rolePermissions[actor]).not.toContain('node:isolate')
      expect(rolePermissions[actor]).not.toContain('node:recover')
    }
    for (const actor of ['admin', 'security-admin'] as const) {
      expect(rolePermissions[actor]).toContain('node:switch-role')
      expect(rolePermissions[actor]).toContain('node:disable')
      expect(rolePermissions[actor]).toContain('node:isolate')
      expect(rolePermissions[actor]).toContain('node:recover')
    }
  })
})
