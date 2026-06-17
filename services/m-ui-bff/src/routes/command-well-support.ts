import type {
  ActorId,
  Permission
} from '../../../../packages/contracts/src/index.ts'
import {
  COMMAND_PREVIEW_DEFINITIONS,
  DISPLAY_ONLY_COMMAND_IDS,
  type ApprovalPreviewBody,
  type GenericCommandEligibilityBody,
  type NetworkProfileBreakGlassDisableBody,
  type NetworkProfileDefaultSetBody,
  type NetworkProfileDisablePolicySetBody,
  type NetworkProfileExecuteBody,
  type NetworkProfileGlobalSwitchApplyBody,
  type NetworkProfileGlobalSwitchPlanBody,
  type NetworkProfilePreviewBody
} from '../types.ts'
import { bffError } from './route-helpers.ts'

export type SessionFacts = {
  actor: ActorId
  permissions: readonly Permission[]
}

export type ApprovalReadModel = {
  id: string
  status: string
}

export type NetworkProfileReadModel = {
  profileVersion: string
}

export type DisplayOnlyCommandId = (typeof DISPLAY_ONLY_COMMAND_IDS)[number]

/** BFF 生成幂等键，避免 CommandWell 在无显式键时重复拼装不同格式。 */
export function bffIdempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`
}

export function isDisplayOnlyCommandId(commandId: string): commandId is DisplayOnlyCommandId {
  return DISPLAY_ONLY_COMMAND_IDS.some(id => id === commandId)
}

export function invalidExecuteBody(message: string) {
  return bffError(400, 'command.invalid_body', message)
}

/** Core execute facade 必须先按 HTTP status 分支，错误 envelope 直接透传，避免误解析成 200 成功体。 */
export async function forwardCoreExecute(responsePromise: Promise<Response>) {
  const response = await responsePromise
  if (response.status >= 400) return response

  try {
    return await response.json()
  } catch {
    return bffError(502, 'bff.invalid_upstream_response', 'Upstream service returned invalid JSON')
  }
}

function asObject(body: unknown): object | null {
  return typeof body === 'object' && body !== null ? body : null
}

function getStringField(body: object, key: string): string | undefined {
  const value = Reflect.get(body, key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getOptionalStringField(body: object, key: string): string | undefined | null {
  const value = Reflect.get(body, key)
  if (value === undefined) return undefined
  return typeof value === 'string' && value.length > 0 ? value : null
}

function getOptionalStringFieldAllowEmpty(body: object, key: string): string | undefined | null {
  const value = Reflect.get(body, key)
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : null
}

function getPositiveNumberField(body: object, key: string): number | undefined | null {
  const value = Reflect.get(body, key)
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : null
}

function getBooleanField(body: object, key: string): boolean | null {
  const value = Reflect.get(body, key)
  return typeof value === 'boolean' ? value : null
}

/** Eligibility/execute 共用 body 都先走轻量 shape 检查，避免路由层维护一长串 Record 断言。 */
export function readLeafNodeIdBody(body: unknown): { leafNodeId: string } | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const leafNodeId = getStringField(objectBody, 'leafNodeId')
  return leafNodeId ? { leafNodeId } : null
}

export function readApprovalBody(body: unknown): ApprovalPreviewBody & { reason?: string } | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const approvalId = getStringField(objectBody, 'approvalId')
  const reason = getOptionalStringField(objectBody, 'reason')
  if (!approvalId || reason === null) return null
  return reason === undefined ? { approvalId } : { approvalId, reason }
}

export function readNetworkProfilePreviewBody(body: unknown): NetworkProfilePreviewBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const networkId = getStringField(objectBody, 'networkId')
  const profileVersion = getStringField(objectBody, 'profileVersion')
  return networkId && profileVersion ? { networkId, profileVersion } : null
}

export function readNetworkProfileExecuteBody(body: unknown): NetworkProfileExecuteBody | null {
  const previewBody = readNetworkProfilePreviewBody(body)
  if (!previewBody) return null
  const objectBody = asObject(body)
  if (!objectBody) return null
  const reason = getOptionalStringField(objectBody, 'reason')
  if (reason === null) return null
  return reason === undefined ? previewBody : { ...previewBody, reason }
}

export function readNetworkProfileDefaultSetBody(
  body: unknown
): NetworkProfileDefaultSetBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const profileVersion = getStringField(objectBody, 'profileVersion')
  const reason = getOptionalStringField(objectBody, 'reason')
  const idempotencyKey = getOptionalStringField(objectBody, 'idempotencyKey')
  if (!profileVersion || reason === null || idempotencyKey === null) return null
  return {
    profileVersion,
    ...(reason === undefined ? {} : { reason }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey })
  }
}

export function readNetworkProfileGlobalSwitchPlanBody(
  body: unknown
): NetworkProfileGlobalSwitchPlanBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const targetProfileVersion = getStringField(objectBody, 'targetProfileVersion')
  const batchSize = getPositiveNumberField(objectBody, 'batchSize')
  const reason = getOptionalStringField(objectBody, 'reason')
  const idempotencyKey = getOptionalStringField(objectBody, 'idempotencyKey')
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

export function readNetworkProfileGlobalSwitchApplyBody(
  body: unknown
): NetworkProfileGlobalSwitchApplyBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const operationId = getStringField(objectBody, 'operationId')
  return operationId ? { operationId } : null
}

export function readNetworkProfileDisablePolicySetBody(
  body: unknown
): NetworkProfileDisablePolicySetBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const requireApproval = getBooleanField(objectBody, 'requireApproval')
  const emergencyBreakGlassEnabled = getBooleanField(objectBody, 'emergencyBreakGlassEnabled')
  const reason = getOptionalStringField(objectBody, 'reason')
  const idempotencyKey = getOptionalStringField(objectBody, 'idempotencyKey')
  if (
    requireApproval === null ||
    emergencyBreakGlassEnabled === null ||
    reason === null ||
    idempotencyKey === null
  ) {
    return null
  }
  return {
    requireApproval,
    emergencyBreakGlassEnabled,
    ...(reason === undefined ? {} : { reason }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey })
  }
}

export function readNetworkProfileBreakGlassDisableBody(
  body: unknown
): NetworkProfileBreakGlassDisableBody | null {
  const objectBody = asObject(body)
  if (!objectBody) return null
  const networkId = getStringField(objectBody, 'networkId')
  const emergencyReason = getOptionalStringFieldAllowEmpty(objectBody, 'emergencyReason')
  if (!networkId || emergencyReason === null) return null
  return emergencyReason === undefined ? { networkId } : { networkId, emergencyReason }
}

/** 预览命令只返回展示态，不返回 execute URL，也不触发策略或审计副作用。 */
export function displayOnlyPreview(
  commandId: DisplayOnlyCommandId,
  resource: string,
  state: 'enabled' | 'disabled',
  disabledReason?: string
) {
  const definition = COMMAND_PREVIEW_DEFINITIONS[commandId]
  return {
    ...definition,
    resource,
    state,
    ...(disabledReason ? { disabledReason } : {}),
    displayOnly: true as const
  }
}

/** 审批预览只依赖会话权限与 Core 公共读 facade，不做任何执行授权。 */
export function deriveApprovalPreviewEligibility(
  commandId: 'policy.approval.approve.preview' | 'policy.approval.reject.preview',
  session: SessionFacts,
  approval: ApprovalReadModel,
  body: ApprovalPreviewBody
) {
  const def = COMMAND_PREVIEW_DEFINITIONS[commandId]
  if (!def) throw new Error(`command definition not found: ${commandId}`)
  const requiredPermission = def.requiredPermissions[0]
  if (!requiredPermission) throw new Error(`command ${commandId} has no required permissions`)
  if (!session.permissions.includes(requiredPermission)) {
    return displayOnlyPreview(
      commandId,
      `approval/${body.approvalId}`,
      'disabled',
      `缺少权限：${requiredPermission}`
    )
  }
  if (approval.status !== 'pending') {
    return displayOnlyPreview(
      commandId,
      `approval/${body.approvalId}`,
      'disabled',
      '审批已不是 pending 状态'
    )
  }
  return displayOnlyPreview(commandId, `approval/${body.approvalId}`, 'enabled')
}

/** Profile 预览只读显示命令上下文，当前明确禁止任何启停执行透传。 */
export function deriveNetworkProfilePreviewEligibility(
  commandId: 'network.profile.enable.preview' | 'network.profile.disable.preview',
  session: SessionFacts,
  profile: NetworkProfileReadModel,
  body: NetworkProfilePreviewBody
) {
  const def = COMMAND_PREVIEW_DEFINITIONS[commandId]
  if (!def) throw new Error(`command definition not found: ${commandId}`)
  const requiredPermission = def.requiredPermissions[0]
  if (!requiredPermission) throw new Error(`command ${commandId} has no required permissions`)
  if (!session.permissions.includes(requiredPermission)) {
    return displayOnlyPreview(
      commandId,
      `network/${body.networkId}/profile/${profile.profileVersion}`,
      'disabled',
      `缺少权限：${requiredPermission}`
    )
  }
  return displayOnlyPreview(
    commandId,
    `network/${body.networkId}/profile/${profile.profileVersion}`,
    'disabled',
    'Profile 操作当前仅提供只读预览'
  )
}

export function toMutableNode(node: {
  readonly id: string
  readonly kind: 'stem' | 'leaf'
  readonly name: string
  readonly mode: 'agent' | 'simulated'
  readonly status: 'joining' | 'healthy' | 'degraded' | 'offline' | 'revoked'
  readonly reachability: 'unknown' | 'reachable' | 'unreachable'
  readonly lastSeenAt?: string | undefined
  readonly agentVersion?: string | undefined
  readonly capabilities: readonly string[]
  readonly createdAt: string
}) {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    mode: node.mode,
    status: node.status,
    reachability: node.reachability,
    ...(node.lastSeenAt !== undefined ? { lastSeenAt: node.lastSeenAt } : {}),
    ...(node.agentVersion !== undefined ? { agentVersion: node.agentVersion } : {}),
    capabilities: [...node.capabilities],
    createdAt: node.createdAt
  }
}

export type { GenericCommandEligibilityBody }
