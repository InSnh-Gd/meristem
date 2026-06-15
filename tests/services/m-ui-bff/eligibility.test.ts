import { describe, expect, it } from 'bun:test'
import type { MNode, Permission } from '../../../packages/contracts/src/index.ts'
import {
  deriveNoopCommandEligibility,
  missingPermissionCommandEligibility,
  targetMissingCommandEligibility
} from '../../../services/m-ui-bff/src/command-well/eligibility.ts'

const session = (permissions: Permission[]) => ({ permissions })

const node = (overrides: Partial<MNode> = {}): MNode => ({
  id: 'leaf-1',
  kind: 'leaf',
  name: 'Leaf 1',
  mode: 'simulated',
  status: 'healthy',
  reachability: 'reachable',
  capabilities: ['task.noop'],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides
})

describe('deriveNoopCommandEligibility', () => {
  it('enables noop command for reachable leaf nodes with task submit permission', () => {
    const eligibility = deriveNoopCommandEligibility(session(['task:submit']), node())

    expect(eligibility).toEqual({
      state: 'enabled',
      command: {
        id: 'task.noop.run',
        label: '运行 noop 任务',
        action: 'task:submit',
        resource: 'leaf-1',
        risk: 'medium',
        requiredPermissions: ['task:submit'],
        requiresPolicy: true,
        requiresAudit: true
      }
    })
  })

  it('disables noop command when task submit permission is missing', () => {
    const eligibility = deriveNoopCommandEligibility(session(['core:read']), node())

    expect(eligibility).toEqual({
      state: 'disabled',
      disabled: {
        code: 'missing_permission',
        message: '缺少权限：task:submit',
        missingPermission: 'task:submit'
      },
      disabledReason: '缺少权限：task:submit'
    })
  })

  it('disables noop command for non-leaf nodes', () => {
    const eligibility = deriveNoopCommandEligibility(
      session(['task:submit']),
      node({ kind: 'stem' })
    )

    expect(eligibility).toEqual({
      state: 'disabled',
      disabled: {
        code: 'wrong_node_kind',
        message: '目标不是 Leaf 节点'
      },
      disabledReason: '目标不是 Leaf 节点'
    })
  })

  it('disables noop command for unreachable leaf nodes', () => {
    const eligibility = deriveNoopCommandEligibility(
      session(['task:submit']),
      node({ reachability: 'unreachable' })
    )

    expect(eligibility).toEqual({
      state: 'disabled',
      disabled: {
        code: 'node_unreachable',
        message: '目标节点不可达'
      },
      disabledReason: '目标节点不可达'
    })
  })
})

describe('CommandWell disabled eligibility helpers', () => {
  it('returns the shared missing-permission disabled state', () => {
    expect(missingPermissionCommandEligibility()).toEqual({
      state: 'disabled',
      disabled: {
        code: 'missing_permission',
        message: '缺少权限：task:submit',
        missingPermission: 'task:submit'
      },
      disabledReason: '缺少权限：task:submit'
    })
  })

  it('returns the target-missing disabled state', () => {
    expect(targetMissingCommandEligibility()).toEqual({
      state: 'disabled',
      disabled: {
        code: 'target_missing',
        message: '目标节点不存在'
      },
      disabledReason: '目标节点不存在'
    })
  })
})
