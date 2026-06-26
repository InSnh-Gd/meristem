import { describe, expect, it } from 'bun:test'
import type { MNode } from '../../packages/contracts/src/index.ts'
import { createInMemoryNodeControlStore } from '../../services/m-net/src/node-control-store.ts'
import { executeNodeRoleSwitch } from '../../services/m-net/src/node-role-switch-workflow.ts'

const baseNode: MNode = {
  id: 'role-switch-test',
  kind: 'leaf',
  name: 'leaf-role-switch',
  mode: 'agent',
  status: 'healthy',
  reachability: 'reachable',
  lastSeenAt: '2026-06-25T00:00:00.000Z',
  agentVersion: '0.1.0',
  capabilities: ['session'],
  createdAt: '2026-06-25T00:00:00.000Z'
}

describe('M-Net node role switch workflow (direct seam test)', () => {
  it('promotes a leaf to stem with role.changed event, timeline, and audit facts', async () => {
    const store = createInMemoryNodeControlStore([baseNode])
    store.__testing.joinNetwork({ networkId: 'network-1', nodeId: baseNode.id, nodeKind: 'leaf' })

    const events: unknown[] = []
    const logs: unknown[] = []

    const result = await executeNodeRoleSwitch(
      {
        store,
        policyAuthorize: {
          async authorize() {
            return { result: 'allow' as const, id: 'decision-promote', reasons: [] }
          }
        },
        events: {
          async publish(subject, type, payload, correlationId) {
            events.push({ subject, type, payload, correlationId })
          }
        },
        log: {
          async writeTimeline(summary, subject, correlationId) {
            logs.push({ kind: 'timeline', summary, subject, correlationId })
          },
          async writeFull(level, message, correlationId, payload) {
            logs.push({ kind: 'full', level, message, correlationId, payload })
          },
          async writeAudit(actor, action, resource, resultValue, correlationId, payload) {
            logs.push({
              kind: 'audit',
              actor,
              action,
              resource,
              result: resultValue,
              correlationId,
              payload
            })
          }
        }
      },
      {
        actor: 'operator',
        nodeId: baseNode.id,
        action: 'switch-role',
        targetKind: 'stem',
        reason: 'promote to stem'
      },
      { id: baseNode.id, kind: 'leaf' }
    )

    expect('node' in result ? result.node.kind : result.kind).toBe('stem')
    expect(store.__testing.snapshot(baseNode.id)?.kind).toBe('stem')
    expect(store.__testing.memberships(baseNode.id)).toEqual([
      expect.objectContaining({ networkId: 'network-1', nodeKind: 'stem', membershipMode: 'full' })
    ])
    expect(events).toEqual([
      expect.objectContaining({
        subject: 'node.role.changed.v0',
        type: 'node.role.changed',
        payload: expect.objectContaining({
          nodeId: baseNode.id,
          previousKind: 'leaf',
          nextKind: 'stem'
        })
      })
    ])
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'timeline', subject: 'node.role.changed' }),
        expect.objectContaining({
          kind: 'audit',
          actor: 'operator',
          action: 'node.switch-role.success',
          resource: `node:${baseNode.id}`,
          result: 'success'
        })
      ])
    )
  })

  it('fails closed when demoting the last stem member in a network', async () => {
    const stemNode: MNode = { ...baseNode, id: 'stem-last', kind: 'stem', name: 'stem-last' }
    const store = createInMemoryNodeControlStore([stemNode])
    store.__testing.joinNetwork({ networkId: 'network-1', nodeId: stemNode.id, nodeKind: 'stem' })

    const result = await executeNodeRoleSwitch(
      {
        store,
        policyAuthorize: {
          async authorize() {
            return { result: 'allow' as const, id: 'decision-demote', reasons: [] }
          }
        },
        log: {
          async writeTimeline() {},
          async writeFull() {},
          async writeAudit() {}
        }
      },
      {
        actor: 'operator',
        nodeId: stemNode.id,
        action: 'switch-role',
        targetKind: 'leaf',
        reason: 'attempt invalid demotion'
      },
      { id: stemNode.id, kind: 'stem' }
    )

    expect(result).toEqual({
      kind: 'failure',
      status: 409,
      error: {
        code: 'node.control.last_stem_required',
        message: 'network requires at least one stem member'
      }
    })
    expect(store.__testing.snapshot(stemNode.id)?.kind).toBe('stem')
  })

  it('fails when targetKind is missing', async () => {
    const store = createInMemoryNodeControlStore([baseNode])

    const result = await executeNodeRoleSwitch(
      {
        store,
        policyAuthorize: {
          async authorize() {
            return { result: 'allow' as const, id: 'decision-missing', reasons: [] }
          }
        },
        log: {
          async writeTimeline() {},
          async writeFull() {},
          async writeAudit() {}
        }
      },
      {
        actor: 'operator',
        nodeId: baseNode.id,
        action: 'switch-role',
        reason: 'missing target'
      },
      { id: baseNode.id, kind: 'leaf' }
    )

    expect(result).toEqual({
      kind: 'failure',
      status: 409,
      error: {
        code: 'node.control.target_kind_required',
        message: 'target kind is required for role switch'
      }
    })
  })

  it('denies and writes deny audit when policy rejects', async () => {
    const store = createInMemoryNodeControlStore([baseNode])
    store.__testing.joinNetwork({ networkId: 'network-1', nodeId: baseNode.id, nodeKind: 'leaf' })

    const logs: unknown[] = []

    const result = await executeNodeRoleSwitch(
      {
        store,
        policyAuthorize: {
          async authorize() {
            return { result: 'deny' as const, id: 'decision-deny', reasons: ['insufficient role'] }
          }
        },
        log: {
          async writeTimeline() {},
          async writeFull() {},
          async writeAudit(actor, action, resource, resultValue, correlationId, payload) {
            logs.push({
              kind: 'audit',
              actor,
              action,
              resource,
              result: resultValue,
              correlationId,
              payload
            })
          }
        }
      },
      {
        actor: 'viewer',
        nodeId: baseNode.id,
        action: 'switch-role',
        targetKind: 'stem',
        reason: 'unauthorized attempt'
      },
      { id: baseNode.id, kind: 'leaf' }
    )

    expect(result).toEqual({
      kind: 'failure',
      status: 403,
      error: { code: 'policy.denied', message: expect.stringContaining('denied') }
    })
    expect(logs).toEqual([
      expect.objectContaining({
        kind: 'audit',
        actor: 'viewer',
        action: 'node.switch-role.request',
        result: 'deny'
      })
    ])
    expect(store.__testing.snapshot(baseNode.id)?.kind).toBe('leaf')
  })

  it('rolls back role update when side-effect publishing fails', async () => {
    const store = createInMemoryNodeControlStore([baseNode])
    store.__testing.joinNetwork({ networkId: 'network-1', nodeId: baseNode.id, nodeKind: 'leaf' })

    const result = await executeNodeRoleSwitch(
      {
        store,
        policyAuthorize: {
          async authorize() {
            return { result: 'allow' as const, id: 'decision-rollback', reasons: [] }
          }
        },
        events: {
          async publish() {
            throw new Error('eventbus offline')
          }
        },
        log: {
          async writeTimeline() {},
          async writeFull() {},
          async writeAudit() {}
        }
      },
      {
        actor: 'operator',
        nodeId: baseNode.id,
        action: 'switch-role',
        targetKind: 'stem',
        reason: 'trigger rollback'
      },
      { id: baseNode.id, kind: 'leaf' }
    )

    expect(result).toEqual({
      kind: 'failure',
      status: 503,
      error: { code: 'node.control.side_effect_failed', message: 'eventbus offline' }
    })
    expect(store.__testing.snapshot(baseNode.id)?.kind).toBe('leaf')
  })
})
