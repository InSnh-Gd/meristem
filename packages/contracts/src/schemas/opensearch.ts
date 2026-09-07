import * as Schema from 'effect/Schema'

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))

function hasExactMembers(values: readonly string[], expected: readonly string[]): boolean {
  return (
    values.length === expected.length &&
    expected.every(value => values.filter(item => item === value).length === 1)
  )
}

export const OpenSearchContractVersionSchema = Schema.Literal('opensearch@0.1.0')
export type OpenSearchContractVersionFromSchema = typeof OpenSearchContractVersionSchema.Type

export const OpenSearchAuthorityRoleSchema = Schema.Literals(['projection', 'auxiliary'])
export type OpenSearchAuthorityRoleFromSchema = typeof OpenSearchAuthorityRoleSchema.Type

export const OpenSearchDegradationIndicatorSchema = Schema.Literals([
  'opensearch_unavailable',
  'dashboards_unavailable',
  'projection_queue_degraded',
  'read_model_rebuild_required'
])
export type OpenSearchDegradationIndicatorFromSchema =
  typeof OpenSearchDegradationIndicatorSchema.Type

export const OpenSearchNodeSchema = Schema.Struct({
  name: NonEmptyStringSchema,
  role: Schema.Literals(['cluster_manager', 'data', 'ingest']),
  zone: NonEmptyStringSchema
})
export type OpenSearchNodeFromSchema = typeof OpenSearchNodeSchema.Type

const OpenSearchClusterNodesSchema = Schema.Array(OpenSearchNodeSchema).pipe(
  Schema.check(
    Schema.makeFilter(
      nodes =>
        hasExactMembers(
          nodes.map(node => node.role),
          ['cluster_manager', 'data', 'ingest']
        ) &&
        new Set(nodes.map(node => node.name)).size === nodes.length &&
        new Set(nodes.map(node => node.zone)).size === nodes.length
    )
  )
)

export const OpenSearchTlsConfigSchema = Schema.Struct({
  restTls: Schema.Literal(true),
  transportTls: Schema.Literal(true),
  certificateSecretRefId: NonEmptyStringSchema
})
export type OpenSearchTlsConfigFromSchema = typeof OpenSearchTlsConfigSchema.Type

export const OpenSearchAuthConfigSchema = Schema.Struct({
  securityPluginEnabled: Schema.Literal(true),
  authModel: Schema.Literals(['internal-service-account', 'oidc-proxy']),
  adminSecretRefId: NonEmptyStringSchema,
  projectionWriterSecretRefId: NonEmptyStringSchema,
  readOnlySecretRefId: NonEmptyStringSchema
})
export type OpenSearchAuthConfigFromSchema = typeof OpenSearchAuthConfigSchema.Type

export const OpenSearchClusterConfigV01Schema = Schema.Struct({
  schemaVersion: OpenSearchContractVersionSchema,
  authorityRole: Schema.Literal('projection'),
  nodeCount: Schema.Literal(3),
  nodes: OpenSearchClusterNodesSchema,
  restEndpoint: NonEmptyStringSchema,
  transportEndpoint: NonEmptyStringSchema,
  tls: OpenSearchTlsConfigSchema,
  auth: OpenSearchAuthConfigSchema
})
export type OpenSearchClusterConfigV01FromSchema = typeof OpenSearchClusterConfigV01Schema.Type

export const OpenSearchProjectionNameSchema = Schema.Literals([
  'timeline',
  'full-log',
  'audit-projection'
])
export type OpenSearchProjectionNameFromSchema = typeof OpenSearchProjectionNameSchema.Type

export const OpenSearchFieldKindSchema = Schema.Literals([
  'date',
  'keyword',
  'text',
  'object',
  'boolean',
  'long'
])
export type OpenSearchFieldKindFromSchema = typeof OpenSearchFieldKindSchema.Type

export const OpenSearchMappingFieldSchema = Schema.Struct({
  name: NonEmptyStringSchema,
  kind: OpenSearchFieldKindSchema,
  required: Schema.Boolean
})
export type OpenSearchMappingFieldFromSchema = typeof OpenSearchMappingFieldSchema.Type

const OpenSearchMappingFieldsSchema = Schema.Array(OpenSearchMappingFieldSchema).pipe(
  Schema.check(
    Schema.makeFilter(
      fields =>
        fields.some(field => field.name === 'correlationId' && field.kind === 'keyword') &&
        new Set(fields.map(field => field.name)).size === fields.length
    )
  )
)

const OpenSearchQueryProjectionSemanticsSchema = Schema.Struct({
  authoritative: Schema.Literal(false),
  sourceOfTruth: Schema.Literal('postgresql'),
  emptyOrDegradedWhenUnavailable: Schema.Literal(true),
  filters: Schema.Array(NonEmptyStringSchema),
  fullTextFields: Schema.Array(NonEmptyStringSchema)
}).pipe(Schema.check(Schema.makeFilter(semantics => semantics.filters.includes('correlationId'))))

export const OpenSearchIndexTemplateV01Schema = Schema.Struct({
  projection: OpenSearchProjectionNameSchema,
  indexPattern: NonEmptyStringSchema,
  writeAlias: NonEmptyStringSchema,
  readAlias: NonEmptyStringSchema,
  version: Schema.Number,
  dynamic: Schema.Literal('strict'),
  fields: OpenSearchMappingFieldsSchema,
  queryProjectionSemantics: OpenSearchQueryProjectionSemanticsSchema
})
export type OpenSearchIndexTemplateV01FromSchema = typeof OpenSearchIndexTemplateV01Schema.Type

const OpenSearchIndexTemplatesSchema = Schema.Array(OpenSearchIndexTemplateV01Schema).pipe(
  Schema.check(
    Schema.makeFilter(templates =>
      hasExactMembers(
        templates.map(template => template.projection),
        ['timeline', 'full-log', 'audit-projection']
      )
    )
  )
)

export const OpenSearchIsmPolicyV01Schema = Schema.Struct({
  policyId: NonEmptyStringSchema,
  rollover: Schema.Struct({
    maxAge: NonEmptyStringSchema,
    maxSize: NonEmptyStringSchema
  }),
  retention: Schema.Struct({
    timeline: NonEmptyStringSchema,
    fullLog: NonEmptyStringSchema,
    auditProjection: NonEmptyStringSchema
  }),
  snapshotBeforeDelete: Schema.Literal(true),
  snapshotRepository: NonEmptyStringSchema
})
export type OpenSearchIsmPolicyV01FromSchema = typeof OpenSearchIsmPolicyV01Schema.Type

export const OpenSearchSnapshotRestoreConfigV01Schema = Schema.Struct({
  repository: Schema.Struct({
    name: NonEmptyStringSchema,
    type: Schema.Literals(['s3', 'fs']),
    credentialSecretRefId: NonEmptyStringSchema
  }),
  schedule: NonEmptyStringSchema,
  restoreOrder: Schema.Array(OpenSearchProjectionNameSchema).pipe(
    Schema.check(
      Schema.makeFilter(projections =>
        hasExactMembers(projections, ['timeline', 'full-log', 'audit-projection'])
      )
    )
  ),
  rebuildAfterRestore: Schema.Struct({
    sourceOfTruth: Schema.Literal('postgresql'),
    owner: Schema.Literal('m-log'),
    required: Schema.Literal(true)
  })
})
export type OpenSearchSnapshotRestoreConfigV01FromSchema =
  typeof OpenSearchSnapshotRestoreConfigV01Schema.Type

export const DashboardsAllowedActionSchema = Schema.Literals(['view-dashboard', 'query-projection'])
export type DashboardsAllowedActionFromSchema = typeof DashboardsAllowedActionSchema.Type

const DashboardsAllowedActionsSchema = Schema.Array(DashboardsAllowedActionSchema).pipe(
  Schema.check(
    Schema.makeFilter(actions => hasExactMembers(actions, ['view-dashboard', 'query-projection']))
  )
)

export const DashboardsForbiddenAuthorityActionSchema = Schema.Literals([
  'mutate-control-plane',
  'write-audit-fact',
  'approve-policy'
])
export type DashboardsForbiddenAuthorityActionFromSchema =
  typeof DashboardsForbiddenAuthorityActionSchema.Type

const DashboardsForbiddenAuthorityActionsSchema = Schema.Array(
  DashboardsForbiddenAuthorityActionSchema
).pipe(
  Schema.check(
    Schema.makeFilter(actions =>
      hasExactMembers(actions, ['mutate-control-plane', 'write-audit-fact', 'approve-policy'])
    )
  )
)

const OpenSearchDegradationIndicatorsSchema = Schema.Array(
  OpenSearchDegradationIndicatorSchema
).pipe(
  Schema.check(
    Schema.makeFilter(indicators =>
      hasExactMembers(indicators, [
        'opensearch_unavailable',
        'dashboards_unavailable',
        'projection_queue_degraded',
        'read_model_rebuild_required'
      ])
    )
  )
)

export const DashboardsConfigV01Schema = Schema.Struct({
  schemaVersion: Schema.Literal('dashboards@0.1.0'),
  authorityRole: Schema.Literal('auxiliary'),
  ingress: Schema.Struct({
    exposure: Schema.Literals(['auxiliary-private', 'operator-vpn']),
    tlsRequired: Schema.Literal(true),
    host: NonEmptyStringSchema
  }),
  auth: Schema.Struct({
    model: Schema.Literal('oidc-rbac-proxy'),
    unauthorizedStatus: Schema.Literals([401, 403]),
    auditUnauthorizedAccess: Schema.Literal(true)
  }),
  allowedActions: DashboardsAllowedActionsSchema,
  forbiddenAuthorityActions: DashboardsForbiddenAuthorityActionsSchema
})
export type DashboardsConfigV01FromSchema = typeof DashboardsConfigV01Schema.Type

export const OpenSearchProductionContractV01Schema = Schema.Struct({
  cluster: OpenSearchClusterConfigV01Schema,
  indexTemplates: OpenSearchIndexTemplatesSchema,
  ismPolicy: OpenSearchIsmPolicyV01Schema,
  snapshotRestore: OpenSearchSnapshotRestoreConfigV01Schema,
  dashboards: DashboardsConfigV01Schema,
  failureBehavior: Schema.Struct({
    authoritativeWritesDependOnOpenSearch: Schema.Literal(false),
    auditFactsStoredAuthoritativelyInOpenSearch: Schema.Literal(false),
    dashboardsMayBypassMeristemAudit: Schema.Literal(false),
    degradationIndicators: OpenSearchDegradationIndicatorsSchema
  })
})
export type OpenSearchProductionContractV01FromSchema =
  typeof OpenSearchProductionContractV01Schema.Type
