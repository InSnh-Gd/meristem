import { describe, expect, it } from 'bun:test'
import { hashNodeToken } from '../../packages/auth/src/index.ts'
import { err, ok } from '../../packages/common/src/result.ts'
import { nodeCredentials, nodes } from '../../packages/db/src/schema.ts'
import {
  applyHeartbeat,
  type HeartbeatRuntimeContext,
  type RuntimeCredentialContext,
  validateNodeCredential
} from '../../services/m-net/src/agent-runtime-session-lifecycle.ts'
import {
  buildJoinSessionUrl,
  deriveHeartbeatTransition,
  deriveRecoveryCompletionEvidence,
  joinTicketRedeemability,
  shouldTransitionOffline
} from '../../services/m-net/src/runtime.ts'

type NodeRow = typeof nodes.$inferSelect
type NodeCredentialRow = typeof nodeCredentials.$inferSelect

function createHeartbeatContext(
  initialNode: NodeRow,
  overrides?: {
    writeAudit?(): Promise<void>
  }
): {
  context: HeartbeatRuntimeContext
  snapshot(): NodeRow
  events: unknown[]
  timeline: unknown[]
  audit: unknown[]
} {
  let currentNode = { ...initialNode }
  const events: unknown[] = []
  const timeline: unknown[] = []
  const audit: unknown[] = []
  const db: HeartbeatRuntimeContext['db'] = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  return [currentNode]
                }
              }
            }
          }
        }
      }
    },
    update() {
      return {
        set(values: Partial<NodeRow>) {
          return {
            async where() {
              currentNode = { ...currentNode, ...values }
            }
          }
        }
      }
    }
  }

  return {
    context: {
      db,
      async publishEvent(subject, type, payload) {
        events.push({ subject, type, payload })
      },
      async writeTimeline(summary, subject) {
        timeline.push({ summary, subject })
      },
      async writeFull(level, message, _correlationId, _traceId, payload) {
        timeline.push({ kind: 'full', level, message, payload })
      },
      async writeAudit(resource, action, _correlationId, _traceId, payload) {
        if (overrides?.writeAudit) return await overrides.writeAudit()
        audit.push({ resource, action, payload })
      }
    },
    snapshot() {
      return { ...currentNode }
    },
    events,
    timeline,
    audit
  }
}

function createRuntimeCredentialContext(credential: NodeCredentialRow | null): {
  context: RuntimeCredentialContext
  snapshot(): NodeCredentialRow | null
} {
  let currentCredential = credential ? { ...credential } : null
  const db: RuntimeCredentialContext['db'] = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  return currentCredential?.status === 'active' ? [{ ...currentCredential }] : []
                }
              }
            }
          }
        }
      }
    },
    update() {
      return {
        set(values: Partial<NodeCredentialRow>) {
          return {
            async where() {
              if (currentCredential) currentCredential = { ...currentCredential, ...values }
            }
          }
        }
      }
    }
  }

  return {
    context: { db },
    snapshot() {
      return currentCredential ? { ...currentCredential } : null
    }
  }
}

async function runtimeCredentialRow(input: {
  token: string
  status: 'active' | 'revoked'
}): Promise<NodeCredentialRow> {
  const issuedAt = new Date('2026-05-05T12:00:00.000Z')
  return {
    id: 'credential-runtime-auth-1',
    nodeId: 'node-runtime-auth-1',
    tokenHash: await hashNodeToken(input.token),
    status: input.status,
    issuedAt,
    revokedAt: input.status === 'revoked' ? new Date('2026-05-05T12:01:00.000Z') : null,
    lastUsedAt: null
  }
}

function recoveringNodeRow(): NodeRow {
  const now = new Date('2026-05-05T11:59:55.000Z')
  return {
    id: 'node-recovering-apply-heartbeat',
    kind: 'leaf',
    name: 'node-recovering-apply-heartbeat',
    mode: 'agent',
    status: 'recovering',
    reachability: 'unreachable',
    lastSeenAt: now,
    agentVersion: '0.1.0',
    capabilities: [],
    scope: {},
    createdAt: now,
    updatedAt: now
  }
}

function claimJoinTicketWinner(input: {
  latestStatus: 'active' | 'redeemed' | 'expired' | 'revoked' | undefined
  latestRedeemedNodeId: string | null | undefined
  expectedNodeId: string
}) {
  if (input.latestStatus !== 'redeemed') {
    if (input.latestStatus === 'expired') {
      return err({ code: 'node.join_ticket_expired', message: 'join ticket is expired' })
    }
    if (input.latestStatus === 'revoked') {
      return err({ code: 'node.join_ticket_revoked', message: 'join ticket has been revoked' })
    }
    return err({ code: 'node.join_ticket_invalid', message: 'join ticket is invalid' })
  }

  return input.latestRedeemedNodeId === input.expectedNodeId
    ? ok('claimed')
    : err({ code: 'node.join_ticket_redeemed', message: 'join ticket has already been redeemed' })
}

describe('M-Net node-agent runtime helpers', () => {
  it('validates only the active runtime credential hash used by session resume', async () => {
    const harness = createRuntimeCredentialContext(
      await runtimeCredentialRow({ token: 'active-runtime-token', status: 'active' })
    )

    expect(
      await validateNodeCredential(harness.context, 'node-runtime-auth-1', 'active-runtime-token')
    ).toBe(true)
    expect(harness.snapshot()?.lastUsedAt).toBeInstanceOf(Date)
    expect(await validateNodeCredential(harness.context, 'node-runtime-auth-1', 'old-token')).toBe(
      false
    )
  })

  it('rejects revoked runtime credentials at the session resume auth primitive', async () => {
    const harness = createRuntimeCredentialContext(
      await runtimeCredentialRow({ token: 'revoked-runtime-token', status: 'revoked' })
    )

    expect(
      await validateNodeCredential(harness.context, 'node-runtime-auth-1', 'revoked-runtime-token')
    ).toBe(false)
  })

  it('promotes reachable agent nodes from joining to healthy on heartbeat', () => {
    const transition = deriveHeartbeatTransition(
      {
        id: 'node-1',
        mode: 'agent',
        status: 'joining',
        reachability: 'unknown'
      },
      {
        type: 'heartbeat',
        sessionId: 'session-1',
        agentVersion: '0.1.0',
        reportedStatus: 'healthy',
        timestamp: '2026-05-05T12:00:00.000Z'
      }
    )

    expect(transition.nextStatus).toBe('healthy')
    expect(transition.nextReachability).toBe('reachable')
    expect(transition.statusChanged).toBe(true)
    expect(transition.reachabilityChanged).toBe(true)
  })

  it('closes recovering nodes to the reported runtime status on heartbeat', () => {
    const recoveringNode = {
      id: 'node-recovering-1',
      mode: 'agent' as const,
      status: 'recovering' as const,
      reachability: 'unreachable' as const
    }
    const heartbeat = {
      type: 'heartbeat' as const,
      sessionId: 'session-recovering-1',
      agentVersion: '0.2.0',
      reportedStatus: 'healthy' as const,
      timestamp: '2026-05-05T12:00:00.000Z'
    }
    const healthyTransition = deriveHeartbeatTransition(recoveringNode, heartbeat)

    const degradedTransition = deriveHeartbeatTransition(
      {
        id: 'node-recovering-2',
        mode: 'agent',
        status: 'recovering',
        reachability: 'reachable'
      },
      {
        type: 'heartbeat',
        sessionId: 'session-recovering-2',
        agentVersion: '0.2.0',
        reportedStatus: 'degraded',
        timestamp: '2026-05-05T12:00:05.000Z'
      }
    )

    expect(healthyTransition.nextStatus).toBe('healthy')
    expect(healthyTransition.statusChanged).toBe(true)
    expect(healthyTransition.reachabilityChanged).toBe(true)
    expect(deriveRecoveryCompletionEvidence(recoveringNode, heartbeat, healthyTransition)).toEqual({
      nodeId: 'node-recovering-1',
      previousStatus: 'recovering',
      nextStatus: 'healthy',
      heartbeatTimestamp: '2026-05-05T12:00:00.000Z',
      agentVersion: '0.2.0'
    })
    expect(degradedTransition.nextStatus).toBe('degraded')
    expect(degradedTransition.statusChanged).toBe(true)
    expect(degradedTransition.reachabilityChanged).toBe(false)
  })

  it('persists recovery heartbeat and writes completion evidence through applyHeartbeat', async () => {
    const harness = createHeartbeatContext(recoveringNodeRow())

    const result = await applyHeartbeat(harness.context, 'node-recovering-apply-heartbeat', {
      type: 'heartbeat',
      sessionId: 'session-recovering-apply-heartbeat',
      agentVersion: '0.2.0',
      reportedStatus: 'healthy',
      timestamp: '2026-05-05T12:00:00.000Z'
    })

    expect(result).toEqual(ok(undefined))
    expect(harness.snapshot().status).toBe('healthy')
    expect(harness.snapshot().reachability).toBe('reachable')
    expect(harness.events).toContainEqual(
      expect.objectContaining({ subject: 'node.status.changed.v0', type: 'node.status.changed' })
    )
    expect(harness.audit).toContainEqual(
      expect.objectContaining({
        resource: 'node:node-recovering-apply-heartbeat',
        action: 'node:recover-completed'
      })
    )
    expect(harness.timeline).toContainEqual(
      expect.objectContaining({
        summary: 'node recovery completed as healthy node-recovering-apply-heartbeat',
        subject: 'node-recovering-apply-heartbeat'
      })
    )
  })

  it('rolls back a recovery heartbeat when completion evidence fails', async () => {
    const harness = createHeartbeatContext(recoveringNodeRow(), {
      async writeAudit() {
        throw new Error('audit unavailable')
      }
    })

    await expect(
      applyHeartbeat(harness.context, 'node-recovering-apply-heartbeat', {
        type: 'heartbeat',
        sessionId: 'session-recovering-apply-heartbeat',
        agentVersion: '0.2.0',
        reportedStatus: 'healthy',
        timestamp: '2026-05-05T12:00:00.000Z'
      })
    ).rejects.toThrow('audit unavailable')

    expect(harness.snapshot().status).toBe('recovering')
    expect(harness.snapshot().reachability).toBe('unreachable')
  })

  it('marks stale reachable agent nodes offline after the timeout window', () => {
    expect(
      shouldTransitionOffline(
        {
          id: 'node-1',
          mode: 'agent',
          status: 'healthy',
          reachability: 'reachable',
          lastSeenAt: '2026-05-05T11:59:30.000Z'
        },
        new Date('2026-05-05T12:00:00.000Z'),
        20_000
      )
    ).toBe(true)

    expect(
      shouldTransitionOffline(
        {
          id: 'node-1',
          mode: 'agent',
          status: 'healthy',
          reachability: 'reachable',
          lastSeenAt: '2026-05-05T11:59:50.000Z'
        },
        new Date('2026-05-05T12:00:00.000Z'),
        20_000
      )
    ).toBe(false)
  })

  it('derives the public join session url from the configured join ingress base url', () => {
    expect(buildJoinSessionUrl('https://45.204.206.45:8443')).toBe(
      'wss://45.204.206.45:8443/join/v0/session'
    )
    expect(buildJoinSessionUrl('http://localhost:8443/base/')).toBe(
      'ws://localhost:8443/base/join/v0/session'
    )
  })

  it('rejects expired and non-active join tickets before redemption', () => {
    expect(
      joinTicketRedeemability(
        {
          status: 'active',
          expiresAt: '2026-05-05T11:59:59.000Z'
        },
        new Date('2026-05-05T12:00:00.000Z')
      )
    ).toBe('expired')

    expect(
      joinTicketRedeemability(
        {
          status: 'redeemed',
          expiresAt: '2026-05-05T12:01:00.000Z'
        },
        new Date('2026-05-05T12:00:00.000Z')
      )
    ).toBe('redeemed')

    expect(
      joinTicketRedeemability(
        {
          status: 'active',
          expiresAt: '2026-05-05T12:01:00.000Z'
        },
        new Date('2026-05-05T12:00:00.000Z')
      )
    ).toBe('redeemable')
  })

  it('treats redeemed ownership as the stable winner signal for single-use join tickets', () => {
    expect(
      claimJoinTicketWinner({
        latestStatus: 'redeemed',
        latestRedeemedNodeId: 'node-1',
        expectedNodeId: 'node-1'
      })
    ).toEqual(ok('claimed'))

    expect(
      claimJoinTicketWinner({
        latestStatus: 'redeemed',
        latestRedeemedNodeId: 'node-1',
        expectedNodeId: 'node-2'
      })
    ).toEqual(
      err({
        code: 'node.join_ticket_redeemed',
        message: 'join ticket has already been redeemed'
      })
    )
  })
})
