import { t } from 'elysia'

export const timelineLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  summary: t.String(),
  subject: t.Optional(t.String()),
  correlationId: t.Optional(t.String())
})

export const fullLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  level: t.Union([t.Literal('debug'), t.Literal('info'), t.Literal('warn'), t.Literal('error')]),
  source: t.String(),
  message: t.String(),
  correlationId: t.Optional(t.String()),
  traceId: t.Optional(t.String()),
  payload: t.Optional(t.Unknown())
})

export const auditLogSchema = t.Object({
  id: t.String(),
  timestamp: t.String(),
  summary: t.Optional(t.String()),
  actor: t.Union([
    t.Literal('viewer'),
    t.Literal('operator'),
    t.Literal('admin'),
    t.Literal('security-admin'),
    t.Literal('break-glass-reviewer'),
    t.Literal('system')
  ]),
  action: t.String(),
  resource: t.String(),
  decisionId: t.Optional(t.String()),
  result: t.String(),
  correlationId: t.Optional(t.String()),
  traceId: t.Optional(t.String()),
  payload: t.Optional(t.Unknown())
})
