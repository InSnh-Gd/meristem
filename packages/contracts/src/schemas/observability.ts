import * as Schema from 'effect/Schema'

const NonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

function hasExactMembers(values: readonly string[], expected: readonly string[]): boolean {
  return (
    values.length === expected.length &&
    expected.every(value => values.filter(item => item === value).length === 1)
  )
}

function includesAll(values: readonly string[], required: readonly string[]): boolean {
  return required.every(value => values.includes(value))
}

export const ObservabilityContractVersionSchema = Schema.Literal('observability@0.1.0')
export type ObservabilityContractVersionFromSchema = typeof ObservabilityContractVersionSchema.Type

export const ObservabilityAuthorityRoleSchema = Schema.Literal('non-authoritative')
export type ObservabilityAuthorityRoleFromSchema = typeof ObservabilityAuthorityRoleSchema.Type

export const ObservabilityDegradationIndicatorSchema = Schema.Literal(
  'prometheus_unavailable',
  'grafana_unavailable',
  'alertmanager_unavailable',
  'otel_collector_degraded'
)
export type ObservabilityDegradationIndicatorFromSchema =
  typeof ObservabilityDegradationIndicatorSchema.Type

export const DashboardReadModelSourceSchema = Schema.Literal(
  'prometheus',
  'opensearch',
  'alertmanager',
  'otel-collector',
  'dashboards'
)
export type DashboardReadModelSourceFromSchema = typeof DashboardReadModelSourceSchema.Type

export const DashboardDegradationIndicatorSchema = Schema.Literal(
  'opensearch_unavailable',
  'dashboards_unavailable',
  'projection_queue_degraded',
  'read_model_rebuild_required',
  'prometheus_unavailable',
  'grafana_unavailable',
  'alertmanager_unavailable',
  'otel_collector_degraded'
)
export type DashboardDegradationIndicatorFromSchema =
  typeof DashboardDegradationIndicatorSchema.Type

export const PrometheusScrapeTargetSchema = Schema.Struct({
  jobName: NonEmptyStringSchema,
  service: NonEmptyStringSchema,
  metricsPath: NonEmptyStringSchema,
  scheme: Schema.Literal('http', 'https'),
  interval: NonEmptyStringSchema
})
export type PrometheusScrapeTargetFromSchema = typeof PrometheusScrapeTargetSchema.Type

const PrometheusScrapeTargetsSchema = Schema.Array(PrometheusScrapeTargetSchema).pipe(
  Schema.filter(targets =>
    includesAll(
      targets.map(target => target.service),
      ['core', 'm-eventbus', 'm-log', 'm-policy', 'm-deploy']
    )
  )
)

export const GrafanaDatasourceSchema = Schema.Struct({
  name: NonEmptyStringSchema,
  kind: Schema.Literal('prometheus', 'opensearch'),
  url: NonEmptyStringSchema,
  readOnly: Schema.Literal(true)
})
export type GrafanaDatasourceFromSchema = typeof GrafanaDatasourceSchema.Type

const minimumAlertNames = [
  'control_plane_availability',
  'postgresql_lag_or_failover',
  'vault_sealed_or_quorum',
  'nats_health',
  'opensearch_degradation',
  'failed_audit_writes',
  'pending_approvals_backlog',
  'agent_drift_or_reconcile_failure'
] as const

export const MinimumAlertNameSchema = Schema.Literal(...minimumAlertNames)
export type MinimumAlertNameFromSchema = typeof MinimumAlertNameSchema.Type

export const AlertSeveritySchema = Schema.Literal('warning', 'critical')
export type AlertSeverityFromSchema = typeof AlertSeveritySchema.Type

export const AlertmanagerRuleSchema = Schema.Struct({
  name: MinimumAlertNameSchema,
  expr: NonEmptyStringSchema,
  for: NonEmptyStringSchema,
  severity: AlertSeveritySchema,
  owner: NonEmptyStringSchema,
  runbook: NonEmptyStringSchema
})
export type AlertmanagerRuleFromSchema = typeof AlertmanagerRuleSchema.Type

const MinimumAlertmanagerRulesSchema = Schema.Array(AlertmanagerRuleSchema).pipe(
  Schema.filter(rules =>
    hasExactMembers(
      rules.map(rule => rule.name),
      minimumAlertNames
    )
  )
)

export const OTelCollectorConfigSchema = Schema.Struct({
  receivers: Schema.Array(Schema.Literal('otlp/http', 'otlp/grpc')),
  exporters: Schema.Array(Schema.Literal('prometheus', 'otlp', 'logging')),
  correlationIdAttribute: Schema.Literal('correlationId'),
  propagateCorrelationId: Schema.Literal(true)
})
export type OTelCollectorConfigFromSchema = typeof OTelCollectorConfigSchema.Type

export const PinoLoggingContractSchema = Schema.Struct({
  format: Schema.Literal('jsonl'),
  requiredFields: Schema.Array(NonEmptyStringSchema).pipe(
    Schema.filter(fields =>
      includesAll(fields, ['time', 'level', 'service', 'msg', 'correlationId'])
    )
  ),
  correlationIdField: Schema.Literal('correlationId'),
  traceIdField: Schema.Literal('traceId')
})
export type PinoLoggingContractFromSchema = typeof PinoLoggingContractSchema.Type

export const DashboardOwnershipSchema = Schema.Struct({
  dashboardId: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  owner: NonEmptyStringSchema,
  datasources: Schema.Array(NonEmptyStringSchema),
  stateSources: Schema.Array(DashboardReadModelSourceSchema).pipe(
    Schema.filter(sources => sources.length > 0)
  ),
  degradationIndicators: Schema.Array(DashboardDegradationIndicatorSchema).pipe(
    Schema.filter(indicators => indicators.length > 0)
  ),
  correlationIdField: Schema.Literal('correlationId'),
  degradedStateVisible: Schema.Literal(true)
})
export type DashboardOwnershipFromSchema = typeof DashboardOwnershipSchema.Type

export const ObservabilityContractV01Schema = Schema.Struct({
  schemaVersion: ObservabilityContractVersionSchema,
  authorityRole: ObservabilityAuthorityRoleSchema,
  prometheus: Schema.Struct({
    scrapeTargets: PrometheusScrapeTargetsSchema,
    unavailableIndicator: Schema.Literal('prometheus_unavailable')
  }),
  grafana: Schema.Struct({
    datasources: Schema.Array(GrafanaDatasourceSchema),
    dashboardOwnership: Schema.Array(DashboardOwnershipSchema)
  }),
  alertmanager: Schema.Struct({
    minimumAlerts: MinimumAlertmanagerRulesSchema,
    routeOwner: NonEmptyStringSchema
  }),
  otel: OTelCollectorConfigSchema,
  pino: PinoLoggingContractSchema,
  degradedStateVisibility: Schema.Struct({
    indicators: Schema.Array(ObservabilityDegradationIndicatorSchema),
    visibleInMui: Schema.Literal(true),
    blocksAuthoritativeWrites: Schema.Literal(false)
  })
})
export type ObservabilityContractV01FromSchema = typeof ObservabilityContractV01Schema.Type
