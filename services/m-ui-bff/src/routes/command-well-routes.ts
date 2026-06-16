import { Elysia, t } from 'elysia'
import type { ActorId, MNode, Permission } from '../../../../packages/contracts/src/index.ts'
import {
  deriveNoopCommandEligibility,
  missingPermissionCommandEligibility,
  targetMissingCommandEligibility
} from '../command-well/eligibility.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import {
  type ApprovalPreviewBody,
  COMMAND_PREVIEW_DEFINITIONS,
  DISPLAY_ONLY_COMMAND_IDS,
  GENERIC_NOOP_COMMAND_ID,
  type GenericCommandEligibilityBody,
  type NetworkProfilePreviewBody
} from '../types.ts'
import {
  bearerTokenFromHeaders,
  bffError,
  passthroughCoreError,
  toGenericNoopEligibility
} from './route-helpers.ts'
import { commandIdParamsSchema, leafNodeIdBodySchema } from './route-schemas.ts'

const genericCommandEligibilityBodySchema = t.Union([
  leafNodeIdBodySchema,
  t.Object({ approvalId: t.String({ minLength: 1 }) }),
  t.Object({
    networkId: t.String({ minLength: 1 }),
    profileVersion: t.String({ minLength: 1 })
  })
])

type SessionFacts = {
  actor: ActorId
  permissions: Permission[]
}

type ApprovalReadModel = {
  id: string
  status: string
}

type NetworkProfileReadModel = {
  profileVersion: string
}

type DisplayOnlyCommandId = (typeof DISPLAY_ONLY_COMMAND_IDS)[number]

function isDisplayOnlyCommandId(commandId: string): commandId is DisplayOnlyCommandId {
  return DISPLAY_ONLY_COMMAND_IDS.includes(commandId as DisplayOnlyCommandId)
}

/** 预览命令只返回展示态，不返回 execute URL，也不触发策略或审计副作用。 */
function displayOnlyPreview(
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
function deriveApprovalPreviewEligibility(
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
function deriveNetworkProfilePreviewEligibility(
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

/**
 * createCommandWellRoutes 保留 noop 命令派生与执行语义，只把路由装配从 app.ts 中抽离。
 */
export function createCommandWellRoutes({ cf, tf }: MUiBffRouteDeps) {
  return new Elysia()
    .post(
      '/api/v0/commands/noop',
      async ({ body, headers }) => {
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const [sessionRes, nodeRes] = await Promise.all([
          cf('/api/v0/session', token),
          cf(`/api/v0/nodes/${body.leafNodeId}`, token)
        ])

        if (!sessionRes.ok) return passthroughCoreError(sessionRes)
        const session = sessionRes.data as { actor: ActorId; permissions: Permission[] }

        if (!session.permissions.includes('task:submit')) {
          return missingPermissionCommandEligibility()
        }

        if (!nodeRes.ok) {
          if (nodeRes.status === 404) return targetMissingCommandEligibility()
          return passthroughCoreError(nodeRes)
        }
        const node = (nodeRes.data as { node: MNode }).node
        return deriveNoopCommandEligibility(session, node)
      },
      {
        body: leafNodeIdBodySchema,
        detail: { summary: 'Derive disabled/enabled state for the noop task command' }
      }
    )
    .post(
      '/api/v0/commands/noop/execute',
      async ({ body, headers }) => {
        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const result = await tf('/api/v0/tasks', token, {
          method: 'POST',
          body: JSON.stringify({ nodeId: body.leafNodeId, type: 'noop' })
        })
        if (!result.ok) return passthroughCoreError(result)
        return result.data
      },
      {
        body: leafNodeIdBodySchema,
        detail: { summary: 'Execute noop task against a Leaf node' }
      }
    )
    .post(
      '/api/v0/commands/:commandId/eligibility',
      async ({ params, body, headers }) => {
        const commandId = params.commandId
        if (commandId === GENERIC_NOOP_COMMAND_ID) {
          const token = bearerTokenFromHeaders(headers)
          if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

          const noopBody = body as Extract<GenericCommandEligibilityBody, { leafNodeId: string }>
          const [sessionRes, nodeRes] = await Promise.all([
            cf('/api/v0/session', token),
            cf(`/api/v0/nodes/${noopBody.leafNodeId}`, token)
          ])

          if (!sessionRes.ok) return passthroughCoreError(sessionRes)
          const session = sessionRes.data as { actor: ActorId; permissions: Permission[] }

          if (!session.permissions.includes('task:submit')) {
            return toGenericNoopEligibility(missingPermissionCommandEligibility())
          }

          if (!nodeRes.ok) {
            if (nodeRes.status === 404) {
              return toGenericNoopEligibility(targetMissingCommandEligibility())
            }
            return passthroughCoreError(nodeRes)
          }

          const node = (nodeRes.data as { node: MNode }).node
          return toGenericNoopEligibility(deriveNoopCommandEligibility(session, node))
        }

        if (!isDisplayOnlyCommandId(commandId)) {
          return bffError(400, 'command.unknown', 'unknown command id')
        }

        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const sessionRes = await cf('/api/v0/session', token)
        if (!sessionRes.ok) return passthroughCoreError(sessionRes)
        const session = sessionRes.data as SessionFacts

        if (
          commandId === 'policy.approval.approve.preview' ||
          commandId === 'policy.approval.reject.preview'
        ) {
          const approvalBody = body as ApprovalPreviewBody
          const approvalDef = COMMAND_PREVIEW_DEFINITIONS[commandId]
          if (!approvalDef) throw new Error(`command definition not found: ${commandId}`)
          const requiredPermission = approvalDef.requiredPermissions[0]
          if (!requiredPermission)
            throw new Error(`command ${commandId} has no required permissions`)
          if (!session.permissions.includes(requiredPermission)) {
            return displayOnlyPreview(
              commandId,
              `approval/${approvalBody.approvalId}`,
              'disabled',
              `缺少权限：${requiredPermission}`
            )
          }

          const approvalRes = await cf(`/api/v0/policy/approvals/${approvalBody.approvalId}`, token)
          if (!approvalRes.ok) return passthroughCoreError(approvalRes)
          const approval = approvalRes.data as ApprovalReadModel
          return deriveApprovalPreviewEligibility(commandId, session, approval, approvalBody)
        }

        if (
          commandId === 'network.profile.enable.preview' ||
          commandId === 'network.profile.disable.preview'
        ) {
          const profileBody = body as NetworkProfilePreviewBody
          const profileDef = COMMAND_PREVIEW_DEFINITIONS[commandId]
          if (!profileDef) throw new Error(`command definition not found: ${commandId}`)
          const requiredPermission = profileDef.requiredPermissions[0]
          if (!requiredPermission)
            throw new Error(`command ${commandId} has no required permissions`)
          if (!session.permissions.includes(requiredPermission)) {
            return displayOnlyPreview(
              commandId,
              `network/${profileBody.networkId}/profile/${profileBody.profileVersion}`,
              'disabled',
              `缺少权限：${requiredPermission}`
            )
          }

          const profileRes = await cf(
            `/api/v0/network-profiles/${profileBody.profileVersion}`,
            token
          )
          if (!profileRes.ok) return passthroughCoreError(profileRes)
          const profile = profileRes.data as NetworkProfileReadModel
          return deriveNetworkProfilePreviewEligibility(commandId, session, profile, profileBody)
        }

        return bffError(400, 'command.unknown', 'unknown command id')
      },
      {
        params: commandIdParamsSchema,
        body: genericCommandEligibilityBodySchema,
        detail: { summary: 'Derive generic CommandWell eligibility' }
      }
    )
    .post(
      '/api/v0/commands/:commandId/execute',
      async ({ params, body, headers }) => {
        if (isDisplayOnlyCommandId(params.commandId)) {
          return bffError(400, 'command.display_only', 'display-only command cannot be executed')
        }

        if (params.commandId !== GENERIC_NOOP_COMMAND_ID) {
          return bffError(400, 'command.unknown', 'unknown command id')
        }

        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const noopBody = body as Extract<GenericCommandEligibilityBody, { leafNodeId: string }>
        const result = await tf('/api/v0/tasks', token, {
          method: 'POST',
          body: JSON.stringify({ nodeId: noopBody.leafNodeId, type: 'noop' })
        })
        if (!result.ok) return passthroughCoreError(result)
        return result.data
      },
      {
        params: commandIdParamsSchema,
        body: genericCommandEligibilityBodySchema,
        detail: { summary: 'Execute generic CommandWell command' }
      }
    )
}
