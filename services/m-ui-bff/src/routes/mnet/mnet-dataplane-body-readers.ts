import type {
  MNetBreakGlassBody,
  MNetCredentialRevokeBody,
  MNetCredentialTargetBody,
  MNetDefaultsSetBody,
  MNetJoinTicketCreateBody,
  MNetMigrationDryRunBody,
  MNetMigrationOperationBody,
  MNetMigrationRollbackBody,
  MNetNodeControlBody,
  MNetProfileToggleBody
} from '../../types.ts'

function asObject(body: unknown): object | null {
  return typeof body === 'object' && body !== null ? body : null
}
function stringField(body: object, key: string): string | undefined {
  const value = Reflect.get(body, key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
function optionalStringField(body: object, key: string): string | undefined | null {
  const value = Reflect.get(body, key)
  if (value === undefined) return undefined
  return typeof value === 'string' && value.length > 0 ? value : null
}
function optionalStringArrayField(body: object, key: string): string[] | undefined | null {
  const value = Reflect.get(body, key)
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return null
  return [...value]
}
function optionalPositiveNumber(body: object, key: string): number | undefined | null {
  const value = Reflect.get(body, key)
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : null
}

/** 以下读取器在受信任路由 schema 之后保留既有 null 失败哨兵。 */
export function readJoinTicketCreateBody(body: unknown): MNetJoinTicketCreateBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const kind = Reflect.get(objectBody, 'kind')
  const name = stringField(objectBody, 'name')
  const capabilities = optionalStringArrayField(objectBody, 'capabilities')
  const expiresInSeconds = optionalPositiveNumber(objectBody, 'expiresInSeconds')
  if (
    (kind !== 'stem' && kind !== 'leaf') ||
    !name ||
    capabilities === null ||
    expiresInSeconds === null
  )
    return null
  return {
    kind,
    name,
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(expiresInSeconds === undefined ? {} : { expiresInSeconds })
  }
}
export function readCredentialTargetBody(body: unknown): MNetCredentialTargetBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const networkId = stringField(objectBody, 'networkId')
  const nodeId = stringField(objectBody, 'nodeId')
  return networkId && nodeId ? { networkId, nodeId } : null
}
export function readNodeControlBody(body: unknown): MNetNodeControlBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const nodeId = stringField(objectBody, 'nodeId')
  const reason = optionalStringField(objectBody, 'reason')
  if (!nodeId || reason === null) return null
  return reason === undefined ? { nodeId } : { nodeId, reason }
}
export function readCredentialRevokeBody(body: unknown): MNetCredentialRevokeBody | null {
  const target = readCredentialTargetBody(body)
  const objectBody = asObject(body)
  if (!target || !objectBody) return null
  const reason = optionalStringField(objectBody, 'reason')
  if (reason === null) return null
  return reason === undefined ? target : { ...target, reason }
}
export function readProfileToggleBody(body: unknown): MNetProfileToggleBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const networkId = stringField(objectBody, 'networkId')
  const profileVersion = stringField(objectBody, 'profileVersion')
  const reason = optionalStringField(objectBody, 'reason')
  if (!networkId || !profileVersion || reason === null) return null
  return reason === undefined
    ? { networkId, profileVersion }
    : { networkId, profileVersion, reason }
}
export function readBreakGlassBody(body: unknown): MNetBreakGlassBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const networkId = stringField(objectBody, 'networkId')
  const confirmation = stringField(objectBody, 'confirmation')
  const emergencyReason = optionalStringField(objectBody, 'emergencyReason')
  if (!networkId || !confirmation || emergencyReason === null) return null
  return emergencyReason === undefined
    ? { networkId, confirmation }
    : { networkId, confirmation, emergencyReason }
}
export function readDefaultsSetBody(body: unknown): MNetDefaultsSetBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const profileVersion = stringField(objectBody, 'profileVersion')
  const reason = optionalStringField(objectBody, 'reason')
  const idempotencyKey = optionalStringField(objectBody, 'idempotencyKey')
  if (!profileVersion || reason === null || idempotencyKey === null) return null
  return {
    profileVersion,
    ...(reason === undefined ? {} : { reason }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey })
  }
}
export function readMigrationDryRunBody(body: unknown): MNetMigrationDryRunBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const targetProfileVersion = stringField(objectBody, 'targetProfileVersion')
  const batchSize = optionalPositiveNumber(objectBody, 'batchSize')
  const reason = optionalStringField(objectBody, 'reason')
  const idempotencyKey = optionalStringField(objectBody, 'idempotencyKey')
  if (!targetProfileVersion || batchSize === null || reason === null || idempotencyKey === null)
    return null
  return {
    targetProfileVersion,
    ...(batchSize === undefined ? {} : { batchSize }),
    ...(reason === undefined ? {} : { reason }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey })
  }
}
export function readMigrationOperationBody(body: unknown): MNetMigrationOperationBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const operationId = stringField(objectBody, 'operationId')
  return operationId ? { operationId } : null
}
export function readMigrationRollbackBody(body: unknown): MNetMigrationRollbackBody | null {
  const operation = readMigrationOperationBody(body)
  const objectBody = asObject(body)
  if (!operation || !objectBody) return null
  const reason = optionalStringField(objectBody, 'reason')
  if (reason === null) return null
  return reason === undefined ? operation : { ...operation, reason }
}
export function isSecurityAdminActor(actor: string) {
  return actor === 'security-admin'
}
export function isNetworkAdminActor(actor: string) {
  return actor === 'admin' || actor === 'security-admin'
}
