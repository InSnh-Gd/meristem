type JsonObject = Record<string, unknown>

type InitialIndex = {
  index: string
  readAlias: string
  writeAlias: string
}

type OpenSearchRequest = (
  path: string,
  init?: RequestInit,
  allowNotFound?: boolean
) => Promise<Response>

const rootDir = `${import.meta.dir}/..`
const bootstrapDir = `${rootDir}/bootstrap`
const initialIndices: InitialIndex[] = [
  {
    index: 'meristem-timeline-logs-v1',
    readAlias: 'meristem-timeline-logs-latest',
    writeAlias: 'meristem-timeline-logs-write'
  },
  {
    index: 'meristem-full-logs-v1',
    readAlias: 'meristem-full-logs-latest',
    writeAlias: 'meristem-full-logs-write'
  },
  {
    index: 'meristem-audit-logs-v1',
    readAlias: 'meristem-audit-logs-latest',
    writeAlias: 'meristem-audit-logs-write'
  }
]

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be supplied by the deployment secret provider`)
  return value
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(path: string): Promise<JsonObject> {
  const parsed: unknown = JSON.parse(await Bun.file(path).text())
  if (!isJsonObject(parsed)) throw new Error(`Expected JSON object in ${path}`)
  return parsed
}

function createSecureClient(): OpenSearchRequest {
  const baseUrl = requiredEnv('OPENSEARCH_URL').replace(/\/$/, '')
  const username = requiredEnv('OPENSEARCH_ADMIN_USERNAME')
  const password = requiredEnv('OPENSEARCH_ADMIN_PASSWORD')
  const certificatePath = process.env.OPENSEARCH_CA_CERT ?? `${rootDir}/tls/ca.pem`
  const authorization = `Basic ${btoa(`${username}:${password}`)}`

  return async function request(
    path: string,
    init: RequestInit = {},
    allowNotFound = false
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', authorization)
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const response = await Bun.fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      tls: { ca: [Bun.file(certificatePath)] }
    })
    if (!response.ok && !(allowNotFound && response.status === 404)) {
      throw new Error(`OpenSearch ${init.method ?? 'GET'} ${path} failed with ${response.status}`)
    }
    return response
  }
}

async function ensureInitialIndex(
  request: OpenSearchRequest,
  initialIndex: InitialIndex
): Promise<void> {
  const existing = await request(`/${initialIndex.index}`, { method: 'HEAD' }, true)
  if (existing.status !== 404) return
  await request(`/${initialIndex.index}`, {
    method: 'PUT',
    body: JSON.stringify({
      aliases: {
        [initialIndex.readAlias]: {},
        [initialIndex.writeAlias]: { is_write_index: true }
      }
    })
  })
}

async function putJson(
  request: OpenSearchRequest,
  path: string,
  body: JsonObject
): Promise<void> {
  await request(path, { method: 'PUT', body: JSON.stringify(body) })
}

async function installSecurityRoles(request: OpenSearchRequest): Promise<void> {
  const roles = await readJson(`${bootstrapDir}/security-roles.json`)
  for (const [name, definition] of Object.entries(roles)) {
    if (!isJsonObject(definition)) throw new Error(`Expected role object for ${name}`)
    await putJson(request, `/_plugins/_security/api/roles/${name}`, definition)
  }
}

async function main(): Promise<void> {
  const request = createSecureClient()
  const snapshotRepository = {
    type: 's3',
    settings: {
      bucket: requiredEnv('OPENSEARCH_SNAPSHOT_BUCKET'),
      base_path: requiredEnv('OPENSEARCH_SNAPSHOT_BASE_PATH'),
      region: requiredEnv('OPENSEARCH_SNAPSHOT_REGION')
    }
  }

  await putJson(request, '/_snapshot/meristem-opensearch-snapshots', snapshotRepository)
  await putJson(
    request,
    '/_plugins/_ism/policies/meristem-log-projection-retention-v1',
    await readJson(`${bootstrapDir}/ism-policy.json`)
  )
  await putJson(
    request,
    '/_plugins/_sm/policies/meristem-daily-projection-snapshot',
    await readJson(`${bootstrapDir}/snapshot-policy.json`)
  )
  await installSecurityRoles(request)

  for (const [name, file] of [
    ['meristem-timeline-logs-v1', 'timeline-template.json'],
    ['meristem-full-logs-v1', 'full-log-template.json'],
    ['meristem-audit-logs-v1', 'audit-template.json']
  ]) {
    await putJson(request, `/_index_template/${name}`, await readJson(`${bootstrapDir}/${file}`))
  }

  for (const initialIndex of initialIndices) {
    await ensureInitialIndex(request, initialIndex)
  }

  console.info(JSON.stringify({ bootstrap: 'complete', indices: initialIndices.map(item => item.index) }))
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
