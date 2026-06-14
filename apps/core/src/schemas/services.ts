import { t } from 'elysia'

export const dependencyStateSchema = t.Union([t.Literal('ready'), t.Literal('unavailable')])

export const dependenciesSchema = t.Object({
  postgres: dependencyStateSchema,
  nats: dependencyStateSchema,
  'm-policy': dependencyStateSchema,
  'm-log': dependencyStateSchema,
  'm-eventbus': dependencyStateSchema,
  'm-net': dependencyStateSchema
})

export const serviceLifecycleSchema = t.Object({
  reloadable: t.Boolean(),
  rollbackable: t.Boolean(),
  degradable: t.Boolean()
})

export const serviceRuntimeSchema = t.Object({
  liveness: t.Boolean(),
  readiness: t.Boolean(),
  mode: t.Union([t.Literal('normal'), t.Literal('degraded')]),
  lastError: t.Optional(t.String()),
  lastReloadedAt: t.Optional(t.String())
})

export const serviceSummarySchema = t.Object({
  id: t.String(),
  version: t.String(),
  domain: t.Union([
    t.Literal('core'),
    t.Literal('m-net'),
    t.Literal('m-eventbus'),
    t.Literal('m-log'),
    t.Literal('m-policy'),
    t.Literal('m-task'),
    t.Literal('m-ui'),
    t.Literal('m-cli'),
    t.Literal('m-extension')
  ]),
  kind: t.Union([
    t.Literal('core'),
    t.Literal('internal'),
    t.Literal('node'),
    t.Literal('task'),
    t.Literal('extension'),
    t.Literal('bff')
  ]),
  lifecycle: serviceLifecycleSchema,
  runtime: t.Optional(serviceRuntimeSchema)
})
