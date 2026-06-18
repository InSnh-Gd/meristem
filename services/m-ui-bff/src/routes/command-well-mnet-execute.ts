import { SessionResponseSchema } from '../../../../packages/contracts/src/index.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import {
  EXECUTE_COMMAND_REQUIRED_PERMISSIONS,
  MNET_BREAK_GLASS_EXECUTE_COMMAND_ID,
  MNET_DEFAULTS_SET_EXECUTE_COMMAND_ID,
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
  bffIdempotencyKey,
  forwardCoreExecute,
  invalidExecuteBody
} from './command-well-support.ts'
import {
  readBreakGlassBody,
  readCredentialRevokeBody,
  readCredentialTargetBody,
  readDefaultsSetBody,
  readJoinTicketCreateBody,
  readMigrationDryRunBody,
  readMigrationOperationBody,
  readMigrationRollbackBody,
  readProfileToggleBody
} from './mnet-dataplane-support.ts'
import { bffError, decodeUpstreamData, passthroughCoreError } from './route-helpers.ts'

/** M-Net execute 命令集合。 */
const MNET_EXECUTE_COMMANDS = new Set([
  MNET_JOIN_TICKET_CREATE_EXECUTE_COMMAND_ID,
  MNET_NODE_CREDENTIAL_ISSUE_EXECUTE_COMMAND_ID,
  MNET_NODE_CREDENTIAL_ROTATE_EXECUTE_COMMAND_ID,
  MNET_NODE_CREDENTIAL_REVOKE_EXECUTE_COMMAND_ID,
  MNET_PROFILE_ENABLE_EXECUTE_COMMAND_ID,
  MNET_PROFILE_DISABLE_EXECUTE_COMMAND_ID,
  MNET_BREAK_GLASS_EXECUTE_COMMAND_ID,
  MNET_DEFAULTS_SET_EXECUTE_COMMAND_ID,
  MNET_MIGRATION_DRY_RUN_EXECUTE_COMMAND_ID,
  MNET_MIGRATION_APPLY_EXECUTE_COMMAND_ID,
  MNET_MIGRATION_RESUME_EXECUTE_COMMAND_ID,
  MNET_MIGRATION_ROLLBACK_EXECUTE_COMMAND_ID
])

/** 判断命令是否属于 M-Net 数据面执行集合。 */
export function isMNetExecuteCommand(
  commandId: string
): commandId is keyof typeof EXECUTE_COMMAND_REQUIRED_PERMISSIONS {
  return MNET_EXECUTE_COMMANDS.has(
    commandId as typeof MNET_EXECUTE_COMMANDS extends Set<infer T> ? T : never
  )
}

/** execute 路径先做最小会话权限预检，避免明显禁用态仍触发下游 mutation 请求。 */
export async function requireExecuteSessionPermission(
  cf: MUiBffRouteDeps['cf'],
  token: string,
  commandId: keyof typeof EXECUTE_COMMAND_REQUIRED_PERMISSIONS
) {
  const sessionRes = await cf('/api/v0/session', token)
  if (!sessionRes.ok) return passthroughCoreError(sessionRes)
  const session = decodeUpstreamData(
    SessionResponseSchema,
    sessionRes.data,
    'Core returned invalid session payload'
  )
  if (session instanceof Response) return session

  const requiredPermission = EXECUTE_COMMAND_REQUIRED_PERMISSIONS[commandId]
  if (!session.permissions.includes(requiredPermission)) {
    return bffError(403, 'policy.denied', `缺少权限：${requiredPermission}`)
  }

  return session
}

/** 处理所有 M-Net 数据面 CommandWell execute 分支。 */
export async function handleMNetExecuteCommand(input: {
  commandId: string
  body: unknown
  token: string
  deps: Pick<MUiBffRouteDeps, 'cf' | 'mfRaw'>
}) {
  const { commandId, body, token, deps } = input
  if (!isMNetExecuteCommand(commandId)) return null

  if (commandId === MNET_JOIN_TICKET_CREATE_EXECUTE_COMMAND_ID) {
    const joinTicketBody = readJoinTicketCreateBody(body)
    if (!joinTicketBody) {
      return invalidExecuteBody(
        'kind and name are required; capabilities must be string[] and expiresInSeconds must be >= 1 when provided'
      )
    }
    const permissionCheck = await requireExecuteSessionPermission(deps.cf, token, commandId)
    if (permissionCheck instanceof Response) return permissionCheck
    return forwardCoreExecute(
      deps.mfRaw('/api/v0/networks/network-join/join-tickets', token, {
        method: 'POST',
        body: JSON.stringify(joinTicketBody)
      })
    )
  }

  if (commandId === MNET_NODE_CREDENTIAL_ISSUE_EXECUTE_COMMAND_ID) {
    const target = readCredentialTargetBody(body)
    if (!target) return invalidExecuteBody('networkId and nodeId are required')
    const permissionCheck = await requireExecuteSessionPermission(deps.cf, token, commandId)
    if (permissionCheck instanceof Response) return permissionCheck
    return forwardCoreExecute(
      deps.mfRaw(
        `/api/v0/networks/${encodeURIComponent(target.networkId)}/nodes/${encodeURIComponent(target.nodeId)}/credentials`,
        token,
        {
          method: 'POST'
        }
      )
    )
  }

  if (commandId === MNET_NODE_CREDENTIAL_ROTATE_EXECUTE_COMMAND_ID) {
    const target = readCredentialTargetBody(body)
    if (!target) return invalidExecuteBody('networkId and nodeId are required')
    const permissionCheck = await requireExecuteSessionPermission(deps.cf, token, commandId)
    if (permissionCheck instanceof Response) return permissionCheck
    return forwardCoreExecute(
      deps.mfRaw(
        `/api/v0/networks/${encodeURIComponent(target.networkId)}/nodes/${encodeURIComponent(target.nodeId)}/credentials/rotate`,
        token,
        {
          method: 'POST'
        }
      )
    )
  }

  if (commandId === MNET_NODE_CREDENTIAL_REVOKE_EXECUTE_COMMAND_ID) {
    const target = readCredentialRevokeBody(body)
    if (!target) {
      return invalidExecuteBody(
        'networkId and nodeId are required; reason must be a non-empty string when provided'
      )
    }
    const permissionCheck = await requireExecuteSessionPermission(deps.cf, token, commandId)
    if (permissionCheck instanceof Response) return permissionCheck
    return forwardCoreExecute(
      deps.mfRaw(
        `/api/v0/networks/${encodeURIComponent(target.networkId)}/nodes/${encodeURIComponent(target.nodeId)}/credentials/revoke`,
        token,
        {
          method: 'POST',
          body: JSON.stringify(target.reason === undefined ? {} : { reason: target.reason })
        }
      )
    )
  }

  if (commandId === MNET_PROFILE_ENABLE_EXECUTE_COMMAND_ID) {
    const profileBody = readProfileToggleBody(body)
    if (!profileBody) {
      return invalidExecuteBody(
        'networkId and profileVersion are required; reason must be a non-empty string when provided'
      )
    }
    const permissionCheck = await requireExecuteSessionPermission(deps.cf, token, commandId)
    if (permissionCheck instanceof Response) return permissionCheck
    return forwardCoreExecute(
      deps.mfRaw(
        `/api/v0/networks/${encodeURIComponent(profileBody.networkId)}/profile/enable`,
        token,
        {
          method: 'POST',
          body: JSON.stringify(profileBody)
        }
      )
    )
  }

  if (commandId === MNET_PROFILE_DISABLE_EXECUTE_COMMAND_ID) {
    const profileBody = readProfileToggleBody(body)
    if (!profileBody) {
      return invalidExecuteBody(
        'networkId and profileVersion are required; reason must be a non-empty string when provided'
      )
    }
    const permissionCheck = await requireExecuteSessionPermission(deps.cf, token, commandId)
    if (permissionCheck instanceof Response) return permissionCheck
    return forwardCoreExecute(
      deps.mfRaw(
        `/api/v0/networks/${encodeURIComponent(profileBody.networkId)}/profile/disable`,
        token,
        {
          method: 'POST',
          body: JSON.stringify(profileBody)
        }
      )
    )
  }

  if (commandId === MNET_BREAK_GLASS_EXECUTE_COMMAND_ID) {
    const breakGlassBody = readBreakGlassBody(body)
    if (!breakGlassBody) {
      return invalidExecuteBody(
        'networkId and confirmation are required; emergencyReason must be a non-empty string when provided'
      )
    }
    const permissionCheck = await requireExecuteSessionPermission(deps.cf, token, commandId)
    if (permissionCheck instanceof Response) return permissionCheck
    return forwardCoreExecute(
      deps.mfRaw(
        `/api/v0/networks/${encodeURIComponent(breakGlassBody.networkId)}/break-glass`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({
            confirmation: breakGlassBody.confirmation,
            ...(breakGlassBody.emergencyReason === undefined
              ? {}
              : { emergencyReason: breakGlassBody.emergencyReason })
          })
        }
      )
    )
  }

  if (commandId === MNET_DEFAULTS_SET_EXECUTE_COMMAND_ID) {
    const defaultsBody = readDefaultsSetBody(body)
    if (!defaultsBody) {
      return invalidExecuteBody(
        'profileVersion is required; reason/idempotencyKey must be non-empty strings when provided'
      )
    }
    const permissionCheck = await requireExecuteSessionPermission(deps.cf, token, commandId)
    if (permissionCheck instanceof Response) return permissionCheck
    return forwardCoreExecute(
      deps.mfRaw('/api/v0/networks/profile-defaults', token, {
        method: 'PUT',
        body: JSON.stringify({
          profileVersion: defaultsBody.profileVersion,
          reason: defaultsBody.reason ?? 'm-ui-bff defaults update',
          idempotencyKey: defaultsBody.idempotencyKey ?? bffIdempotencyKey('mnet-defaults-set')
        })
      })
    )
  }

  if (commandId === MNET_MIGRATION_DRY_RUN_EXECUTE_COMMAND_ID) {
    const migrationBody = readMigrationDryRunBody(body)
    if (!migrationBody) {
      return invalidExecuteBody(
        'targetProfileVersion is required; batchSize must be >= 1; reason/idempotencyKey must be non-empty strings when provided'
      )
    }
    const permissionCheck = await requireExecuteSessionPermission(deps.cf, token, commandId)
    if (permissionCheck instanceof Response) return permissionCheck
    return forwardCoreExecute(
      deps.mfRaw('/api/v0/networks/profile-switches/plan', token, {
        method: 'POST',
        body: JSON.stringify({
          targetProfileVersion: migrationBody.targetProfileVersion,
          ...(migrationBody.batchSize === undefined ? {} : { batchSize: migrationBody.batchSize }),
          reason: migrationBody.reason ?? 'm-ui-bff migration dry-run',
          idempotencyKey: migrationBody.idempotencyKey ?? bffIdempotencyKey('mnet-migration-plan')
        })
      })
    )
  }

  if (commandId === MNET_MIGRATION_APPLY_EXECUTE_COMMAND_ID) {
    const operationBody = readMigrationOperationBody(body)
    if (!operationBody) return invalidExecuteBody('operationId is required')
    const permissionCheck = await requireExecuteSessionPermission(deps.cf, token, commandId)
    if (permissionCheck instanceof Response) return permissionCheck
    return forwardCoreExecute(
      deps.mfRaw(
        `/api/v0/networks/profile-switches/${encodeURIComponent(operationBody.operationId)}/apply`,
        token,
        {
          method: 'POST'
        }
      )
    )
  }

  if (commandId === MNET_MIGRATION_RESUME_EXECUTE_COMMAND_ID) {
    const operationBody = readMigrationOperationBody(body)
    if (!operationBody) return invalidExecuteBody('operationId is required')
    const permissionCheck = await requireExecuteSessionPermission(deps.cf, token, commandId)
    if (permissionCheck instanceof Response) return permissionCheck
    return forwardCoreExecute(
      deps.mfRaw(
        `/api/v0/networks/profile-switches/${encodeURIComponent(operationBody.operationId)}/resume`,
        token,
        {
          method: 'POST'
        }
      )
    )
  }

  const rollbackBody = readMigrationRollbackBody(body)
  if (!rollbackBody) {
    return invalidExecuteBody(
      'operationId is required; reason must be a non-empty string when provided'
    )
  }
  const permissionCheck = await requireExecuteSessionPermission(deps.cf, token, commandId)
  if (permissionCheck instanceof Response) return permissionCheck
  return forwardCoreExecute(
    deps.mfRaw(
      `/api/v0/networks/profile-switches/${encodeURIComponent(rollbackBody.operationId)}/rollback`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(
          rollbackBody.reason === undefined ? {} : { reason: rollbackBody.reason }
        )
      }
    )
  )
}
