import * as Schema from 'effect/Schema'
import type {
  CommandWellEligibilityFromSchema as CommandWellEligibility,
  Permission
} from '../../../../packages/contracts/src/index.ts'
import { internalTokenHeaderName } from '../../../../packages/internal-http/src/index.ts'
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
} from '../types.ts'

export const BffJoinTicketRecordSchema = Schema.Struct({
  ticketId: Schema.String,
  ticket: Schema.String,
  expiresAt: Schema.String,
  joinUrl: Schema.String,
  policyDecisionId: Schema.String,
  correlationId: Schema.String,
  networkId: Schema.String,
  status: Schema.Literal('active')
})

export const BffJoinTicketListResponseSchema = Schema.Struct({
  tickets: Schema.Array(BffJoinTicketRecordSchema)
})

export const BffCredentialMutationResponseSchema = Schema.Struct({
  nodeId: Schema.String,
  action: Schema.Literal('issued', 'rotated', 'revoked'),
  policyDecisionId: Schema.String,
  correlationId: Schema.String,
  token: Schema.optional(Schema.String),
  issuedAt: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String)
})

export const BffDataPlaneNodeStatusSchema = Schema.Struct({
  networkId: Schema.String,
  nodeId: Schema.String,
  tunnelStatus: Schema.String,
  relayAssignment: Schema.Struct({
    relayId: Schema.String,
    relayType: Schema.String,
    relayEndpoint: Schema.String
  }),
  lastMapVersion: Schema.String,
  lastMapAt: Schema.String,
  partitionState: Schema.String,
  stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
})

export const BffDataPlaneStatusResponseSchema = Schema.Struct({
  networkId: Schema.String,
  nodes: Schema.Array(BffDataPlaneNodeStatusSchema),
  stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
})

export const BffRelayAssignmentResponseSchema = Schema.Struct({
  networkId: Schema.String,
  relayAssignment: Schema.Struct({
    relayType: Schema.String,
    relayEndpoint: Schema.String,
    nodeIds: Schema.Array(Schema.String)
  }),
  stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
})

export const BffNetworkMapSummaryResponseSchema = Schema.Struct({
  networkId: Schema.String,
  mapVersion: Schema.String,
  memberCount: Schema.Number,
  aclRuleCount: Schema.Number,
  relayAssignment: Schema.Struct({
    relayType: Schema.String,
    relayEndpoint: Schema.String,
    nodeIds: Schema.Array(Schema.String)
  }),
  expiresAt: Schema.String,
  signedBy: Schema.String,
  stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
})

export const BffNetworkDetailResponseSchema = Schema.Struct({
  network: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    profileVersion: Schema.String,
    status: Schema.String,
    createdAt: Schema.String,
    memberCount: Schema.optional(Schema.Number),
    stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
  }),
  members: Schema.Array(
    Schema.Struct({
      networkId: Schema.String,
      nodeId: Schema.String,
      nodeKind: Schema.String,
      membershipMode: Schema.String,
      status: Schema.String,
      joinedAt: Schema.String,
      stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
    })
  ),
  profileState: Schema.Struct({
    profileVersion: Schema.String,
    stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
  }),
  networkMapSummary: BffNetworkMapSummaryResponseSchema,
  dataPlaneStatus: BffDataPlaneStatusResponseSchema,
  stateSource: Schema.Struct({ sourceType: Schema.String, sourceId: Schema.String })
})

type DisabledCode = 'missing_permission' | 'target_missing' | 'wrong_node_kind' | 'node_unreachable'

/** 统一构造 M-Net CommandWell 禁用态，保持与现有 UI schema 一致。 */
export function disabledEligibility(
  code: DisabledCode,
  message: string,
  missingPermission?: Permission
): CommandWellEligibility {
  return {
    state: 'disabled',
    disabled: {
      code,
      message,
      ...(missingPermission ? { missingPermission } : {})
    },
    disabledReason: message
  }
}

/** M-Net 数据面控制命令使用现有 disabled 语义，不在 BFF 内做最终授权。 */
export function enabledEligibility(input: {
  id: string
  label: string
  action: Permission
  resource: string
  risk?: 'medium' | 'high'
  requiredPermissions: readonly Permission[]
}) {
  return {
    state: 'enabled' as const,
    command: {
      id: input.id,
      label: input.label,
      action: input.action,
      resource: input.resource,
      risk: input.risk ?? 'high',
      requiredPermissions: input.requiredPermissions,
      requiresPolicy: true,
      requiresAudit: true
    }
  }
}

/** 发送 M-Net internal 路由时附加 shared internal token，避免公开 Bearer 直接打内部接口。 */
export function withInternalHeaders(init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      [internalTokenHeaderName]: process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'
    }
  }
}

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

/** 读取 join ticket 创建请求体。 */
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
  ) {
    return null
  }
  return {
    kind,
    name,
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(expiresInSeconds === undefined ? {} : { expiresInSeconds })
  }
}

/** 读取节点凭证目标请求体。 */
export function readCredentialTargetBody(body: unknown): MNetCredentialTargetBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const networkId = stringField(objectBody, 'networkId')
  const nodeId = stringField(objectBody, 'nodeId')
  return networkId && nodeId ? { networkId, nodeId } : null
}

/** 读取节点控制目标请求体；reason 可由 BFF execute 包装层补默认值。 */
export function readNodeControlBody(body: unknown): MNetNodeControlBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const nodeId = stringField(objectBody, 'nodeId')
  const reason = optionalStringField(objectBody, 'reason')
  if (!nodeId || reason === null) return null
  return reason === undefined ? { nodeId } : { nodeId, reason }
}

/** 读取节点凭证吊销请求体。 */
export function readCredentialRevokeBody(body: unknown): MNetCredentialRevokeBody | null {
  const target = readCredentialTargetBody(body)
  if (!target) return null
  const objectBody = asObject(body)
  if (!objectBody) return null
  const reason = optionalStringField(objectBody, 'reason')
  if (reason === null) return null
  return reason === undefined ? target : { ...target, reason }
}

/** 读取 Profile 启停请求体。 */
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

/** 读取 break-glass 请求体；confirmation 必填。 */
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

/** 读取默认值设置请求体。 */
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

/** 读取迁移 dry-run 请求体。 */
export function readMigrationDryRunBody(body: unknown): MNetMigrationDryRunBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const targetProfileVersion = stringField(objectBody, 'targetProfileVersion')
  const batchSize = optionalPositiveNumber(objectBody, 'batchSize')
  const reason = optionalStringField(objectBody, 'reason')
  const idempotencyKey = optionalStringField(objectBody, 'idempotencyKey')
  if (!targetProfileVersion || batchSize === null || reason === null || idempotencyKey === null) {
    return null
  }
  return {
    targetProfileVersion,
    ...(batchSize === undefined ? {} : { batchSize }),
    ...(reason === undefined ? {} : { reason }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey })
  }
}

/** 读取迁移 operationId 请求体。 */
export function readMigrationOperationBody(body: unknown): MNetMigrationOperationBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const operationId = stringField(objectBody, 'operationId')
  return operationId ? { operationId } : null
}

/** 读取迁移回滚请求体。 */
export function readMigrationRollbackBody(body: unknown): MNetMigrationRollbackBody | null {
  const operation = readMigrationOperationBody(body)
  if (!operation) return null
  const objectBody = asObject(body)
  if (!objectBody) return null
  const reason = optionalStringField(objectBody, 'reason')
  if (reason === null) return null
  return reason === undefined ? operation : { ...operation, reason }
}

/** 用 actor 语义补充高敏命令 eligibility，避免把最终授权硬编码进 BFF。 */
export function isSecurityAdminActor(actor: string) {
  return actor === 'security-admin'
}

/** 用 admin/security-admin 近似 network-admin 运营角色，用于展示态提示。 */
export function isNetworkAdminActor(actor: string) {
  return actor === 'admin' || actor === 'security-admin'
}
