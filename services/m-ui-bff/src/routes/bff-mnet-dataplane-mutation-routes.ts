import { Elysia } from 'elysia'
import type { MUiBffRouteDeps } from '../deps.ts'
import {
  bffIdempotencyKey,
  forwardCoreExecute,
  invalidExecuteBody
} from './command-well-support.ts'
import {
  readBreakGlassBody,
  readCredentialRevokeBody,
  readDefaultsSetBody,
  readJoinTicketCreateBody,
  readMigrationDryRunBody,
  readMigrationOperationBody,
  readMigrationRollbackBody,
  readProfileToggleBody
} from './mnet-dataplane-support.ts'
import { requireBearerToken, requireObjectRecord, withStateSourceDetail } from './route-helpers.ts'
import {
  breakGlassBodySchema,
  credentialRevokeBodySchema,
  joinTicketCreateBodySchema,
  migrationDryRunBodySchema,
  migrationOperationBodySchema,
  migrationRollbackBodySchema,
  networkDefaultsBodySchema,
  networkIdParamsSchema,
  networkNodeParamsSchema,
  profileToggleBodySchema
} from './route-schemas.ts'

/**
 * createBffMNetDataplaneMutationRoutes 暴露 M-UI 直接调用的 BFF 数据面 mutation façade。
 */
export function createBffMNetDataplaneMutationRoutes({ mfRaw }: MUiBffRouteDeps) {
  return new Elysia()
    .post(
      '/api/v0/networks/:id/join-tickets',
      async ({ body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const joinTicketBody = readJoinTicketCreateBody(body)
        if (!joinTicketBody) {
          return invalidExecuteBody(
            'kind and name are required; capabilities must be string[] and expiresInSeconds must be >= 1 when provided'
          )
        }
        return forwardCoreExecute(
          mfRaw('/api/v0/networks/network-join/join-tickets', token, {
            method: 'POST',
            body: JSON.stringify(joinTicketBody)
          })
        )
      },
      {
        params: networkIdParamsSchema,
        body: joinTicketCreateBodySchema,
        detail: withStateSourceDetail('Create M-Net join ticket through BFF facade', [
          'authoritative'
        ])
      }
    )
    .post(
      '/api/v0/networks/:id/nodes/:nodeId/credentials',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        return forwardCoreExecute(
          mfRaw(
            `/api/v0/networks/${encodeURIComponent(params.id)}/nodes/${encodeURIComponent(params.nodeId)}/credentials`,
            token,
            {
              method: 'POST'
            }
          )
        )
      },
      {
        params: networkNodeParamsSchema,
        detail: withStateSourceDetail('Issue node credential through BFF facade', ['authoritative'])
      }
    )
    .post(
      '/api/v0/networks/:id/nodes/:nodeId/credentials/rotate',
      async ({ params, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        return forwardCoreExecute(
          mfRaw(
            `/api/v0/networks/${encodeURIComponent(params.id)}/nodes/${encodeURIComponent(params.nodeId)}/credentials/rotate`,
            token,
            {
              method: 'POST'
            }
          )
        )
      },
      {
        params: networkNodeParamsSchema,
        detail: withStateSourceDetail('Rotate node credential through BFF facade', [
          'authoritative'
        ])
      }
    )
    .post(
      '/api/v0/networks/:id/nodes/:nodeId/credentials/revoke',
      async ({ params, body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const record = requireObjectRecord(body, 'BFF received invalid revoke credential payload')
        if (record instanceof Response) return record
        const revokeBody = readCredentialRevokeBody({
          ...record,
          networkId: params.id,
          nodeId: params.nodeId
        })
        if (!revokeBody) {
          return invalidExecuteBody('reason must be a non-empty string when provided')
        }
        return forwardCoreExecute(
          mfRaw(
            `/api/v0/networks/${encodeURIComponent(params.id)}/nodes/${encodeURIComponent(params.nodeId)}/credentials/revoke`,
            token,
            {
              method: 'POST',
              body: JSON.stringify(
                revokeBody.reason === undefined ? {} : { reason: revokeBody.reason }
              )
            }
          )
        )
      },
      {
        params: networkNodeParamsSchema,
        body: credentialRevokeBodySchema,
        detail: withStateSourceDetail('Revoke node credential through BFF facade', [
          'authoritative'
        ])
      }
    )
    .post(
      '/api/v0/networks/:id/profile/enable',
      async ({ params, body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const record = requireObjectRecord(body, 'BFF received invalid enable profile payload')
        if (record instanceof Response) return record
        const profileBody = readProfileToggleBody({ ...record, networkId: params.id })
        if (!profileBody) {
          return invalidExecuteBody(
            'profileVersion is required; reason must be a non-empty string when provided'
          )
        }
        return forwardCoreExecute(
          mfRaw(`/api/v0/networks/${encodeURIComponent(params.id)}/profile/enable`, token, {
            method: 'POST',
            body: JSON.stringify(profileBody)
          })
        )
      },
      {
        params: networkIdParamsSchema,
        body: profileToggleBodySchema,
        detail: withStateSourceDetail('Enable M-Net profile through BFF facade', ['authoritative'])
      }
    )
    .post(
      '/api/v0/networks/:id/profile/disable',
      async ({ params, body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const record = requireObjectRecord(body, 'BFF received invalid disable profile payload')
        if (record instanceof Response) return record
        const profileBody = readProfileToggleBody({ ...record, networkId: params.id })
        if (!profileBody) {
          return invalidExecuteBody(
            'profileVersion is required; reason must be a non-empty string when provided'
          )
        }
        return forwardCoreExecute(
          mfRaw(`/api/v0/networks/${encodeURIComponent(params.id)}/profile/disable`, token, {
            method: 'POST',
            body: JSON.stringify(profileBody)
          })
        )
      },
      {
        params: networkIdParamsSchema,
        body: profileToggleBodySchema,
        detail: withStateSourceDetail('Disable M-Net profile through BFF facade', ['authoritative'])
      }
    )
    .post(
      '/api/v0/networks/:id/break-glass',
      async ({ params, body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const record = requireObjectRecord(body, 'BFF received invalid break-glass payload')
        if (record instanceof Response) return record
        const breakGlassBody = readBreakGlassBody({ ...record, networkId: params.id })
        if (!breakGlassBody) {
          return invalidExecuteBody(
            'confirmation is required; emergencyReason must be a non-empty string when provided'
          )
        }
        return forwardCoreExecute(
          mfRaw(`/api/v0/networks/${encodeURIComponent(params.id)}/break-glass`, token, {
            method: 'POST',
            body: JSON.stringify({
              confirmation: breakGlassBody.confirmation,
              ...(breakGlassBody.emergencyReason === undefined
                ? {}
                : { emergencyReason: breakGlassBody.emergencyReason })
            })
          })
        )
      },
      {
        params: networkIdParamsSchema,
        body: breakGlassBodySchema,
        detail: withStateSourceDetail('Execute break-glass through BFF facade', ['policy', 'audit'])
      }
    )
    .put(
      '/api/v0/networks/defaults',
      async ({ body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const defaultsBody = readDefaultsSetBody(body)
        if (!defaultsBody) {
          return invalidExecuteBody(
            'profileVersion is required; reason/idempotencyKey must be non-empty strings when provided'
          )
        }
        return forwardCoreExecute(
          mfRaw('/api/v0/networks/profile-defaults', token, {
            method: 'PUT',
            body: JSON.stringify({
              profileVersion: defaultsBody.profileVersion,
              reason: defaultsBody.reason ?? 'm-ui-bff defaults update',
              idempotencyKey: defaultsBody.idempotencyKey ?? bffIdempotencyKey('mnet-defaults-set')
            })
          })
        )
      },
      {
        body: networkDefaultsBodySchema,
        detail: withStateSourceDetail('Update M-Net global defaults through BFF facade', [
          'authoritative'
        ])
      }
    )
    .post(
      '/api/v0/networks/migration/dry-run',
      async ({ body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const migrationBody = readMigrationDryRunBody(body)
        if (!migrationBody) {
          return invalidExecuteBody(
            'targetProfileVersion is required; batchSize must be >= 1; reason/idempotencyKey must be non-empty strings when provided'
          )
        }
        return forwardCoreExecute(
          mfRaw('/api/v0/networks/profile-switches/plan', token, {
            method: 'POST',
            body: JSON.stringify({
              targetProfileVersion: migrationBody.targetProfileVersion,
              ...(migrationBody.batchSize === undefined
                ? {}
                : { batchSize: migrationBody.batchSize }),
              reason: migrationBody.reason ?? 'm-ui-bff migration dry-run',
              idempotencyKey:
                migrationBody.idempotencyKey ?? bffIdempotencyKey('mnet-migration-plan')
            })
          })
        )
      },
      {
        body: migrationDryRunBodySchema,
        detail: withStateSourceDetail('Plan fleet migration through BFF facade', ['authoritative'])
      }
    )
    .post(
      '/api/v0/networks/migration/apply',
      async ({ body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const operationBody = readMigrationOperationBody(body)
        if (!operationBody) return invalidExecuteBody('operationId is required')
        return forwardCoreExecute(
          mfRaw(
            `/api/v0/networks/profile-switches/${encodeURIComponent(operationBody.operationId)}/apply`,
            token,
            {
              method: 'POST'
            }
          )
        )
      },
      {
        body: migrationOperationBodySchema,
        detail: withStateSourceDetail('Apply fleet migration through BFF facade', ['authoritative'])
      }
    )
    .post(
      '/api/v0/networks/migration/resume',
      async ({ body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const operationBody = readMigrationOperationBody(body)
        if (!operationBody) return invalidExecuteBody('operationId is required')
        return forwardCoreExecute(
          mfRaw(
            `/api/v0/networks/profile-switches/${encodeURIComponent(operationBody.operationId)}/resume`,
            token,
            {
              method: 'POST'
            }
          )
        )
      },
      {
        body: migrationOperationBodySchema,
        detail: withStateSourceDetail('Resume fleet migration through BFF facade', [
          'authoritative'
        ])
      }
    )
    .post(
      '/api/v0/networks/migration/rollback',
      async ({ body, headers }) => {
        const token = requireBearerToken(headers)
        if (token instanceof Response) return token
        const rollbackBody = readMigrationRollbackBody(body)
        if (!rollbackBody) {
          return invalidExecuteBody(
            'operationId is required; reason must be a non-empty string when provided'
          )
        }
        return forwardCoreExecute(
          mfRaw(
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
      },
      {
        body: migrationRollbackBodySchema,
        detail: withStateSourceDetail('Rollback fleet migration through BFF facade', [
          'authoritative'
        ])
      }
    )
}
