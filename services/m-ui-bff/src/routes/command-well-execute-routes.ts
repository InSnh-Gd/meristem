import { Elysia } from 'elysia'
import type { MUiBffRouteDeps } from '../deps.ts'
import {
  APPROVAL_APPROVE_EXECUTE_COMMAND_ID,
  APPROVAL_REJECT_EXECUTE_COMMAND_ID,
  GENERIC_NOOP_COMMAND_ID,
  PROFILE_BREAK_GLASS_DISABLE_EXECUTE_COMMAND_ID,
  PROFILE_DEFAULT_SET_EXECUTE_COMMAND_ID,
  PROFILE_DISABLE_EXECUTE_COMMAND_ID,
  PROFILE_DISABLE_POLICY_SET_EXECUTE_COMMAND_ID,
  PROFILE_ENABLE_EXECUTE_COMMAND_ID,
  PROFILE_GLOBAL_SWITCH_APPLY_EXECUTE_COMMAND_ID,
  PROFILE_GLOBAL_SWITCH_PLAN_EXECUTE_COMMAND_ID
} from '../types.ts'
import {
  handleMNetExecuteCommand,
  requireExecuteSessionPermission
} from './command-well-mnet-execute.ts'
import {
  bffIdempotencyKey,
  forwardCoreExecute,
  invalidExecuteBody,
  isDisplayOnlyCommandId,
  readApprovalBody,
  readLeafNodeIdBody,
  readNetworkProfileBreakGlassDisableBody,
  readNetworkProfileDefaultSetBody,
  readNetworkProfileDisablePolicySetBody,
  readNetworkProfileExecuteBody,
  readNetworkProfileGlobalSwitchApplyBody,
  readNetworkProfileGlobalSwitchPlanBody
} from './command-well-support.ts'
import { bearerTokenFromHeaders, bffError, passthroughCoreError } from './route-helpers.ts'
import { commandIdParamsSchema, genericCommandExecuteBodySchema } from './route-schemas.ts'

/**
 * createCommandWellExecuteRoutes 保留通用 CommandWell 执行路由与所有命令分支。
 */
export function createCommandWellExecuteRoutes({ cf, tf, cfRaw, mfRaw }: MUiBffRouteDeps) {
  return new Elysia().post(
    '/api/v0/commands/:commandId/execute',
    async ({ params, body, headers }) => {
      const commandId = params.commandId

      // 仅展示命令永远不可执行
      if (isDisplayOnlyCommandId(commandId)) {
        return bffError(400, 'command.display_only', 'display-only command cannot be executed')
      }

      const token = bearerTokenFromHeaders(headers)
      if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

      // 现有 noop 任务执行
      if (commandId === GENERIC_NOOP_COMMAND_ID) {
        const noopBody = readLeafNodeIdBody(body)
        if (!noopBody) {
          return invalidExecuteBody('leafNodeId is required')
        }
        const result = await tf('/api/v0/tasks', token, {
          method: 'POST',
          body: JSON.stringify({ nodeId: noopBody.leafNodeId, type: 'noop' })
        })
        if (!result.ok) return passthroughCoreError(result)
        return result.data
      }

      const mnetExecuteResponse = await handleMNetExecuteCommand({
        commandId,
        body,
        token,
        deps: { cf, mfRaw }
      })
      if (mnetExecuteResponse !== null) {
        return mnetExecuteResponse
      }

      // 审批批准：转发到 Core POST /api/v0/policy/approvals/:id/approve
      if (commandId === APPROVAL_APPROVE_EXECUTE_COMMAND_ID) {
        const approvalBody = readApprovalBody(body)
        if (!approvalBody) {
          return invalidExecuteBody('approvalId is required and reason must be a non-empty string')
        }
        const permissionCheck = await requireExecuteSessionPermission(cf, token, commandId)
        if (permissionCheck instanceof Response) return permissionCheck
        return forwardCoreExecute(
          cfRaw(
            `/api/v0/policy/approvals/${encodeURIComponent(approvalBody.approvalId)}/approve`,
            token,
            {
              method: 'POST',
              body: JSON.stringify(
                approvalBody.reason !== undefined ? { reason: approvalBody.reason } : {}
              )
            }
          )
        )
      }

      // 审批拒绝：转发到 Core POST /api/v0/policy/approvals/:id/reject
      if (commandId === APPROVAL_REJECT_EXECUTE_COMMAND_ID) {
        const approvalBody = readApprovalBody(body)
        if (!approvalBody) {
          return invalidExecuteBody('approvalId is required and reason must be a non-empty string')
        }
        const permissionCheck = await requireExecuteSessionPermission(cf, token, commandId)
        if (permissionCheck instanceof Response) return permissionCheck
        return forwardCoreExecute(
          cfRaw(
            `/api/v0/policy/approvals/${encodeURIComponent(approvalBody.approvalId)}/reject`,
            token,
            {
              method: 'POST',
              body: JSON.stringify(
                approvalBody.reason !== undefined ? { reason: approvalBody.reason } : {}
              )
            }
          )
        )
      }

      // Profile 启用：转发到 Core POST /api/v0/networks/:id/profile
      if (commandId === PROFILE_ENABLE_EXECUTE_COMMAND_ID) {
        const profileBody = readNetworkProfileExecuteBody(body)
        if (!profileBody)
          return invalidExecuteBody(
            'networkId and profileVersion are required and reason must be a non-empty string'
          )
        const permissionCheck = await requireExecuteSessionPermission(cf, token, commandId)
        if (permissionCheck instanceof Response) return permissionCheck
        // Core profile write route 要求 reason 必填；BFF 为无 reason 请求提供默认值
        const reason = profileBody.reason || 'profile enable from CommandWell'
        return forwardCoreExecute(
          cfRaw(`/api/v0/networks/${encodeURIComponent(profileBody.networkId)}/profile`, token, {
            method: 'POST',
            body: JSON.stringify({ profileVersion: profileBody.profileVersion, reason })
          })
        )
      }

      // Profile 停用：转发到 Core POST /api/v0/networks/:id/profile
      if (commandId === PROFILE_DISABLE_EXECUTE_COMMAND_ID) {
        const profileBody = readNetworkProfileExecuteBody(body)
        if (!profileBody)
          return invalidExecuteBody(
            'networkId and profileVersion are required and reason must be a non-empty string'
          )
        const permissionCheck = await requireExecuteSessionPermission(cf, token, commandId)
        if (permissionCheck instanceof Response) return permissionCheck
        const reason = profileBody.reason || 'profile disable from CommandWell'
        return forwardCoreExecute(
          cfRaw(`/api/v0/networks/${encodeURIComponent(profileBody.networkId)}/profile`, token, {
            method: 'POST',
            body: JSON.stringify({ profileVersion: profileBody.profileVersion, reason })
          })
        )
      }

      // 全局默认 Profile：只转发到 Core facade，BFF 不持有默认值状态。
      if (commandId === PROFILE_DEFAULT_SET_EXECUTE_COMMAND_ID) {
        const defaultBody = readNetworkProfileDefaultSetBody(body)
        if (!defaultBody) {
          return invalidExecuteBody(
            'profileVersion is required; reason/idempotencyKey must be non-empty strings when provided'
          )
        }
        const permissionCheck = await requireExecuteSessionPermission(cf, token, commandId)
        if (permissionCheck instanceof Response) return permissionCheck
        return forwardCoreExecute(
          cfRaw('/api/v0/networks/profile-defaults', token, {
            method: 'PUT',
            body: JSON.stringify({
              profileVersion: defaultBody.profileVersion,
              reason: defaultBody.reason || 'global default profile set from CommandWell',
              idempotencyKey: defaultBody.idempotencyKey ?? bffIdempotencyKey('profile-default-set')
            })
          })
        )
      }

      // 全局切换规划：计划本身仍是控制面迁移，不声明数据面变更。
      if (commandId === PROFILE_GLOBAL_SWITCH_PLAN_EXECUTE_COMMAND_ID) {
        const planBody = readNetworkProfileGlobalSwitchPlanBody(body)
        if (!planBody) {
          return invalidExecuteBody(
            'targetProfileVersion is required; batchSize must be >= 1; reason/idempotencyKey must be non-empty strings when provided'
          )
        }
        const permissionCheck = await requireExecuteSessionPermission(cf, token, commandId)
        if (permissionCheck instanceof Response) return permissionCheck
        const requestBody: {
          targetProfileVersion: string
          reason: string
          idempotencyKey: string
          batchSize?: number
        } = {
          targetProfileVersion: planBody.targetProfileVersion,
          reason: planBody.reason || 'global profile switch plan from CommandWell',
          idempotencyKey: planBody.idempotencyKey ?? bffIdempotencyKey('profile-switch-plan')
        }
        if (planBody.batchSize !== undefined) requestBody.batchSize = planBody.batchSize
        return forwardCoreExecute(
          cfRaw('/api/v0/networks/profile-switches/plan', token, {
            method: 'POST',
            body: JSON.stringify(requestBody)
          })
        )
      }

      // 全局切换应用：按 Core facade 的 operationId 执行下一批迁移。
      if (commandId === PROFILE_GLOBAL_SWITCH_APPLY_EXECUTE_COMMAND_ID) {
        const applyBody = readNetworkProfileGlobalSwitchApplyBody(body)
        if (!applyBody) return invalidExecuteBody('operationId is required')
        const permissionCheck = await requireExecuteSessionPermission(cf, token, commandId)
        if (permissionCheck instanceof Response) return permissionCheck
        return forwardCoreExecute(
          cfRaw(
            `/api/v0/networks/profile-switches/${encodeURIComponent(applyBody.operationId)}/apply`,
            token,
            {
              method: 'POST'
            }
          )
        )
      }

      // Disable policy 配置：只经 Core public facade，最终授权和审计由 Core/M-Net 下游负责。
      if (commandId === PROFILE_DISABLE_POLICY_SET_EXECUTE_COMMAND_ID) {
        const policyBody = readNetworkProfileDisablePolicySetBody(body)
        if (!policyBody) {
          return invalidExecuteBody(
            'requireApproval and emergencyBreakGlassEnabled are required booleans; reason/idempotencyKey must be non-empty strings when provided'
          )
        }
        const permissionCheck = await requireExecuteSessionPermission(cf, token, commandId)
        if (permissionCheck instanceof Response) return permissionCheck
        return forwardCoreExecute(
          cfRaw('/api/v0/networks/profile-disable-policy', token, {
            method: 'PUT',
            body: JSON.stringify({
              requireApproval: policyBody.requireApproval,
              emergencyBreakGlassEnabled: policyBody.emergencyBreakGlassEnabled,
              reason: policyBody.reason || 'disable policy update from CommandWell',
              idempotencyKey:
                policyBody.idempotencyKey ?? bffIdempotencyKey('profile-disable-policy')
            })
          })
        )
      }

      // Break-glass 禁用是 security-admin 恢复路径；BFF 不判断角色，只转发 Core envelope。
      if (commandId === PROFILE_BREAK_GLASS_DISABLE_EXECUTE_COMMAND_ID) {
        const breakGlassBody = readNetworkProfileBreakGlassDisableBody(body)
        if (!breakGlassBody) {
          return invalidExecuteBody(
            'networkId is required and emergencyReason must be a string when provided'
          )
        }
        const permissionCheck = await requireExecuteSessionPermission(cf, token, commandId)
        if (permissionCheck instanceof Response) return permissionCheck
        return forwardCoreExecute(
          cfRaw(
            `/api/v0/networks/${encodeURIComponent(breakGlassBody.networkId)}/profile/disable-break-glass`,
            token,
            {
              method: 'POST',
              body: JSON.stringify({ emergencyReason: breakGlassBody.emergencyReason ?? '' })
            }
          )
        )
      }

      return bffError(400, 'command.unknown', 'unknown command id')
    },
    {
      params: commandIdParamsSchema,
      body: genericCommandExecuteBodySchema,
      detail: { summary: 'Execute generic CommandWell command' }
    }
  )
}
