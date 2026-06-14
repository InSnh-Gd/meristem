import { t } from 'elysia'

export const nodeSchema = t.Object({
  id: t.String(),
  kind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
  name: t.String(),
  mode: t.Union([t.Literal('agent'), t.Literal('simulated')]),
  status: t.Union([
    t.Literal('joining'),
    t.Literal('healthy'),
    t.Literal('degraded'),
    t.Literal('offline'),
    t.Literal('revoked')
  ]),
  reachability: t.Union([t.Literal('unknown'), t.Literal('reachable'), t.Literal('unreachable')]),
  lastSeenAt: t.Optional(t.String()),
  agentVersion: t.Optional(t.String()),
  capabilities: t.Array(t.String()),
  createdAt: t.String()
})

export const taskSchema = t.Object({
  id: t.String(),
  nodeId: t.String(),
  leafNodeId: t.String(),
  type: t.Literal('noop'),
  status: t.Union([
    t.Literal('accepted'),
    t.Literal('queued'),
    t.Literal('dispatched'),
    t.Literal('running'),
    t.Literal('completed'),
    t.Literal('failed'),
    t.Literal('cancel_requested'),
    t.Literal('canceled'),
    t.Literal('timed_out')
  ]),
  createdAt: t.String(),
  updatedAt: t.String(),
  timeoutAt: t.Optional(t.String()),
  completedAt: t.Optional(t.String())
})
