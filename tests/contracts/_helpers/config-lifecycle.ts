import * as Schema from 'effect/Schema'

export const ConfigDomainV01 = Schema.Literal(
  'core',
  'm-net',
  'm-policy',
  'm-log',
  'm-extension',
  'm-ui'
)

export const ConfigStatusV01 = Schema.Literal(
  'draft',
  'validated',
  'published',
  'applied',
  'failed',
  'rolled_back'
)

export const ConfigRecordV01Schema = Schema.Struct({
  id: Schema.String,
  configVersion: Schema.String,
  schemaVersion: Schema.String,
  configHash: Schema.String,
  domain: ConfigDomainV01,
  targetScope: Schema.Array(Schema.String),
  status: ConfigStatusV01,
  createdBy: Schema.String,
  createdAt: Schema.String,
  publishedBy: Schema.optional(Schema.String),
  publishedAt: Schema.optional(Schema.String),
  rollbackVersion: Schema.optional(Schema.String)
})

export const ConfigApplyAckV01Schema = Schema.Struct({
  ackId: Schema.String,
  configId: Schema.String,
  configVersion: Schema.String,
  ackedBy: Schema.String,
  ackedAt: Schema.String,
  status: Schema.Literal('acked', 'failed'),
  errorCode: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String)
})

export function deterministicConfigHash(payload: Record<string, unknown>): string {
  const normalized = JSON.stringify(payload, Object.keys(payload).sort())
  return new Bun.CryptoHasher('sha256').update(normalized).digest('hex')
}

export type ConfigAction =
  | 'validate'
  | 'publish'
  | 'apply_ack'
  | 'apply_fail'
  | 'rollback'
  | 'draft'

export type ConfigState = 'draft' | 'validated' | 'published' | 'applied' | 'failed' | 'rolled_back'

export function nextConfigState(state: ConfigState, action: ConfigAction): ConfigState {
  switch (state) {
    case 'draft':
      if (action === 'validate') return 'validated'
      return state
    case 'validated':
      if (action === 'publish') return 'published'
      if (action === 'validate') return 'validated'
      return state
    case 'published':
      if (action === 'apply_ack') return 'applied'
      if (action === 'apply_fail') return 'failed'
      if (action === 'rollback') return 'rolled_back'
      return state
    case 'applied':
      if (action === 'rollback') return 'rolled_back'
      return state
    case 'failed':
      if (action === 'rollback') return 'rolled_back'
      if (action === 'validate') return 'validated'
      return state
    case 'rolled_back':
      return state
    default:
      return state
  }
}

export function containsPlaintextSecrets(payload: Record<string, unknown>): string[] {
  const secretKeys = [
    'password',
    'token',
    'secret',
    'apikey',
    'api_key',
    'privatekey',
    'private_key'
  ]
  const violations: string[] = []

  function walk(obj: unknown, path: string) {
    if (obj === null || obj === undefined) return
    if (typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => {
        walk(item, `${path}[${i}]`)
      })
      return
    }
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const fullPath = path ? `${path}.${key}` : key
      if (secretKeys.includes(key.toLowerCase())) violations.push(fullPath)
      walk((obj as Record<string, unknown>)[key], fullPath)
    }
  }

  walk(payload, '')
  return violations
}
