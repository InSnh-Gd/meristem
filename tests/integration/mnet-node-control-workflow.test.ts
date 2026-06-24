import { describe, expect, it } from 'bun:test'
import type { MNode } from '../../packages/contracts/src/index.ts'
import {
  createInMemoryNodeControlStore
} from '../../services/m-net/src/node-control-store.ts'
import { executeNodeControl } from '../../services/m-net/src/node-control-workflow.ts'

const baseNode: MNode = {
  id: 'node-control-test',
  kind: 'leaf',
  name: 'leaf-control',
  mode: 'agent',
  status: 'healthy',
  reachability: 'reachable',
  lastSeenAt: '2026-06-24T00:00:00.000Z',
  agentVersion: '0.1.0',
  capabilities: ['session'],
  createdAt: '2026-06-24T00:00:00.000Z'
}

describe('M-Net node control workflow', () => {
  it('applies a successful node control transition with event, timeline, full log, and audit facts', async () => {
    const store = createInMemoryNodeControlStore([baseNode])
    const events: unknown[] = []
    const logs: unknown[] = []

    const result = await executeNodeControl(
      {
        store,
        policyAuthorize: {
          async authorize() {
            return { result: 'allow' as const, id: 'decision-allow', reasons: [] }
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
        actor: 'admin',
        nodeId: baseNode.id,
        action: 'disable',
        reason: 'maintenance window'
      }
    )

    expect('node' in result ? result.node.status : result.kind).toBe('disabled')
    expect(store.__testing.snapshot(baseNode.id)?.status).toBe('disabled')
    expect(events).toEqual([
      expect.objectContaining({
        subject: 'node.status.changed.v0',
        type: 'node.status.changed',
        payload: expect.objectContaining({
          nodeId: baseNode.id,
          previousStatus: 'healthy',
          nextStatus: 'disabled',
          reason: 'operator_disable'
        })
      })
    ])
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'timeline', subject: 'node.status.changed' }),
        expect.objectContaining({
          kind: 'full',
          level: 'info',
          payload: expect.objectContaining({
            previousStatus: 'healthy',
            nextStatus: 'disabled',
            policyDecisionId: 'decision-allow',
            reason: 'maintenance window'
          })
        }),
        expect.objectContaining({
          kind: 'audit',
          actor: 'admin',
          action: 'node.disable.request',
          resource: `node:${baseNode.id}`,
          result: 'allow'
        }),
        expect.objectContaining({
          kind: 'audit',
          actor: 'admin',
          action: 'node.disable.success',
          resource: `node:${baseNode.id}`,
          result: 'success',
          payload: expect.objectContaining({
            previousStatus: 'healthy',
            nextStatus: 'disabled',
            policyDecisionId: 'decision-allow'
          })
        })
      ])
    )
  })

  it('does not mutate node state when policy denies the control action', async () => {
    const store = createInMemoryNodeControlStore([baseNode])
    const events: unknown[] = []
    const logs: unknown[] = []

    const result = await executeNodeControl(
      {
        store,
        policyAuthorize: {
          async authorize() {
            return { result: 'deny' as const, id: 'decision-deny', reasons: ['not allowed'] }
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
        action: 'disable',
        reason: 'manual suspension'
      }
    )

    expect(result).toEqual({
      kind: 'failure',
      status: 403,
      error: {
        code: 'policy.denied',
        message: 'node disable denied: not allowed'
      }
    })
    expect(store.__testing.snapshot(baseNode.id)?.status).toBe('healthy')
    expect(events).toHaveLength(0)
    expect(logs).toEqual([
      expect.objectContaining({
        kind: 'audit',
        actor: 'operator',
        action: 'node.disable.request',
        resource: `node:${baseNode.id}`,
        result: 'deny',
        payload: expect.objectContaining({
          previousStatus: 'healthy',
          requestedStatus: 'disabled',
          reason: 'manual suspension',
          policyDecisionId: 'decision-deny',
          policyReasons: ['not allowed']
        })
      })
    ])
  })

  it('rolls back node state when success side effects fail after mutation', async () => {
    const store = createInMemoryNodeControlStore([baseNode])

    const result = await executeNodeControl(
      {
        store,
        policyAuthorize: {
          async authorize() {
            return { result: 'allow' as const, id: 'decision-allow', reasons: [] }
          }
        },
        events: {
          async publish() {
            throw new Error('event bus unavailable')
          }
        },
        log: {
          async writeTimeline() {},
          async writeFull() {},
          async writeAudit() {}
        }
      },
      {
        actor: 'admin',
        nodeId: baseNode.id,
        action: 'disable',
        reason: 'maintenance window'
      }
    )

    expect(result).toEqual({
      kind: 'failure',
      status: 503,
      error: {
        code: 'node.control.side_effect_failed',
        message: 'event bus unavailable'
      }
    })
    expect(store.__testing.snapshot(baseNode.id)?.status).toBe('healthy')
  })

  it('switches node role and rewrites membership mode through the existing control workflow seam', async () => {
    const stemPeer: MNode = {
      ...baseNode,
      id: 'node-stem-peer',
      kind: 'stem',
      name: 'stem-peer'
    }
    const store = createInMemoryNodeControlStore([baseNode, stemPeer])
    store.__testing.joinNetwork({ networkId: 'network-1', nodeId: baseNode.id, nodeKind: 'leaf' })
    store.__testing.joinNetwork({ networkId: 'network-1', nodeId: stemPeer.id, nodeKind: 'stem' })
    const events: unknown[] = []
    const logs: unknown[] = []

    const result = await executeNodeControl(
      {
        store,
        policyAuthorize: {
          async authorize() {
            return { result: 'allow' as const, id: 'decision-role', reasons: [] }
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
            logs.push({ kind: 'audit', actor, action, resource, result: resultValue, correlationId, payload })
          }
        }
      },
      {
        actor: 'operator',
        nodeId: baseNode.id,
        action: 'switch-role',
        targetKind: 'stem',
        reason: 'promote to stem'
      }
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
    const stemNode: MNode = { ...baseNode, id: 'stem-node', kind: 'stem', name: 'stem-control' }
    const store = createInMemoryNodeControlStore([stemNode])
    store.__testing.joinNetwork({ networkId: 'network-1', nodeId: stemNode.id, nodeKind: 'stem' })

    const result = await executeNodeControl(
      {
        store,
        policyAuthorize: {
          async authorize() {
            return { result: 'allow' as const, id: 'decision-role', reasons: [] }
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
      }
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
    expect(store.__testing.memberships(stemNode.id)).toEqual([
      expect.objectContaining({ networkId: 'network-1', nodeKind: 'stem', membershipMode: 'full' })
    ])
  })

  it('fails closed when demotion would orphan any joined network even if another network has a stem', async () => {
    const stemNode: MNode = { ...baseNode, id: 'stem-node', kind: 'stem', name: 'stem-control' }
    const siblingStem: MNode = { ...baseNode, id: 'sibling-stem', kind: 'stem', name: 'sibling-stem' }
    const store = createInMemoryNodeControlStore([stemNode, siblingStem])
    store.__testing.joinNetwork({ networkId: 'network-with-peer', nodeId: stemNode.id, nodeKind: 'stem' })
    store.__testing.joinNetwork({ networkId: 'network-with-peer', nodeId: siblingStem.id, nodeKind: 'stem' })
    store.__testing.joinNetwork({ networkId: 'network-orphan-risk', nodeId: stemNode.id, nodeKind: 'stem' })

    const result = await executeNodeControl(
      {
        store,
        policyAuthorize: {
          async authorize() {
            return { result: 'allow' as const, id: 'decision-role', reasons: [] }
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
        reason: 'attempt invalid multi-network demotion'
      }
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
    expect(store.__testing.memberships(stemNode.id)).toEqual([
      expect.objectContaining({ networkId: 'network-with-peer', nodeKind: 'stem', membershipMode: 'full' }),
      expect.objectContaining({ networkId: 'network-orphan-risk', nodeKind: 'stem', membershipMode: 'full' })
    ])
  })
})
