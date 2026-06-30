import { Elysia } from 'elysia'
import {
  ApprovalDetailResponseSchema,
  MNetProfileDetailResponseSchema,
  NodeDetailResponseSchema,
  SessionResponseSchema
} from '../../../../packages/contracts/src/index.ts'
import {
  deriveNodeControlCommandEligibility,
  deriveNoopCommandEligibility,
  isNodeControlExecuteCommandId,
  missingPermissionCommandEligibility,
  targetMissingCommandEligibility
} from '../command-well/eligibility.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import {
  COMMAND_PREVIEW_DEFINITIONS,
  GENERIC_NOOP_COMMAND_ID,
  MNET_BREAK_GLASS_EXECUTE_COMMAND_ID,
  MNET_DEFAULTS_SET_EXECUTE_COMMAND_ID,
  MNET_FORCED_RELAY_CHANGE_EXECUTE_COMMAND_ID,
  MNET_JOIN_TICKET_CREATE_EXECUTE_COMMAND_ID,
  MNET_MIGRATION_APPLY_EXECUTE_COMMAND_ID,
  MNET_MIGRATION_DRY_RUN_EXECUTE_COMMAND_ID,
  MNET_MIGRATION_RESUME_EXECUTE_COMMAND_ID,
  MNET_MIGRATION_ROLLBACK_EXECUTE_COMMAND_ID,
  MNET_NODE_CREDENTIAL_ISSUE_EXECUTE_COMMAND_ID,
  MNET_NODE_CREDENTIAL_REVOKE_EXECUTE_COMMAND_ID,
  MNET_NODE_CREDENTIAL_ROTATE_EXECUTE_COMMAND_ID,
  MNET_PROFILE_DISABLE_EXECUTE_COMMAND_ID,
  MNET_PROFILE_ENABLE_EXECUTE_COMMAND_ID
} from '../types.ts'
import {
  deriveApprovalPreviewEligibility,
  deriveNetworkProfilePreviewEligibility,
  displayOnlyPreview,
  invalidExecuteBody,
  isDisplayOnlyCommandId,
  readApprovalBody,
  readForcedRelayChangeBody,
  readLeafNodeIdBody,
  readNetworkProfilePreviewBody,
  toMutableNode
} from './command-well-support.ts'
import {
  disabledEligibility,
  enabledEligibility,
  isNetworkAdminActor,
  isSecurityAdminActor,
  readCredentialTargetBody,
  readMigrationOperationBody,
  readNodeControlBody
} from './mnet-dataplane-support.ts'
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
export function createCommandWellEligibilityRoutes({ cf, mf, tf }: MUiBffRouteDeps) {
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
          if (
            commandId === MNET_JOIN_TICKET_CREATE_EXECUTE_COMMAND_ID ||
            commandId === MNET_NODE_CREDENTIAL_ISSUE_EXECUTE_COMMAND_ID ||
            commandId === MNET_NODE_CREDENTIAL_ROTATE_EXECUTE_COMMAND_ID ||
            commandId === MNET_NODE_CREDENTIAL_REVOKE_EXECUTE_COMMAND_ID ||
            commandId === MNET_PROFILE_ENABLE_EXECUTE_COMMAND_ID ||
            commandId === MNET_PROFILE_DISABLE_EXECUTE_COMMAND_ID ||
            commandId === MNET_DEFAULTS_SET_EXECUTE_COMMAND_ID ||
            commandId === MNET_FORCED_RELAY_CHANGE_EXECUTE_COMMAND_ID ||
            commandId === MNET_MIGRATION_DRY_RUN_EXECUTE_COMMAND_ID ||
            commandId === MNET_MIGRATION_APPLY_EXECUTE_COMMAND_ID ||
            commandId === MNET_MIGRATION_RESUME_EXECUTE_COMMAND_ID ||
            commandId === MNET_MIGRATION_ROLLBACK_EXECUTE_COMMAND_ID ||
            commandId === MNET_BREAK_GLASS_EXECUTE_COMMAND_ID ||
            commandId === MNET_FORCED_RELAY_CHANGE_EXECUTE_COMMAND_ID ||
            isNodeControlExecuteCommandId(commandId)
          ) {
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

            if (commandId === MNET_JOIN_TICKET_CREATE_EXECUTE_COMMAND_ID) {
              return session.permissions.includes('node:register')
                ? enabledEligibility({
                    id: commandId,
                    label: '创建 Join Ticket',
                    action: 'node:register',
                    resource: 'network.join-ticket',
                    requiredPermissions: ['node:register']
                  })
                : disabledEligibility(
                    'missing_permission',
                    '缺少权限：node:register',
                    'node:register'
                  )
            }

            if (isNodeControlExecuteCommandId(commandId)) {
              const target = readNodeControlBody(body)
              if (!target) return invalidExecuteBody('nodeId is required')

              const nodeRes = await cf(`/api/v0/nodes/${target.nodeId}`, token)
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

              return deriveNodeControlCommandEligibility(
                session,
                toMutableNode(decodedNode.node),
                commandId
              )
            }

            if (commandId === MNET_FORCED_RELAY_CHANGE_EXECUTE_COMMAND_ID) {
              const target = readForcedRelayChangeBody(body)
              if (!target) return invalidExecuteBody('nodeId is required')

              if (!session.permissions.includes('network:profile-enable')) {
                return disabledEligibility(
                  'missing_permission',
                  '缺少权限：network:profile-enable',
                  'network:profile-enable'
                )
              }

              const response = await mf('/api/v0/forced-relay/eligibility', token, {
                method: 'POST',
                body: JSON.stringify(target)
              })
              if (!response.ok) return passthroughCoreError(response)
              return response.data
            }

            if (
              commandId === MNET_NODE_CREDENTIAL_ISSUE_EXECUTE_COMMAND_ID ||
              commandId === MNET_NODE_CREDENTIAL_ROTATE_EXECUTE_COMMAND_ID ||
              commandId === MNET_NODE_CREDENTIAL_REVOKE_EXECUTE_COMMAND_ID
            ) {
              const target = readCredentialTargetBody(body)
              if (!target) return invalidExecuteBody('networkId and nodeId are required')
              return session.permissions.includes('node:issue-token')
                ? enabledEligibility({
                    id: commandId,
                    label: '管理节点凭证',
                    action: 'node:issue-token',
                    resource: `network/${target.networkId}/node/${target.nodeId}`,
                    requiredPermissions: ['node:issue-token']
                  })
                : disabledEligibility(
                    'missing_permission',
                    '缺少权限：node:issue-token',
                    'node:issue-token'
                  )
            }

            if (commandId === MNET_BREAK_GLASS_EXECUTE_COMMAND_ID) {
              return isSecurityAdminActor(session.actor)
                ? enabledEligibility({
                    id: commandId,
                    label: '执行 break-glass',
                    action: 'network:profile-disable',
                    resource: 'network.break-glass',
                    requiredPermissions: ['network:profile-disable']
                  })
                : disabledEligibility('missing_permission', '缺少权限：security-admin')
            }

            if (
              commandId === MNET_MIGRATION_DRY_RUN_EXECUTE_COMMAND_ID ||
              commandId === MNET_MIGRATION_APPLY_EXECUTE_COMMAND_ID ||
              commandId === MNET_MIGRATION_RESUME_EXECUTE_COMMAND_ID ||
              commandId === MNET_MIGRATION_ROLLBACK_EXECUTE_COMMAND_ID
            ) {
              if (!isNetworkAdminActor(session.actor)) {
                return disabledEligibility('missing_permission', '缺少权限：network-admin')
              }
              const operation =
                commandId === MNET_MIGRATION_DRY_RUN_EXECUTE_COMMAND_ID
                  ? 'network.migration'
                  : (readMigrationOperationBody(body)?.operationId ?? 'network.migration')
              return enabledEligibility({
                id: commandId,
                label: '执行网络迁移',
                action: 'network:profile-enable',
                resource: operation,
                requiredPermissions: ['network:profile-enable']
              })
            }

            if (
              commandId === MNET_PROFILE_ENABLE_EXECUTE_COMMAND_ID ||
              commandId === MNET_PROFILE_DISABLE_EXECUTE_COMMAND_ID ||
              commandId === MNET_DEFAULTS_SET_EXECUTE_COMMAND_ID
            ) {
              const permission =
                commandId === MNET_PROFILE_DISABLE_EXECUTE_COMMAND_ID
                  ? 'network:profile-disable'
                  : 'network:profile-enable'
              return session.permissions.includes(permission)
                ? enabledEligibility({
                    id: commandId,
                    label: '管理数据面 Profile',
                    action: permission,
                    resource: 'network.dataplane-profile',
                    requiredPermissions: [permission]
                  })
                : disabledEligibility('missing_permission', `缺少权限：${permission}`, permission)
            }
          }

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
