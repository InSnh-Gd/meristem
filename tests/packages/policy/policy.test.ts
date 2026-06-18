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
    'security-admin'
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
})
