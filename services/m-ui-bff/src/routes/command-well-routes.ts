import { Elysia } from 'elysia'
import type { ActorId, MNode, Permission } from '../../../../packages/contracts/src/index.ts'
import {
  deriveNoopCommandEligibility,
  missingPermissionCommandEligibility,
  targetMissingCommandEligibility
} from '../command-well/eligibility.ts'
import type { MUiBffRouteDeps } from '../deps.ts'
import { GENERIC_NOOP_COMMAND_ID } from '../types.ts'
import { commandIdParamsSchema, leafNodeIdBodySchema } from './route-schemas.ts'
import {
  bearerTokenFromHeaders,
  bffError,
  passthroughCoreError,
  toGenericNoopEligibility
} from './route-helpers.ts'

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
        if (params.commandId !== GENERIC_NOOP_COMMAND_ID) {
          return bffError(400, 'command.unknown', 'unknown command id')
        }

        const token = bearerTokenFromHeaders(headers)
        if (!token) return bffError(401, 'auth.missing_token', 'Bearer token is required')

        const [sessionRes, nodeRes] = await Promise.all([
          cf('/api/v0/session', token),
          cf(`/api/v0/nodes/${body.leafNodeId}`, token)
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
      },
      {
        params: commandIdParamsSchema,
        body: leafNodeIdBodySchema,
        detail: { summary: 'Derive generic CommandWell eligibility' }
      }
    )
    .post(
      '/api/v0/commands/:commandId/execute',
      async ({ params, body, headers }) => {
        if (params.commandId !== GENERIC_NOOP_COMMAND_ID) {
          return bffError(400, 'command.unknown', 'unknown command id')
        }

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
        params: commandIdParamsSchema,
        body: leafNodeIdBodySchema,
        detail: { summary: 'Execute generic CommandWell command' }
      }
    )
}
