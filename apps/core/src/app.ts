import { Elysia, t } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { extractBearerToken } from '../../../packages/auth/src/index.ts'
import type {
  ActorId,
  AssignTaskRequest,
  Permission,
  RegisterNodeRequest
} from '../../../packages/contracts/src/index.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import { apiError, correlationIdFromHeader } from './errors.ts'
import type { StatusFn } from './errors.ts'
import type { CoreDeps } from './types.ts'

type AuthContext =
  | { ok: true; actor: ActorId; correlationId: string }
  | { ok: false; response: unknown }

async function requireActor(
  deps: CoreDeps,
  headers: Record<string, string | undefined>,
  status: StatusFn
): Promise<AuthContext> {
  const correlationId = correlationIdFromHeader(headers['x-correlation-id'])
  const token = extractBearerToken(headers.authorization)
  if (!token) {
    return { ok: false, response: apiError(status, 401, 'auth.missing_token', 'Bearer token is required', correlationId) }
  }

  const verified = await deps.auth.verify(token)
  if (!verified.ok) {
    const code = 'error' in verified ? verified.error.code : verified.code
    const message = 'error' in verified ? verified.error.message : verified.message
    return { ok: false, response: apiError(status, 401, code, message, correlationId) }
  }

  const actor = 'value' in verified ? verified.value.actor : verified.actor
  return { ok: true, actor, correlationId }
}

async function authorize(
  deps: CoreDeps,
  input: { actor: ActorId; action: Permission; resource: string; correlationId: string },
  status: StatusFn
) {
  const decision = await deps.policy.authorize(input)
  if (!decision.ok) {
    return {
      ok: false as const,
      response: apiError(status, 503, decision.error.code, decision.error.message, input.correlationId)
    }
  }

  if (decision.value.result === 'deny') {
    await deps.log.writeFull({
      level: 'warn',
      source: 'meristem-core',
      message: `permission denied: ${input.action}`,
      correlationId: input.correlationId,
      payload: { actor: input.actor, action: input.action, resource: input.resource, decisionId: decision.value.id }
    })

    return {
      ok: false as const,
      response: apiError(status, 403, 'policy.denied', 'permission denied', input.correlationId)
    }
  }

  return { ok: true as const, decision: decision.value }
}

function statusCodeForServiceError(code: string): number {
  switch (code) {
    case 'network.not_found':
    case 'node.not_found':
      return 404
    case 'network.conflict':
    case 'network.stem_required':
    case 'node.invalid_kind':
    case 'node.invalid_status':
      return 409
    case 'mnet.unavailable':
      return 503
    default:
      return 503
  }
}

export function createCoreApp(deps: CoreDeps) {
  return new Elysia()
    .use(
      openapi({
        documentation: {
          info: { title: 'Meristem Core API', version: 'v0' }
        }
      })
    )
    .get('/api/v0/health', () => ({
      ok: true as const,
      service: 'meristem-core' as const,
      version: deps.version,
      uptimeMs: Date.now() - deps.startedAt
    }))
    .get('/api/v0/ready', async () => {
      const dependencies = await deps.storage.readiness()
      return {
        ready: dependencies.postgres === 'ready' && dependencies.nats === 'ready',
        dependencies
      }
    })
    .get('/api/v0/status', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: 'core', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response

      const dependencies = await deps.storage.readiness()
      const counts = await deps.storage.counts()
      return {
        core: { id: 'meristem-core', version: deps.version, mode: 'normal' as const },
        dependencies,
        counts
      }
    })
    .post('/api/v0/services', async ({ body, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'service:register', resource: 'service-definition', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response

      const audit = await deps.log.writeAudit({
        actor: auth.actor,
        action: 'service:register',
        resource: 'service-definition',
        decisionId: permission.decision.id,
        result: permission.decision.result,
        correlationId: auth.correlationId
      })
      if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

      const service = await deps.storage.registerService(body)
      await deps.events.publish(
        'service.lifecycle.registered.v0',
        createEventEnvelope({
          type: 'service.lifecycle.registered',
          source: 'meristem-core',
          payload: service,
          correlationId: auth.correlationId
        })
      )
      return { service, policyDecisionId: permission.decision.id, correlationId: auth.correlationId }
    })
    .get('/api/v0/services', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: 'services', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      return { services: await deps.storage.listServices() }
    })
    // Network routes keep Core as the external contract boundary while M-Net owns
    // network state and membership rules behind NATS request/reply.
    .post(
      '/api/v0/networks',
      async ({ body, headers, status }) => {
        const auth = await requireActor(deps, headers, status)
        if (!auth.ok) return auth.response
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'network:create', resource: `network:${body.name}`, correlationId: auth.correlationId },
          status
        )
        if (!permission.ok) return permission.response

        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'network:create',
          resource: `network:${body.name}`,
          decisionId: permission.decision.id,
          result: permission.decision.result,
          correlationId: auth.correlationId
        })
        if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

        const created = await deps.mNet.createNetwork(body)
        if (!created.ok) {
          return apiError(
            status,
            statusCodeForServiceError(created.error.code),
            created.error.code,
            created.error.message,
            auth.correlationId
          )
        }

        await deps.events.publish(
          'mnet.network.created.v0',
          createEventEnvelope({
            type: 'mnet.network.created',
            source: 'meristem-core',
            payload: {
              networkId: created.value.id,
              name: created.value.name,
              profileVersion: created.value.profileVersion
            },
            correlationId: auth.correlationId
          })
        )
        await deps.log.writeTimeline({
          summary: `created network ${created.value.name}`,
          subject: created.value.id,
          correlationId: auth.correlationId
        })

        return { network: created.value, policyDecisionId: permission.decision.id, correlationId: auth.correlationId }
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          profileVersion: t.Optional(t.String({ minLength: 1 }))
        }),
        detail: { security: [{ bearerAuth: [] }], summary: 'Create a logical network' }
      }
    )
    .get('/api/v0/networks', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'network:read', resource: 'networks', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response

      const networks = await deps.mNet.listNetworks()
      if (!networks.ok) {
        return apiError(
          status,
          statusCodeForServiceError(networks.error.code),
          networks.error.code,
          networks.error.message,
          auth.correlationId
        )
      }
      return { networks: networks.value }
    })
    .post(
      '/api/v0/networks/:id/members',
      async ({ params, body, headers, status }) => {
        const auth = await requireActor(deps, headers, status)
        if (!auth.ok) return auth.response
        const permission = await authorize(
          deps,
          {
            actor: auth.actor,
            action: 'network:join',
            resource: `network:${params.id}:node:${body.nodeId}`,
            correlationId: auth.correlationId
          },
          status
        )
        if (!permission.ok) return permission.response

        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'network:join',
          resource: `network:${params.id}:node:${body.nodeId}`,
          decisionId: permission.decision.id,
          result: permission.decision.result,
          correlationId: auth.correlationId
        })
        if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

        const member = await deps.mNet.joinNetwork({ networkId: params.id, nodeId: body.nodeId })
        if (!member.ok) {
          return apiError(
            status,
            statusCodeForServiceError(member.error.code),
            member.error.code,
            member.error.message,
            auth.correlationId
          )
        }

        await deps.events.publish(
          'mnet.membership.joined.v0',
          createEventEnvelope({
            type: 'mnet.membership.joined',
            source: 'meristem-core',
            payload: {
              networkId: member.value.networkId,
              nodeId: member.value.nodeId,
              nodeKind: member.value.nodeKind,
              membershipMode: member.value.membershipMode
            },
            correlationId: auth.correlationId
          })
        )
        await deps.log.writeTimeline({
          summary: `joined node ${member.value.nodeId} to network ${member.value.networkId}`,
          subject: member.value.networkId,
          correlationId: auth.correlationId
        })

        return { member: member.value, policyDecisionId: permission.decision.id, correlationId: auth.correlationId }
      },
      {
        body: t.Object({
          nodeId: t.String({ minLength: 1 })
        }),
        params: t.Object({
          id: t.String({ minLength: 1 })
        }),
        detail: { security: [{ bearerAuth: [] }], summary: 'Join a node to a logical network' }
      }
    )
    .get('/api/v0/networks/:id/members', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'network:read', resource: `network:${params.id}`, correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response

      const members = await deps.mNet.listNetworkMembers(params.id)
      if (!members.ok) {
        return apiError(
          status,
          statusCodeForServiceError(members.error.code),
          members.error.code,
          members.error.message,
          auth.correlationId
        )
      }
      return { members: members.value }
    })
    .post(
      '/api/v0/nodes',
      async ({ body, headers, status }) => {
        const auth = await requireActor(deps, headers, status)
        if (!auth.ok) return auth.response

        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'node:register', resource: `node:${body.kind}:${body.name}`, correlationId: auth.correlationId },
          status
        )
        if (!permission.ok) return permission.response

        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'node:register',
          resource: `node:${body.kind}:${body.name}`,
          decisionId: permission.decision.id,
          result: permission.decision.result,
          correlationId: auth.correlationId
        })
        if (!audit.ok) {
          return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)
        }

        const node = await deps.storage.registerNode(body)
        await deps.events.publish(
          'node.registration.accepted.v0',
          createEventEnvelope({
            type: 'node.registration.accepted',
            source: 'meristem-core',
            payload: { nodeId: node.id, kind: node.kind },
            correlationId: auth.correlationId
          })
        )
        await deps.log.writeTimeline({
          summary: `registered ${node.kind} node ${node.name}`,
          subject: node.id,
          correlationId: auth.correlationId
        })

        return {
          node,
          policyDecisionId: permission.decision.id,
          correlationId: auth.correlationId
        }
      },
      {
        body: t.Object({
          kind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
          name: t.String({ minLength: 1 }),
          capabilities: t.Optional(t.Array(t.String()))
        }),
        detail: { security: [{ bearerAuth: [] }], summary: 'Register Stem or Leaf node' }
      }
    )
    .get('/api/v0/nodes', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: 'nodes', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      return { nodes: await deps.storage.listNodes() }
    })
    .get('/api/v0/nodes/:id', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: `node:${params.id}`, correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const node = await deps.storage.getNode(params.id)
      return node ? { node } : apiError(status, 404, 'node.not_found', 'node not found', auth.correlationId)
    })
    .post(
      '/api/v0/tasks',
      async ({ body, headers, status }) => {
        const auth = await requireActor(deps, headers, status)
        if (!auth.ok) return auth.response
        const permission = await authorize(
          deps,
          { actor: auth.actor, action: 'task:assign', resource: `node:${body.leafNodeId}`, correlationId: auth.correlationId },
          status
        )
        if (!permission.ok) return permission.response

        const audit = await deps.log.writeAudit({
          actor: auth.actor,
          action: 'task:assign',
          resource: `node:${body.leafNodeId}`,
          decisionId: permission.decision.id,
          result: permission.decision.result,
          correlationId: auth.correlationId
        })
        if (!audit.ok) return apiError(status, 503, audit.error.code, audit.error.message, auth.correlationId)

        const task = await deps.storage.assignTask(body)
        await deps.events.publish(
          'task.assignment.completed.v0',
          createEventEnvelope({
            type: 'task.assignment.completed',
            source: 'meristem-core',
            payload: { taskId: task.id, leafNodeId: task.leafNodeId, type: task.type },
            correlationId: auth.correlationId
          })
        )
        await deps.log.writeTimeline({
          summary: `completed noop task ${task.id}`,
          subject: task.id,
          correlationId: auth.correlationId
        })

        return { task, policyDecisionId: permission.decision.id, correlationId: auth.correlationId }
      },
      {
        body: t.Object({
          leafNodeId: t.String(),
          type: t.Literal('noop')
        })
      }
    )
    .get('/api/v0/tasks/:id', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: `task:${params.id}`, correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const task = await deps.storage.getTask(params.id)
      return task ? { task } : apiError(status, 404, 'task.not_found', 'task not found', auth.correlationId)
    })
    .get('/api/v0/logs/timeline', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'timeline:read', resource: 'timeline', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const entries = await deps.log.listTimeline()
      return entries.ok ? { entries: entries.value } : apiError(status, 503, entries.error.code, entries.error.message, auth.correlationId)
    })
    .get('/api/v0/logs/full', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'log:read-full', resource: 'full-log', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const entries = await deps.log.listFull()
      return entries.ok ? { entries: entries.value } : apiError(status, 503, entries.error.code, entries.error.message, auth.correlationId)
    })
    .get('/api/v0/audit', async ({ headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'audit:read', resource: 'audit', correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const entries = await deps.log.listAudit()
      return entries.ok ? { entries: entries.value } : apiError(status, 503, entries.error.code, entries.error.message, auth.correlationId)
    })
    .get('/api/v0/policy/decisions/:id', async ({ params, headers, status }) => {
      const auth = await requireActor(deps, headers, status)
      if (!auth.ok) return auth.response
      const permission = await authorize(
        deps,
        { actor: auth.actor, action: 'core:read', resource: `policy-decision:${params.id}`, correlationId: auth.correlationId },
        status
      )
      if (!permission.ok) return permission.response
      const decision = await deps.policy.getDecision(params.id)
      if (!decision.ok) return apiError(status, 503, decision.error.code, decision.error.message, auth.correlationId)
      return decision.value ? { decision: decision.value } : apiError(status, 404, 'policy_decision.not_found', 'policy decision not found', auth.correlationId)
    })
}

export type CoreApp = ReturnType<typeof createCoreApp>
