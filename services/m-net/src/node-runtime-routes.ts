import { Elysia, t } from 'elysia'
import { extractBearerToken } from '../../../packages/auth/src/index.ts'
import type {
  NetworkMapFromSchema,
  NodeAgentRuntimeDesiredSidecar,
} from '../../../packages/contracts/src/index.ts'
import type { MNetAppDeps } from './deps.ts'
import {
  externalMigrationRequiredApiError,
  isMigrationRequiredFailure
} from './migration-required-support.ts'
import { isProfileWorkflowFailure } from './profile-workflow-types.ts'
import { externalApiError } from './route-helpers.ts'
import {
  externalWriteErrorResponses,
  nodeIdParamsSchema,
  nodeKeyRegistrationBodySchema,
  nodeKeyRegistrationResponseSchema
} from './route-schemas.ts'

type NodeRuntimeContext = {
  nodeRuntime: NonNullable<MNetAppDeps['nodeRuntime']>
}

const dependencyStateSchema = t.Union([
  t.Literal('ready'),
  t.Literal('unavailable')
])

const healthStatusSchema = t.Union([
  t.Literal('unknown'),
  t.Literal('healthy'),
  t.Literal('degraded'),
  t.Literal('unhealthy')
])

const runtimeStateSchema = t.Union([
  t.Literal('install'),
  t.Literal('configure'),
  t.Literal('start'),
  t.Literal('drain'),
  t.Literal('stop')
])

const credentialStatusSchema = t.Union([
  t.Literal('missing'),
  t.Literal('pending'),
  t.Literal('ready'),
  t.Literal('expired'),
  t.Literal('rotation_required')
])

const degradedReasonCodeSchema = t.Union([
  t.Literal('expired_credentials'),
  t.Literal('missing_signal'),
  t.Literal('missing_relay'),
  t.Literal('missing_stun'),
  t.Literal('secret.missing'),
  t.Literal('secret.denied'),
  t.Literal('secret.provider_unavailable'),
  t.Literal('secret.unsupported_backend'),
  t.Literal('secret.stale'),
  t.Literal('sidecar_crash'),
  t.Literal('config_drift'),
  t.Literal('secret_resolution_failed'),
  t.Literal('break_glass_stop'),
  t.Literal('profile_disabled'),
  t.Literal('netbird.binary.invalid'),
  t.Literal('netbird.setup_key.missing'),
  t.Literal('netbird.start_failed'),
  t.Literal('netbird.process.not_running'),
  t.Literal('netbird.config_drift_repaired'),
  t.Literal('netbird.process_restarted'),
  t.Literal('netbird.probe.timeout'),
  t.Literal('netbird.probe.failed'),
  t.Literal('netbird.endpoint.unreachable')
])

const degradedReasonSchema = t.Object({
  code: degradedReasonCodeSchema,
  message: t.String(),
  detail: t.Optional(t.String())
})

const nodeRuntimeStatusBodySchema = t.Object({
  kind: t.Union([
    t.Literal('starting'),
    t.Literal('healthy'),
    t.Literal('degraded'),
    t.Literal('stopped'),
    t.Literal('failed')
  ]),
  desiredState: runtimeStateSchema,
  credentialStatus: credentialStatusSchema,
  healthStatus: healthStatusSchema,
  configHash: t.Optional(t.String()),
  sidecarConfigPath: t.Optional(t.String()),
  processRef: t.Optional(t.String()),
  processPid: t.Optional(t.Number()),
  processStartedAt: t.Optional(t.String()),
  lastProbeAt: t.Optional(t.String()),
  observedHealth: t.Optional(t.Union([t.Literal('healthy'), t.Literal('degraded'), t.Literal('unknown')])),
  degradedReason: t.Optional(degradedReasonSchema),
  correlationId: t.String(),
  observedAt: t.String(),
  dependencies: t.Object({
    signal: dependencyStateSchema,
    relay: dependencyStateSchema,
    stun: dependencyStateSchema
  }),
  degradedReasons: t.Array(degradedReasonSchema),
  credentialRef: t.Optional(
    t.Object({
      provider: t.String(),
      keyPath: t.String(),
      version: t.Optional(t.Number())
    })
  )
})

function toLatestNetworkMapResponse(input: {
  map: NetworkMapFromSchema
  sidecar: NodeAgentRuntimeDesiredSidecar
}) {
  const { map, sidecar } = input
  return {
    map: {
      profileVersion: map.profileVersion,
      networkId: map.networkId,
      members: map.members.map(member => ({
        nodeId: member.nodeId,
        tunnelIp: member.tunnelIp,
        publicKey: member.publicKey,
        ...(member.endpoint ? { endpoint: member.endpoint } : {})
      })),
      aclRules: map.aclRules.map(rule => ({
        ruleId: rule.ruleId,
        action: rule.action,
        sourceNodeId: rule.sourceNodeId,
        targetNodeId: rule.targetNodeId,
        protocol: rule.protocol
      })),
      ...(map.relayAssignment
        ? {
            relayAssignment: {
              relayType: map.relayAssignment.relayType,
              relayEndpoint: map.relayAssignment.relayEndpoint,
              nodeIds: [...map.relayAssignment.nodeIds]
            }
          }
        : {}),
      expiresAt: map.expiresAt,
      mapVersion: map.mapVersion,
      signatureMetadata: {
        algorithm: map.signatureMetadata.algorithm,
        keyId: map.signatureMetadata.keyId,
        publicKey: map.signatureMetadata.publicKey,
        value: map.signatureMetadata.value
      }
    },
    sidecar: {
      signalConfigRef: { configRef: sidecar.signalConfigRef.configRef },
      relayConfigRef: { configRef: sidecar.relayConfigRef.configRef },
      stunConfigRef: { configRef: sidecar.stunConfigRef.configRef },
      sidecarCredentialRef: {
        provider: sidecar.sidecarCredentialRef.provider,
        keyPath: sidecar.sidecarCredentialRef.keyPath,
        ...(typeof sidecar.sidecarCredentialRef.version === 'number'
          ? { version: sidecar.sidecarCredentialRef.version }
          : {}),
        ...(sidecar.sidecarCredentialRef.metadata
          ? { metadata: { ...sidecar.sidecarCredentialRef.metadata } }
          : {})
      },
      desiredState: sidecar.desiredState,
      credentialStatus: sidecar.credentialStatus,
      healthStatus: sidecar.healthStatus,
      ...(sidecar.managementUrl ? { managementUrl: sidecar.managementUrl } : {}),
      ...(sidecar.setupKey ? { setupKey: sidecar.setupKey } : {}),
      ...(sidecar.configHash ? { configHash: sidecar.configHash } : {})
    }
  }
}

async function requireAuthorizedNodeRuntimeContext(
  deps: Pick<MNetAppDeps, 'nodeRuntime'>,
  input: { headers: Record<string, string | undefined>; nodeId: string }
): Promise<NodeRuntimeContext | { status: 401 | 503; code: string; message: string }> {
  if (!deps.nodeRuntime) {
    return {
      status: 503,
      code: 'feature.unavailable',
      message: 'node runtime features are not available'
    }
  }

  const token = extractBearerToken(input.headers.authorization)
  if (!token) {
    return {
      status: 401,
      code: 'nodeagent.invalid_token',
      message: 'invalid or missing node runtime token'
    }
  }

  const authorized = await deps.nodeRuntime.authorize(input.nodeId, token)
  if (!authorized) {
    return {
      status: 401,
      code: 'nodeagent.invalid_token',
      message: 'invalid or missing node runtime token'
    }
  }

  return { nodeRuntime: deps.nodeRuntime }
}

export function createNodeRuntimeRoutes(deps: Pick<MNetAppDeps, 'nodeRuntime'>) {
  return new Elysia({ prefix: '/api/v0/node-runtime' })
    .get(
      '/nodes/:nodeId/network-map',
      async ({ params, headers, set }) => {
        const context = await requireAuthorizedNodeRuntimeContext(deps, {
          headers,
          nodeId: params.nodeId
        })
        if ('status' in context) {
          return externalApiError(set, context.status, context.code, context.message)
        }

        const result = await context.nodeRuntime.fetchLatestNetworkMap(params.nodeId)
        if ('kind' in result) {
          if (isProfileWorkflowFailure(result) && isMigrationRequiredFailure(result)) {
            return externalMigrationRequiredApiError(set, result.status, result.error.migration)
          }
          return externalApiError(set, result.status, result.error.code, result.error.message)
        }

        return toLatestNetworkMapResponse(result)
      },
      {
        params: nodeIdParamsSchema,
        response: {
          200: t.Any(),
          401: externalWriteErrorResponses[401],
          404: externalWriteErrorResponses[404],
          409: externalWriteErrorResponses[409],
          503: externalWriteErrorResponses[503]
        }
      }
    )
    .post(
      '/nodes/:nodeId/status',
      async ({ params, body, headers, set }) => {
        const context = await requireAuthorizedNodeRuntimeContext(deps, {
          headers,
          nodeId: params.nodeId
        })
        if ('status' in context) {
          return externalApiError(set, context.status, context.code, context.message)
        }
        if (!context.nodeRuntime.reportStatus) {
          return externalApiError(
            set,
            503,
            'feature.unavailable',
            'node runtime status reporting is not available'
          )
        }

        await context.nodeRuntime.reportStatus({
          nodeId: params.nodeId,
          runtimeStatus: body
        })
        return { accepted: true as const, nodeId: params.nodeId }
      },
      {
        params: nodeIdParamsSchema,
        body: nodeRuntimeStatusBodySchema,
        response: {
          200: t.Object({ accepted: t.Literal(true), nodeId: t.String() }),
          401: externalWriteErrorResponses[401],
          503: externalWriteErrorResponses[503]
        }
      }
    )
    .post(
      '/nodes/:nodeId/key',
      async ({ params, body, headers, set }) => {
        const context = await requireAuthorizedNodeRuntimeContext(deps, {
          headers,
          nodeId: params.nodeId
        })
        if ('status' in context) {
          return externalApiError(set, context.status, context.code, context.message)
        }

        const result = await context.nodeRuntime.registerNodePublicKey({
          nodeId: params.nodeId,
          keyId: body.keyId,
          publicKey: body.publicKey,
          createdAt: body.createdAt,
          ...(body.endpoint ? { endpoint: body.endpoint } : {})
        })
        if ('kind' in result) {
          if (isProfileWorkflowFailure(result) && isMigrationRequiredFailure(result)) {
            return externalMigrationRequiredApiError(set, result.status, result.error.migration)
          }
          return externalApiError(set, result.status, result.error.code, result.error.message)
        }

        return result
      },
      {
        params: nodeIdParamsSchema,
        body: nodeKeyRegistrationBodySchema,
        response: {
          200: nodeKeyRegistrationResponseSchema,
          401: externalWriteErrorResponses[401],
          404: externalWriteErrorResponses[404],
          409: externalWriteErrorResponses[409],
          503: externalWriteErrorResponses[503]
        }
      }
    )
}
