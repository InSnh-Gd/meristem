import { describe, expect, it } from 'bun:test'
import type { MNode, Permission } from '../../../packages/contracts/src/index.ts'
import {
  deriveNodeControlCommandEligibility,
  deriveNoopCommandEligibility,
  isNodeControlExecuteCommandId,
  missingPermissionCommandEligibility,
  targetMissingCommandEligibility
} from '../../../services/m-ui-bff/src/command-well/eligibility.ts'
import {
  NODE_DISABLE_EXECUTE_COMMAND_ID,
  NODE_ISOLATE_EXECUTE_COMMAND_ID,
  NODE_RECOVER_EXECUTE_COMMAND_ID
} from '../../../services/m-ui-bff/src/types.ts'

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

  it('fails closed for administratively controlled leaf nodes', () => {
    const controlledStatuses = [
      ['disabled', '节点已禁用，不能运行任务'],
      ['isolated', '节点已隔离，不能运行任务'],
      ['recovering', '节点正在恢复，等待有效 heartbeat 后才能运行任务']
    ] as const

    for (const [status, disabledReason] of controlledStatuses) {
      const eligibility = deriveNoopCommandEligibility(
        session(['task:submit']),
        node({ status, reachability: 'reachable' })
      )

      expect(eligibility).toEqual({
        state: 'disabled',
        disabled: {
          code: 'node_unreachable',
          message: disabledReason
        },
        disabledReason
      })
    }
  })
})

describe('deriveNodeControlCommandEligibility', () => {
  it('recognizes node control execute command ids', () => {
    expect(isNodeControlExecuteCommandId(NODE_DISABLE_EXECUTE_COMMAND_ID)).toBe(true)
    expect(isNodeControlExecuteCommandId(NODE_ISOLATE_EXECUTE_COMMAND_ID)).toBe(true)
    expect(isNodeControlExecuteCommandId(NODE_RECOVER_EXECUTE_COMMAND_ID)).toBe(true)
    expect(isNodeControlExecuteCommandId('task.noop.submit')).toBe(false)
  })

  it('enables disable and isolate only for backend-accepted active statuses', () => {
    expect(
      deriveNodeControlCommandEligibility(
        session(['node:disable']),
        node({ status: 'healthy' }),
        NODE_DISABLE_EXECUTE_COMMAND_ID
      )
    ).toEqual({
      state: 'enabled',
      command: {
        id: NODE_DISABLE_EXECUTE_COMMAND_ID,
        label: '禁用节点',
        action: 'node:disable',
        resource: 'leaf-1',
        risk: 'high',
        requiredPermissions: ['node:disable'],
        requiresPolicy: true,
        requiresAudit: true
      }
    })

    expect(
      deriveNodeControlCommandEligibility(
        session(['node:isolate']),
        node({ status: 'disabled' }),
        NODE_ISOLATE_EXECUTE_COMMAND_ID
      )
    ).toEqual({
      state: 'disabled',
      disabled: {
        code: 'node_unreachable',
        message: '节点当前为 disabled，不能执行 isolate'
      },
      disabledReason: '节点当前为 disabled，不能执行 isolate'
    })
  })

  it('enables recover only for disabled or isolated nodes', () => {
    expect(
      deriveNodeControlCommandEligibility(
        session(['node:recover']),
        node({ status: 'isolated' }),
        NODE_RECOVER_EXECUTE_COMMAND_ID
      )
    ).toEqual({
      state: 'enabled',
      command: {
        id: NODE_RECOVER_EXECUTE_COMMAND_ID,
        label: '恢复节点',
        action: 'node:recover',
        resource: 'leaf-1',
        risk: 'high',
        requiredPermissions: ['node:recover'],
        requiresPolicy: true,
        requiresAudit: true
      }
    })

    expect(
      deriveNodeControlCommandEligibility(
        session(['node:recover']),
        node({ status: 'recovering' }),
        NODE_RECOVER_EXECUTE_COMMAND_ID
      )
    ).toEqual({
      state: 'disabled',
      disabled: {
        code: 'node_unreachable',
        message: '节点当前为 recovering，不能执行 recover'
      },
      disabledReason: '节点当前为 recovering，不能执行 recover'
    })
  })

  it('fails closed when the actor lacks the node control permission', () => {
    expect(
      deriveNodeControlCommandEligibility(
        session(['core:read']),
        node({ status: 'disabled' }),
        NODE_RECOVER_EXECUTE_COMMAND_ID
      )
    ).toEqual({
      state: 'disabled',
      disabled: {
        code: 'missing_permission',
        message: '缺少权限：node:recover',
        missingPermission: 'node:recover'
      },
      disabledReason: '缺少权限：node:recover'
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
