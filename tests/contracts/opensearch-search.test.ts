import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import './opensearch-deployment-contract.assertions.ts'
import './opensearch-query-contract.assertions.ts'
import type {
  ObservabilityContractV01FromSchema,
  OpenSearchProductionContractV01FromSchema
} from '../../packages/contracts/src/index.ts'
import {
  ObservabilityContractV01Schema,
  OpenSearchProductionContractV01Schema
} from '../../packages/contracts/src/index.ts'

const openSearchContractFixture: OpenSearchProductionContractV01FromSchema = {
  cluster: {
    schemaVersion: 'opensearch@0.1.0',
    authorityRole: 'projection',
    nodeCount: 3,
    nodes: [
      { name: 'opensearch-0', role: 'cluster_manager', zone: 'az-a' },
      { name: 'opensearch-1', role: 'data', zone: 'az-b' },
      { name: 'opensearch-2', role: 'ingest', zone: 'az-c' }
    ],
    restEndpoint: 'https://opensearch.internal:9200',
    transportEndpoint: 'opensearch-transport.internal:9300',
    tls: {
      restTls: true,
      transportTls: true,
      certificateSecretRefId: 'secret-ref-opensearch-tls'
    },
    auth: {
      securityPluginEnabled: true,
      authModel: 'internal-service-account',
      adminSecretRefId: 'secret-ref-opensearch-admin',
      projectionWriterSecretRefId: 'secret-ref-m-log-projection-writer',
      readOnlySecretRefId: 'secret-ref-dashboards-readonly'
    }
  },
  indexTemplates: [
    {
      projection: 'timeline',
      indexPattern: 'meristem-timeline-logs-v*',
      writeAlias: 'meristem-timeline-logs-write',
      readAlias: 'meristem-timeline-logs-latest',
      version: 1,
      dynamic: 'strict',
      fields: [
        { name: 'timestamp', kind: 'date', required: true },
        { name: 'summary', kind: 'text', required: true },
        { name: 'subject', kind: 'keyword', required: false },
        { name: 'correlationId', kind: 'keyword', required: false }
      ],
      queryProjectionSemantics: {
        authoritative: false,
        sourceOfTruth: 'postgresql',
        emptyOrDegradedWhenUnavailable: true,
        filters: ['subject', 'correlationId'],
        fullTextFields: ['summary']
      }
    },
    {
      projection: 'full-log',
      indexPattern: 'meristem-full-logs-v*',
      writeAlias: 'meristem-full-logs-write',
      readAlias: 'meristem-full-logs-latest',
      version: 1,
      dynamic: 'strict',
      fields: [
        { name: 'timestamp', kind: 'date', required: true },
        { name: 'level', kind: 'keyword', required: true },
        { name: 'source', kind: 'keyword', required: true },
        { name: 'message', kind: 'text', required: true },
        { name: 'correlationId', kind: 'keyword', required: false },
        { name: 'traceId', kind: 'keyword', required: false },
        { name: 'payload', kind: 'object', required: false }
      ],
      queryProjectionSemantics: {
        authoritative: false,
        sourceOfTruth: 'postgresql',
        emptyOrDegradedWhenUnavailable: true,
        filters: ['level', 'source', 'correlationId', 'traceId'],
        fullTextFields: ['message']
      }
    },
    {
      projection: 'audit-projection',
      indexPattern: 'meristem-audit-logs-v*',
      writeAlias: 'meristem-audit-logs-write',
      readAlias: 'meristem-audit-logs-latest',
      version: 1,
      dynamic: 'strict',
      fields: [
        { name: 'timestamp', kind: 'date', required: true },
        { name: 'actor', kind: 'keyword', required: true },
        { name: 'action', kind: 'keyword', required: true },
        { name: 'resource', kind: 'keyword', required: true },
        { name: 'decisionId', kind: 'keyword', required: false },
        { name: 'result', kind: 'text', required: true },
        { name: 'correlationId', kind: 'keyword', required: false },
        { name: 'traceId', kind: 'keyword', required: false }
      ],
      queryProjectionSemantics: {
        authoritative: false,
        sourceOfTruth: 'postgresql',
        emptyOrDegradedWhenUnavailable: true,
        filters: ['actor', 'action', 'resource', 'decisionId', 'correlationId'],
        fullTextFields: ['result']
      }
    }
  ],
  ismPolicy: {
    policyId: 'meristem-log-projection-retention-v1',
    rollover: { maxAge: '7d', maxSize: '50gb' },
    retention: { timeline: '180d', fullLog: '90d', auditProjection: '365d' },
    snapshotBeforeDelete: true,
    snapshotRepository: 'meristem-opensearch-snapshots'
  },
  snapshotRestore: {
    repository: {
      name: 'meristem-opensearch-snapshots',
      type: 's3',
      credentialSecretRefId: 'secret-ref-opensearch-snapshot'
    },
    schedule: '0 */6 * * *',
    restoreOrder: ['timeline', 'full-log', 'audit-projection'],
    rebuildAfterRestore: {
      sourceOfTruth: 'postgresql',
      owner: 'm-log',
      required: true
    }
  },
  dashboards: {
    schemaVersion: 'dashboards@0.1.0',
    authorityRole: 'auxiliary',
    ingress: {
      exposure: 'operator-vpn',
      tlsRequired: true,
      host: 'dashboards.ops.meristem.internal'
    },
    auth: {
      model: 'oidc-rbac-proxy',
      unauthorizedStatus: 403,
      auditUnauthorizedAccess: true
    },
    allowedActions: ['view-dashboard', 'query-projection'],
    forbiddenAuthorityActions: ['mutate-control-plane', 'write-audit-fact', 'approve-policy']
  },
  failureBehavior: {
    authoritativeWritesDependOnOpenSearch: false,
    auditFactsStoredAuthoritativelyInOpenSearch: false,
    dashboardsMayBypassMeristemAudit: false,
    degradationIndicators: [
      'opensearch_unavailable',
      'dashboards_unavailable',
      'projection_queue_degraded',
      'read_model_rebuild_required'
    ]
  }
}

const observabilityContractFixture: ObservabilityContractV01FromSchema = {
  schemaVersion: 'observability@0.1.0',
  authorityRole: 'non-authoritative',
  prometheus: {
    scrapeTargets: [
      {
        jobName: 'meristem-core',
        service: 'core',
        metricsPath: '/metrics',
        scheme: 'https',
        interval: '30s'
      },
      {
        jobName: 'meristem-eventbus',
        service: 'm-eventbus',
        metricsPath: '/metrics',
        scheme: 'https',
        interval: '30s'
      },
      {
        jobName: 'meristem-log',
        service: 'm-log',
        metricsPath: '/metrics',
        scheme: 'https',
        interval: '30s'
      },
      {
        jobName: 'meristem-policy',
        service: 'm-policy',
        metricsPath: '/metrics',
        scheme: 'https',
        interval: '30s'
      },
      {
        jobName: 'meristem-deploy',
        service: 'm-deploy',
        metricsPath: '/metrics',
        scheme: 'https',
        interval: '30s'
      }
    ],
    unavailableIndicator: 'prometheus_unavailable'
  },
  grafana: {
    datasources: [
      {
        name: 'prometheus',
        kind: 'prometheus',
        url: 'https://prometheus.internal',
        readOnly: true
      },
      {
        name: 'opensearch',
        kind: 'opensearch',
        url: 'https://opensearch.internal:9200',
        readOnly: true
      }
    ],
    dashboardOwnership: [
      {
        dashboardId: 'control-plane-overview',
        title: 'Control Plane Overview',
        owner: 'core',
        datasources: ['prometheus', 'opensearch'],
        stateSources: ['prometheus', 'opensearch'],
        degradationIndicators: ['opensearch_unavailable', 'prometheus_unavailable'],
        correlationIdField: 'correlationId',
        degradedStateVisible: true
      }
    ]
  },
  alertmanager: {
    routeOwner: 'operations',
    minimumAlerts: [
      {
        name: 'control_plane_availability',
        expr: 'up{job="meristem-core"} == 0',
        for: '2m',
        severity: 'critical',
        owner: 'core',
        runbook: 'docs/operations/RUNBOOK.md#observability-production-contract'
      },
      {
        name: 'postgresql_lag_or_failover',
        expr: 'pg_replication_lag_seconds > 30',
        for: '5m',
        severity: 'critical',
        owner: 'core',
        runbook: 'docs/operations/RUNBOOK.md#observability-production-contract'
      },
      {
        name: 'vault_sealed_or_quorum',
        expr: 'vault_core_unsealed == 0 or vault_raft_peers < 3',
        for: '1m',
        severity: 'critical',
        owner: 'core',
        runbook: 'docs/operations/RUNBOOK.md#observability-production-contract'
      },
      {
        name: 'nats_health',
        expr: 'nats_up == 0',
        for: '2m',
        severity: 'critical',
        owner: 'm-eventbus',
        runbook: 'docs/operations/RUNBOOK.md#observability-production-contract'
      },
      {
        name: 'opensearch_degradation',
        expr: 'meristem_opensearch_projection_degraded == 1',
        for: '5m',
        severity: 'warning',
        owner: 'm-log',
        runbook: 'docs/operations/RUNBOOK.md#opensearch-production-contract'
      },
      {
        name: 'failed_audit_writes',
        expr: 'increase(meristem_audit_write_failures_total[5m]) > 0',
        for: '0m',
        severity: 'critical',
        owner: 'm-log',
        runbook: 'docs/operations/RUNBOOK.md#observability-production-contract'
      },
      {
        name: 'pending_approvals_backlog',
        expr: 'meristem_pending_approvals > 25',
        for: '10m',
        severity: 'warning',
        owner: 'm-policy',
        runbook: 'docs/operations/RUNBOOK.md#observability-production-contract'
      },
      {
        name: 'agent_drift_or_reconcile_failure',
        expr: 'increase(meristem_agent_reconcile_failures_total[15m]) > 0',
        for: '5m',
        severity: 'critical',
        owner: 'm-deploy',
        runbook: 'docs/operations/RUNBOOK.md#observability-production-contract'
      }
    ]
  },
  otel: {
    receivers: ['otlp/http', 'otlp/grpc'],
    exporters: ['prometheus', 'otlp', 'logging'],
    correlationIdAttribute: 'correlationId',
    propagateCorrelationId: true
  },
  pino: {
    format: 'jsonl',
    requiredFields: ['time', 'level', 'service', 'msg', 'correlationId'],
    correlationIdField: 'correlationId',
    traceIdField: 'traceId'
  },
  degradedStateVisibility: {
    indicators: [
      'prometheus_unavailable',
      'grafana_unavailable',
      'alertmanager_unavailable',
      'otel_collector_degraded'
    ],
    visibleInMui: true,
    blocksAuthoritativeWrites: false
  }
}

// 搜索契约门禁：查询类型必须满足 OpenSearch 约束。
// 该套件通过 `bun run test:opensearch-contracts` 单独运行，避免默认门禁
// 因搜索后端专项覆盖而产生误导性的红灯。
describe('OpenSearch search contracts', () => {
  it('round-trips the secured three-node OpenSearch and Dashboards contract', () => {
    const decoded = Schema.decodeUnknownSync(OpenSearchProductionContractV01Schema)(
      openSearchContractFixture
    )

    expect(decoded.cluster.nodeCount).toBe(3)
    expect(decoded.cluster.tls.restTls).toBe(true)
    expect(decoded.cluster.tls.transportTls).toBe(true)
    expect(decoded.cluster.auth.securityPluginEnabled).toBe(true)
    expect(decoded.failureBehavior.authoritativeWritesDependOnOpenSearch).toBe(false)
    expect(decoded.failureBehavior.auditFactsStoredAuthoritativelyInOpenSearch).toBe(false)
    expect(decoded.dashboards.authorityRole).toBe('auxiliary')
    expect(decoded.dashboards.ingress.exposure).toBe('operator-vpn')
    expect(decoded.dashboards.ingress.tlsRequired).toBe(true)
    expect(decoded.dashboards.auth.model).toBe('oidc-rbac-proxy')
    expect(decoded.dashboards.auth.auditUnauthorizedAccess).toBe(true)
    expect(decoded.dashboards.allowedActions).toEqual(['view-dashboard', 'query-projection'])
    expect(decoded.dashboards.forbiddenAuthorityActions).toEqual([
      'mutate-control-plane',
      'write-audit-fact',
      'approve-policy'
    ])
  })

  it('rejects incomplete cluster, mapping, and Dashboards authority boundaries', () => {
    const duplicateRoleCluster = {
      ...openSearchContractFixture,
      cluster: {
        ...openSearchContractFixture.cluster,
        nodes: [
          { name: 'opensearch-0', role: 'data', zone: 'az-a' },
          { name: 'opensearch-1', role: 'data', zone: 'az-b' },
          { name: 'opensearch-2', role: 'ingest', zone: 'az-c' }
        ]
      }
    }
    const dynamicTemplate = {
      ...openSearchContractFixture,
      indexTemplates: openSearchContractFixture.indexTemplates.map((template, index) =>
        index === 0 ? { ...template, dynamic: 'true' } : template
      )
    }
    const dashboardWithIncompleteReadActions = {
      ...openSearchContractFixture,
      dashboards: {
        ...openSearchContractFixture.dashboards,
        allowedActions: ['view-dashboard']
      }
    }

    expect(() =>
      Schema.decodeUnknownSync(OpenSearchProductionContractV01Schema)(duplicateRoleCluster)
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(OpenSearchProductionContractV01Schema)(dynamicTemplate)
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(OpenSearchProductionContractV01Schema)(
        dashboardWithIncompleteReadActions
      )
    ).toThrow()
  })

  it('round-trips observability contract and minimum alert set', () => {
    const decoded = Schema.decodeUnknownSync(ObservabilityContractV01Schema)(
      observabilityContractFixture
    )
    const alertNames = decoded.alertmanager.minimumAlerts.map(alert => alert.name).sort()

    expect(decoded.authorityRole).toBe('non-authoritative')
    expect(decoded.otel.propagateCorrelationId).toBe(true)
    expect(decoded.pino.correlationIdField).toBe('correlationId')
    expect(decoded.degradedStateVisibility.blocksAuthoritativeWrites).toBe(false)
    expect(new Set(alertNames)).toEqual(
      new Set([
        'agent_drift_or_reconcile_failure',
        'control_plane_availability',
        'failed_audit_writes',
        'nats_health',
        'opensearch_degradation',
        'pending_approvals_backlog',
        'postgresql_lag_or_failover',
        'vault_sealed_or_quorum'
      ])
    )
  })

  it('rejects incomplete alert coverage and preserves degradation context for dashboard read models', () => {
    const missingRequiredAlert = {
      ...observabilityContractFixture,
      alertmanager: {
        ...observabilityContractFixture.alertmanager,
        minimumAlerts: observabilityContractFixture.alertmanager.minimumAlerts.filter(
          alert => alert.name !== 'failed_audit_writes'
        )
      }
    }
    const readModelWithDegradationContext = {
      ...observabilityContractFixture,
      grafana: {
        ...observabilityContractFixture.grafana,
        dashboardOwnership: [
          {
            ...observabilityContractFixture.grafana.dashboardOwnership[0],
            stateSources: ['prometheus', 'opensearch'],
            degradationIndicators: ['opensearch_unavailable', 'prometheus_unavailable'],
            correlationIdField: 'correlationId'
          }
        ]
      }
    }

    expect(() =>
      Schema.decodeUnknownSync(ObservabilityContractV01Schema)(missingRequiredAlert)
    ).toThrow()

    const decoded = Schema.decodeUnknownSync(ObservabilityContractV01Schema)(
      readModelWithDegradationContext
    )
    expect(JSON.stringify(decoded.grafana.dashboardOwnership[0])).toContain('stateSources')
    expect(JSON.stringify(decoded.grafana.dashboardOwnership[0])).toContain('degradationIndicators')
    expect(JSON.stringify(decoded.grafana.dashboardOwnership[0])).toContain('correlationId')
  })

  it('defines alert rule semantics for failed audit writes', () => {
    const decoded = Schema.decodeUnknownSync(ObservabilityContractV01Schema)(
      observabilityContractFixture
    )
    const failedAuditAlert = decoded.alertmanager.minimumAlerts.find(
      alert => alert.name === 'failed_audit_writes'
    )

    expect(failedAuditAlert?.expr).toContain('meristem_audit_write_failures_total')
    expect(failedAuditAlert?.severity).toBe('critical')
    expect(failedAuditAlert?.owner).toBe('m-log')
  })

})
