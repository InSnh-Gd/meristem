import * as Schema from 'effect/Schema'
import type {
  BffOperationalProofPathResponseFromSchema,
  CommandWellEligibilityFromSchema as CommandWellEligibility,
  DisabledCommandExplanationFromSchema as DisabledCommandExplanation,
  MNetMigrationRequired,
  MNetOperationalSnapshotFromSchema,
  Permission
} from '../../../../packages/contracts/src/index.ts'
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
  issuedAt: Schema.optional(Schema.String),
  revokedAt: Schema.optional(Schema.String),
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

type DisabledCode = DisabledCommandExplanation['code']

const operationalStateSource = (networkId: string, suffix: string) => ({
  sourceType: 'read-model' as const,
  sourceId: `mnet:/api/v0/networks/${networkId}/operational-state#${suffix}`
})

function disabledExplanation(input: {
  code: DisabledCode
  message: string
  missingPermission?: Permission
  migration?: MNetMigrationRequired
}): DisabledCommandExplanation {
  return {
    code: input.code,
    message: input.message,
    ...(input.missingPermission !== undefined
      ? { missingPermission: input.missingPermission }
      : {}),
    ...(input.migration ? { migration: input.migration } : {})
  }
}

/** 统一构造 M-Net CommandWell 禁用态，保持与现有 UI schema 一致。 */
export function disabledEligibility(
  code: DisabledCode,
  message: string,
  missingPermission?: Permission,
  migration?: MNetMigrationRequired
): CommandWellEligibility {
  const detail =
    missingPermission !== undefined || migration !== undefined
      ? disabledExplanation({
          code,
          message,
          ...(missingPermission !== undefined ? { missingPermission } : {}),
          ...(migration !== undefined ? { migration } : {})
        })
      : disabledExplanation({ code, message })
  return {
    state: 'disabled',
    disabled: detail,
    disabledReason: message
  }
}

/** M-Net 数据面控制命令使用现有 disabled 语义，不在 BFF 内做最终授权。 */
export function enabledEligibility(input: {
  id: string
  label: string
  action: string
  resource: string
  risk?: 'low' | 'medium' | 'high' | 'critical'
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

/** BFF 对节点凭证 mutation 只保留生命周期元数据，绝不回传明文 token。 */
export function redactCredentialMutationResponse(
  value: Record<string, unknown>
): Schema.Schema.Type<typeof BffCredentialMutationResponseSchema> {
  const nodeId = typeof value.nodeId === 'string' ? value.nodeId : ''
  const policyDecisionId = typeof value.policyDecisionId === 'string' ? value.policyDecisionId : ''
  const correlationId = typeof value.correlationId === 'string' ? value.correlationId : ''
  const issuedAt = typeof value.issuedAt === 'string' ? value.issuedAt : undefined
  const revokedAt = typeof value.revokedAt === 'string' ? value.revokedAt : undefined
  const reason = typeof value.reason === 'string' ? value.reason : undefined
  const action = revokedAt
    ? 'revoked'
    : issuedAt
      ? (typeof value.token === 'string' ? 'issued' : 'rotated')
      : 'rotated'

  return {
    nodeId,
    action,
    policyDecisionId,
    correlationId,
    ...(issuedAt ? { issuedAt } : {}),
    ...(revokedAt ? { revokedAt } : {}),
    ...(reason ? { reason } : {})
  }
}

/** 将公开 operational snapshot 适配成 proof-path 读模型，不在 BFF 内合成授权或最终状态。 */
export function mapOperationalSnapshotToProofPath(
  snapshot: MNetOperationalSnapshotFromSchema,
  permissions: readonly Permission[]
): BffOperationalProofPathResponseFromSchema {
  const migrationReason = snapshot.migrationRequired.required && snapshot.migrationRequired.migration
    ? disabledExplanation({
        code: 'migration_required',
        message: snapshot.migrationRequired.summary,
        migration: snapshot.migrationRequired.migration
      })
    : undefined
  const missingPermissionReason = permissions.includes('network:profile-enable')
    ? undefined
    : disabledExplanation({
        code: 'missing_permission',
        message: '缺少权限：network:profile-enable',
        missingPermission: 'network:profile-enable'
      })
  const profileSelectionReason = migrationReason ?? missingPermissionReason
  const eligibilityState = profileSelectionReason ? 'disabled' : 'enabled'

  return {
    networkId: snapshot.networkId,
    createManageStatus: {
      mode: 'manage',
      networkId: snapshot.networkId,
      networkStatus: snapshot.network.status,
      profileState: snapshot.network.profileState,
      memberCount: snapshot.network.memberCount,
      lastUpdatedAt: snapshot.network.lastUpdatedAt,
      summary: snapshot.network.summary,
      stateSource: operationalStateSource(snapshot.networkId, 'network')
    },
    profileSelection: {
      networkId: snapshot.networkId,
      profileSelection: snapshot.profileSelection,
      summary: snapshot.profileSelection.migration?.message ?? snapshot.network.summary,
      ...(profileSelectionReason ? { disabledReason: profileSelectionReason } : {}),
      stateSource: operationalStateSource(snapshot.networkId, 'profileSelection')
    },
    topology: {
      networkId: snapshot.networkId,
      topology: snapshot.topology,
      stateSource: operationalStateSource(snapshot.networkId, 'topology')
    },
    sidecarHealth: {
      networkId: snapshot.networkId,
      status: snapshot.sidecars.some(node => node.healthStatus === 'unhealthy' || node.stale)
        ? 'degraded'
        : snapshot.sidecars.length > 0
          ? 'healthy'
          : 'blocked',
      summary:
        snapshot.sidecars.length === 0
          ? 'No sidecar health facts are available'
          : `${snapshot.sidecars.length} sidecar runtime entries are visible`,
      nodes: snapshot.sidecars,
      stateSource: operationalStateSource(snapshot.networkId, 'sidecars')
    },
    credentialLifecycle: {
      networkId: snapshot.networkId,
      credentials: snapshot.credentials,
      stateSource: operationalStateSource(snapshot.networkId, 'credentials')
    },
    migration: {
      networkId: snapshot.networkId,
      migration: snapshot.migrationRequired,
      ...(migrationReason ? { disabledReason: migrationReason } : {}),
      stateSource: operationalStateSource(snapshot.networkId, 'migration')
    },
    policyEligibility: {
      networkId: snapshot.networkId,
      commands: [
        {
          commandId: 'network.profile.enable.execute',
          label: '切换网络 Profile',
          action: 'network:profile-enable',
          resource: `network:${snapshot.networkId}`,
          requiredPermissions: ['network:profile-enable'],
          requiresPolicy: true,
          requiresAudit: true,
          state: eligibilityState,
          ...(profileSelectionReason ? { disabledReason: profileSelectionReason } : {}),
          summary: profileSelectionReason?.message ?? '公开事实允许发起 profile 管理请求'
        },
        {
          commandId: 'network.break-glass.execute',
          label: '执行 break-glass',
          action: 'network:profile-disable',
          resource: `network:${snapshot.networkId}`,
          requiredPermissions: ['network:profile-disable'],
          requiresPolicy: true,
          requiresAudit: true,
          state: permissions.includes('network:profile-disable') ? 'enabled' : 'disabled',
          ...(permissions.includes('network:profile-disable')
            ? {}
            : {
                disabledReason: disabledExplanation({
                  code: 'missing_permission',
                  message: '缺少权限：network:profile-disable',
                  missingPermission: 'network:profile-disable'
                })
              }),
          summary: 'BFF 只展示策略资格，不决定最终授权'
        }
      ],
      stateSource: operationalStateSource(snapshot.networkId, 'policyEligibility')
    },
    progressFeed: {
      networkId: snapshot.networkId,
      eventStream: snapshot.eventStream,
      deploymentReadiness: snapshot.deploymentReadiness,
      summary: snapshot.deploymentReadiness.summary,
      stateSource: operationalStateSource(snapshot.networkId, 'progressFeed')
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
