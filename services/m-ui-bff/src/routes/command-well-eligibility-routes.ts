import { Elysia } from 'elysia'
import {
  ApprovalDetailResponseSchema,
  MNetProfileDetailResponseSchema,
  NodeDetailResponseSchema,
  SessionResponseSchema
} from '../../../../packages/contracts/src/index.ts'
import {
  deriveNoopCommandEligibility,
  missingPermissionCommandEligibility,
  targetMissingCommandEligibility
} from '../command-well/eligibility.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import { COMMAND_PREVIEW_DEFINITIONS, GENERIC_NOOP_COMMAND_ID } from '../types.ts'
import {
  deriveApprovalPreviewEligibility,
  deriveNetworkProfilePreviewEligibility,
  displayOnlyPreview,
  invalidExecuteBody,
  isDisplayOnlyCommandId,
  readApprovalBody,
  readLeafNodeIdBody,
  readNetworkProfilePreviewBody,
  toMutableNode
} from './command-well-support.ts'
import {
  bearerTokenFromHeaders,
  bffError,
  decodeUpstreamData,
  passthroughCoreError,
  toGenericNoopEligibility
} from './route-helpers.ts'
import {
  commandIdParamsSchema,
  genericCommandEligibilityBodySchema,
  leafNodeIdBodySchema
} from './route-schemas.ts'

/**
 * createCommandWellEligibilityRoutes 保留 noop 命令派生与通用 eligibility 语义。
 */
export function createCommandWellEligibilityRoutes({ cf, tf }: MUiBffRouteDeps) {
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
        const session = decodeUpstreamData(
          SessionResponseSchema,
          sessionRes.data,
          'Core returned invalid session payload'
        )
        if (session instanceof Response) return session

        if (!session.permissions.includes('task:submit')) {
          return missingPermissionCommandEligibility()
        }

        if (!nodeRes.ok) {
          if (nodeRes.status === 404) return targetMissingCommandEligibility()
          return passthroughCoreError(nodeRes)
        }
        const decodedNode = decodeUpstreamData(
          NodeDetailResponseSchema,
          nodeRes.data,
          'Core returned invalid node detail payload'
        )
        if (decodedNode instanceof Response) return decodedNode
        const node = toMutableNode(decodedNode.node)
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

          const noopBody = readLeafNodeIdBody(body)
          if (!noopBody) return invalidExecuteBody('leafNodeId is required')
          const [sessionRes, nodeRes] = await Promise.all([
            cf('/api/v0/session', token),
            cf(`/api/v0/nodes/${noopBody.leafNodeId}`, token)
          ])

          if (!sessionRes.ok) return passthroughCoreError(sessionRes)
          const session = decodeUpstreamData(
            SessionResponseSchema,
            sessionRes.data,
            'Core returned invalid session payload'
          )
          if (session instanceof Response) return session

          if (!session.permissions.includes('task:submit')) {
            return toGenericNoopEligibility(missingPermissionCommandEligibility())
          }

          if (!nodeRes.ok) {
            if (nodeRes.status === 404) {
              return toGenericNoopEligibility(targetMissingCommandEligibility())
            }
            return passthroughCoreError(nodeRes)
          }

          const decodedNode = decodeUpstreamData(
            NodeDetailResponseSchema,
            nodeRes.data,
            'Core returned invalid node detail payload'
          )
          if (decodedNode instanceof Response) return decodedNode
          const node = toMutableNode(decodedNode.node)
          return toGenericNoopEligibility(deriveNoopCommandEligibility(session, node))
        }

        if (!isDisplayOnlyCommandId(commandId)) {
          return bffError(400, 'command.unknown', 'unknown command id')
        }

        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const sessionRes = await cf('/api/v0/session', token)
        if (!sessionRes.ok) return passthroughCoreError(sessionRes)
        const session = decodeUpstreamData(
          SessionResponseSchema,
          sessionRes.data,
          'Core returned invalid session payload'
        )
        if (session instanceof Response) return session

        if (
          commandId === 'policy.approval.approve.preview' ||
          commandId === 'policy.approval.reject.preview'
        ) {
          const approvalBody = readApprovalBody(body)
          if (!approvalBody) return invalidExecuteBody('approvalId is required')
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
          const approval = decodeUpstreamData(
            ApprovalDetailResponseSchema,
            approvalRes.data,
            'Core returned invalid approval detail payload'
          )
          if (approval instanceof Response) return approval
          return deriveApprovalPreviewEligibility(commandId, session, approval, approvalBody)
        }

        if (
          commandId === 'network.profile.enable.preview' ||
          commandId === 'network.profile.disable.preview'
        ) {
          const profileBody = readNetworkProfilePreviewBody(body)
          if (!profileBody) {
            return invalidExecuteBody('networkId and profileVersion are required')
          }
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
          const profile = decodeUpstreamData(
            MNetProfileDetailResponseSchema,
            profileRes.data,
            'Core returned invalid network profile detail payload'
          )
          if (profile instanceof Response) return profile
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
}
