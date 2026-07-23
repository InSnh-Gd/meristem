export type ProjectionName = 'timeline' | 'full-log' | 'audit-projection'

export type SnapshotRestoreProjection = {
  name: ProjectionName
  indexPattern: string
  backfillIndex: string
}

export type SnapshotRestoreDrillClient = {
  createSnapshot(snapshotName: string, indices: string[]): Promise<void>
  restoreProjection(snapshotName: string, projection: SnapshotRestoreProjection): Promise<void>
  rebuildProjection(projection: SnapshotRestoreProjection): Promise<void>
}

const projections: SnapshotRestoreProjection[] = [
  {
    name: 'timeline',
    indexPattern: 'meristem-timeline-logs-v*',
    backfillIndex: 'meristem-timeline-logs-v0'
  },
  {
    name: 'full-log',
    indexPattern: 'meristem-full-logs-v*',
    backfillIndex: 'meristem-full-logs-v0'
  },
  {
    name: 'audit-projection',
    indexPattern: 'meristem-audit-logs-v*',
    backfillIndex: 'meristem-audit-logs-v0'
  }
]

export async function runSnapshotRestoreDrill(
  client: SnapshotRestoreDrillClient,
  snapshotName: string
): Promise<{ snapshotName: string; restored: ProjectionName[] }> {
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/.test(snapshotName)) {
    throw new Error('snapshot name must be a lowercase fixture-safe identifier')
  }

  await client.createSnapshot(
    snapshotName,
    projections.map(projection => projection.indexPattern)
  )
  for (const projection of projections) {
    await client.restoreProjection(snapshotName, projection)
    await client.rebuildProjection(projection)
  }

  return { snapshotName, restored: projections.map(projection => projection.name) }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be supplied by the fixture deployment`)
  return value
}

function createFixtureClient(): SnapshotRestoreDrillClient {
  return {
    async createSnapshot() {},
    async restoreProjection() {},
    async rebuildProjection() {}
  }
}

function createHttpClient(): SnapshotRestoreDrillClient {
  const opensearchUrl = requiredEnv('OPENSEARCH_URL').replace(/\/$/, '')
  const repository = requiredEnv('OPENSEARCH_SNAPSHOT_REPOSITORY')
  const username = requiredEnv('OPENSEARCH_ADMIN_USERNAME')
  const password = requiredEnv('OPENSEARCH_ADMIN_PASSWORD')
  const mlogUrl = requiredEnv('MLOG_URL').replace(/\/$/, '')
  const internalToken = requiredEnv('MERISTEM_INTERNAL_TOKEN')
  const certificatePath = requiredEnv('OPENSEARCH_CA_CERT')
  const authorization = `Basic ${btoa(`${username}:${password}`)}`

  async function requestOpenSearch(path: string, body: unknown): Promise<void> {
    const response = await Bun.fetch(`${opensearchUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      tls: { ca: [Bun.file(certificatePath)] }
    })
    if (!response.ok) throw new Error(`OpenSearch restore request failed with ${response.status}`)
  }

  return {
    async createSnapshot(snapshotName, indices) {
      await requestOpenSearch(`/_snapshot/${repository}/${snapshotName}?wait_for_completion=true`, {
        indices: indices.join(','),
        include_global_state: false,
        ignore_unavailable: false
      })
    },
    async restoreProjection(snapshotName, projection) {
      await requestOpenSearch(`/_snapshot/${repository}/${snapshotName}/_restore?wait_for_completion=true`, {
        indices: projection.indexPattern,
        include_global_state: false,
        rename_pattern: '(.+)',
        rename_replacement: `fixture-${snapshotName}-$1`
      })
    },
    async rebuildProjection(projection) {
      const response = await Bun.fetch(`${mlogUrl}/internal/v0/projection/backfill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-meristem-internal-token': internalToken
        },
        body: JSON.stringify({
          index: projection.backfillIndex,
          batchSize: 1000,
          targetVersion: '1'
        })
      })
      if (!response.ok) throw new Error(`M-Log read-model rebuild failed with ${response.status}`)
    }
  }
}

async function main(): Promise<void> {
  const fixtureMode = process.argv.includes('--fixture')
  if (!fixtureMode && process.env.OPENSEARCH_RESTORE_TARGET !== 'fixture') {
    throw new Error('snapshot restore drills are restricted to OPENSEARCH_RESTORE_TARGET=fixture')
  }

  const snapshotName = process.env.OPENSEARCH_SNAPSHOT_NAME ?? `fixture-${Date.now()}`
  const result = await runSnapshotRestoreDrill(
    fixtureMode ? createFixtureClient() : createHttpClient(),
    snapshotName
  )
  console.info(JSON.stringify(result))
}

if (import.meta.main) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
