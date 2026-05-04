import { describe, expect, it } from 'bun:test'
import { decidePermission } from '../../packages/policy/src/index.ts'

describe('MVP RBAC policy', () => {
  it('allows operator node registration', () => {
    const decision = decidePermission({
      actor: 'operator',
      action: 'node:register',
      permissions: ['core:read', 'node:register', 'task:assign']
    })

    expect(decision.result).toBe('allow')
  })

  it('denies viewer node registration with a reason', () => {
    const decision = decidePermission({
      actor: 'viewer',
      action: 'node:register',
      permissions: ['core:read', 'timeline:read']
    })

    expect(decision.result).toBe('deny')
    expect(decision.reasons).toContain('missing_permission:node:register')
  })

  it('allows operator network creation', () => {
    const decision = decidePermission({
      actor: 'operator',
      action: 'network:create',
      permissions: ['core:read', 'network:create', 'network:join']
    })

    expect(decision.result).toBe('allow')
  })

  it('denies viewer network creation with a reason', () => {
    const decision = decidePermission({
      actor: 'viewer',
      action: 'network:create',
      permissions: ['core:read', 'timeline:read', 'network:read']
    })

    expect(decision.result).toBe('deny')
    expect(decision.reasons).toContain('missing_permission:network:create')
  })
})
