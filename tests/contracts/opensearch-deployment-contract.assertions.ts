import { describe, expect, it } from 'bun:test'

function assetUrl(path: string): URL {
  return new URL(`../../ops/opensearch/${path}`, import.meta.url)
}

async function asset(path: string): Promise<string> {
  return Bun.file(assetUrl(path)).text()
}

function serviceBlock(compose: string, service: string): string {
  const match = compose.match(
    new RegExp(
      `^  ${service}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|^volumes:|^networks:|(?![\\s\\S]))`,
      'm'
    )
  )
  if (!match?.[0]) throw new Error(`missing compose service ${service}`)
  return match[0]
}

describe('OpenSearch production deployment contract', () => {
  it('defines three role-separated TLS nodes and keeps the raw cluster private', async () => {
    const compose = await asset('compose.yaml')
    const manager = serviceBlock(compose, 'opensearch-manager')
    const data = serviceBlock(compose, 'opensearch-data')
    const ingest = serviceBlock(compose, 'opensearch-ingest')

    expect(manager).toContain('opensearch-manager.yml')
    expect(data).toContain('opensearch-data.yml')
    expect(ingest).toContain('opensearch-ingest.yml')
    expect(compose).not.toContain('9200:9200')
    expect(compose).not.toContain('5601:5601')

    const [managerConfig, dataConfig, ingestConfig, roles, bootstrap] = await Promise.all([
      asset('config/opensearch-manager.yml'),
      asset('config/opensearch-data.yml'),
      asset('config/opensearch-ingest.yml'),
      asset('bootstrap/security-roles.json'),
      asset('scripts/bootstrap.ts')
    ])
    expect(managerConfig).toContain('node.roles: [cluster_manager]')
    expect(dataConfig).toContain('node.roles: [data]')
    expect(ingestConfig).toContain('node.roles: [ingest]')
    for (const config of [managerConfig, dataConfig, ingestConfig]) {
      expect(config).toContain('plugins.security.ssl.http.enabled: true')
      expect(config).toContain('plugins.security.ssl.transport.enforce_hostname_verification: true')
      expect(config).toContain('plugins.security.allow_unsafe_democertificates: false')
    }
    expect(roles).toContain('meristem_projection_writer')
    expect(roles).toContain('meristem_dashboards_readonly')
    expect(roles).toContain('meristem_monitoring')
    expect(bootstrap).toContain('installSecurityRoles')
  })

  it('requires TLS OIDC ingress and records the Dashboards audit sink model', async () => {
    const compose = await asset('compose.yaml')
    const dashboards = serviceBlock(compose, 'opensearch-dashboards')
    const proxy = serviceBlock(compose, 'dashboards-oidc-proxy')
    const [proxyConfig, auditPolicy] = await Promise.all([
      asset('config/oauth2-proxy.cfg'),
      asset('bootstrap/dashboards-audit-policy.json')
    ])

    expect(dashboards).not.toContain('ports:')
    expect(proxy).toContain('127.0.0.1:8443:8443')
    expect(proxyConfig).toContain('provider = "oidc"')
    expect(proxyConfig).toContain('allowed_groups = ["meristem-operator", "meristem-security-admin"]')
    expect(proxyConfig).toContain('https_address = "0.0.0.0:8443"')
    expect(proxyConfig).toContain('auth_logging = true')
    expect(auditPolicy).toContain('dashboards:unauthorized')
    expect(auditPolicy).toContain('"service": "m-log"')
  })

  it('installs strict production mappings and snapshot-before-delete retention', async () => {
    const [timeline, full, audit, ism, snapshotPolicy] = await Promise.all([
      asset('bootstrap/timeline-template.json'),
      asset('bootstrap/full-log-template.json'),
      asset('bootstrap/audit-template.json'),
      asset('bootstrap/ism-policy.json'),
      asset('bootstrap/snapshot-policy.json')
    ])

    for (const template of [timeline, full, audit]) {
      expect(template).toContain('"dynamic": "strict"')
      expect(template).toContain('"index.number_of_replicas": "1"')
      expect(template).toContain('"meristem-log-projection-retention-v1"')
    }
    expect(full).toContain('"traceId": { "type": "keyword" }')
    expect(audit).toContain('"decisionId": { "type": "keyword" }')
    expect(ism).toContain('"name": "snapshot"')
    expect(ism).toContain('"repository": "meristem-opensearch-snapshots"')
    expect(snapshotPolicy).toContain('"expression": "0 */6 * * *"')
  })

  it('wires Prometheus, Alertmanager, Grafana, OTel, Pino, and the required alert rules', async () => {
    const [prometheus, alerts, grafana, otel] = await Promise.all([
      asset('config/prometheus.yml'),
      asset('alerts/opensearch-alerts.yml'),
      asset('config/grafana-datasources.yml'),
      asset('config/otel-collector.yaml')
    ])

    expect(prometheus).toContain('metrics_path: /_prometheus/metrics')
    expect(prometheus).toContain('scheme: https')
    expect(alerts).toContain('alert: FailedAuditWrites')
    expect(alerts).toContain('alert: OpenSearchClusterHealth')
    expect(alerts).toContain('alert: OpenSearchDiskWatermark')
    expect(grafana).toContain('type: prometheus')
    expect(grafana).toContain('type: grafana-opensearch-datasource')
    expect(otel).toContain('filelog/pino:')
    expect(otel).toContain('otlp:')
    expect(otel).toContain('prometheus:')
  })

  it('restricts restores to a fixture target and rebuilds the optional read model', async () => {
    const drill = await asset('scripts/snapshot-restore-drill.ts')

    expect(drill).toContain("OPENSEARCH_RESTORE_TARGET !== 'fixture'")
    expect(drill).toContain('/internal/v0/projection/backfill')
    expect(drill).toContain("name: 'timeline'")
    expect(drill).toContain("name: 'full-log'")
    expect(drill).toContain("name: 'audit-projection'")
  })
})
