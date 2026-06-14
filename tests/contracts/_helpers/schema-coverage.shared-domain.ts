import type { EventContract, ResponseContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

export const sharedEventContracts: EventContract[] = [
  {
    subject: 'core.lifecycle.started.v0',
    schema: Contracts.CoreLifecycleStartedPayloadSchema,
    fixture: { nodeId: 'meristem-core', startedAt: '2026-06-04T10:00:00.000Z', version: '0.1.0' }
  },
  {
    subject: 'core.lifecycle.degraded.v0',
    schema: Contracts.CoreLifecycleDegradedPayloadSchema,
    fixture: {
      dependencies: {
        postgres: 'ready',
        nats: 'ready',
        'm-policy': 'ready',
        'm-log': 'ready',
        'm-eventbus': 'unavailable',
        'm-net': 'ready'
      }
    }
  },
  {
    subject: 'service.lifecycle.registered.v0',
    schema: Contracts.ServiceLifecycleRegisteredPayloadSchema,
    fixture: { id: 'm-log', version: '0.1.0', domain: 'm-log', kind: 'internal' }
  },
  {
    subject: 'service.lifecycle.reload.requested.v0',
    schema: Contracts.ServiceLifecycleReloadRequestedPayloadSchema,
    fixture: { serviceId: 'm-log', reason: 'test reload' }
  },
  {
    subject: 'node.registration.requested.v0',
    schema: Contracts.NodeRegistrationRequestedPayloadSchema,
    fixture: { kind: 'leaf', name: 'leaf-a', channel: 'join-ticket' }
  },
  {
    subject: 'node.join-ticket.created.v0',
    schema: Contracts.NodeJoinTicketCreatedPayloadSchema,
    fixture: {
      ticketId: 'ticket-1',
      kind: 'leaf',
      name: 'leaf-a',
      expiresAt: '2026-06-04T11:00:00.000Z'
    }
  },
  {
    subject: 'node.registration.accepted.v0',
    schema: Contracts.NodeRegistrationAcceptedPayloadSchema,
    fixture: { nodeId: 'node-1', kind: 'leaf', mode: 'simulated' }
  },
  {
    subject: 'node.status.changed.v0',
    schema: Contracts.NodeStatusChangedPayloadSchema,
    fixture: { nodeId: 'node-1', previousStatus: 'joining', nextStatus: 'healthy' }
  }
]

export const sharedResponseContracts: ResponseContract[] = [
  {
    route: 'GET /api/v0/health',
    schema: Contracts.HealthResponseSchema,
    fixture: { ok: true, service: 'meristem-core', version: '0.1.0', uptimeMs: 42 }
  },
  {
    route: 'GET /api/v0/session',
    schema: Contracts.SessionResponseSchema,
    fixture: { actor: 'operator', permissions: ['core:read', 'timeline:read'] }
  },
  {
    route: 'GET /api/v0/ready',
    schema: Contracts.ReadyResponseSchema,
    fixture: {
      ready: false,
      dependencies: {
        postgres: 'ready',
        nats: 'ready',
        'm-policy': 'ready',
        'm-log': 'ready',
        'm-eventbus': 'unavailable',
        'm-net': 'ready'
      }
    }
  },
  {
    route: 'GET /api/v0/status',
    schema: Contracts.StatusResponseSchema,
    fixture: {
      core: { id: 'meristem-core', version: '0.1.0', mode: 'normal' },
      dependencies: {
        postgres: 'ready',
        nats: 'ready',
        'm-policy': 'ready',
        'm-log': 'ready',
        'm-eventbus': 'ready',
        'm-net': 'ready'
      },
      counts: { services: 5, nodes: 2, tasks: 1 }
    }
  },
  {
    route: 'POST /api/v0/services',
    schema: Contracts.ServiceRegisterResponseSchema,
    fixture: {
      service: { id: 'm-log', version: '0.1.0', domain: 'm-log', kind: 'internal' },
      policyDecisionId: 'pd-1',
      correlationId: 'corr-1'
    }
  },
  {
    route: 'GET /api/v0/services',
    schema: Contracts.ServiceListResponseSchema,
    fixture: {
      services: [
        {
          id: 'm-log',
          version: '0.1.0',
          domain: 'm-log',
          kind: 'internal',
          lifecycle: { reloadable: true, rollbackable: false, degradable: true },
          runtime: { liveness: true, readiness: true, mode: 'normal' }
        }
      ]
    }
  },
  {
    route: 'POST /api/v0/services/:id/reload',
    schema: Contracts.ServiceReloadResponseSchema,
    fixture: {
      serviceId: 'm-log',
      accepted: true,
      reloadedAt: '2026-06-04T10:00:00.000Z',
      policyDecisionId: 'pd-2',
      correlationId: 'corr-2'
    }
  },
  {
    route: 'POST /api/v0/node-tickets',
    schema: Contracts.CreateNodeTicketResponseSchema,
    fixture: {
      ticketId: 'ticket-1',
      ticket: 'mjt_token',
      expiresAt: '2026-06-04T11:00:00.000Z',
      joinUrl: 'wss://localhost:8443/join/v0/session',
      policyDecisionId: 'pd-3',
      correlationId: 'corr-3'
    }
  },
  {
    route: 'POST /api/v0/nodes',
    schema: Contracts.RegisterNodeResponseSchema,
    fixture: {
      node: {
        id: 'node-1',
        kind: 'leaf',
        name: 'leaf-a',
        mode: 'simulated',
        status: 'healthy',
        reachability: 'reachable',
        capabilities: [],
        createdAt: '2026-06-04T10:00:00.000Z'
      },
      policyDecisionId: 'pd-4',
      correlationId: 'corr-4'
    }
  },
  {
    route: 'POST /api/v0/nodes/:id/credentials',
    schema: Contracts.IssueNodeCredentialResponseSchema,
    fixture: {
      nodeId: 'node-1',
      token: 'runtime-token',
      issuedAt: '2026-06-04T10:00:00.000Z',
      policyDecisionId: 'pd-5',
      correlationId: 'corr-5'
    }
  },
  {
    route: 'GET /api/v0/nodes',
    schema: Contracts.NodeListResponseSchema,
    fixture: {
      nodes: [
        {
          id: 'node-1',
          kind: 'stem',
          name: 'stem-a',
          mode: 'agent',
          status: 'healthy',
          reachability: 'reachable',
          capabilities: ['node.relay'],
          createdAt: '2026-06-04T10:00:00.000Z'
        }
      ]
    }
  },
  {
    route: 'GET /api/v0/nodes/:id',
    schema: Contracts.NodeDetailResponseSchema,
    fixture: {
      node: {
        id: 'node-1',
        kind: 'stem',
        name: 'stem-a',
        mode: 'agent',
        status: 'healthy',
        reachability: 'reachable',
        capabilities: ['node.relay'],
        createdAt: '2026-06-04T10:00:00.000Z'
      }
    }
  },
  {
    route: 'GET /api/v0/projection/health',
    schema: Contracts.ProjectionHealthResponseSchema,
    fixture: {
      indices: [
        {
          index: 'timeline',
          lagSeconds: 0,
          lastProjectedAt: '2026-06-04T10:00:00.000Z',
          pendingCount: 0,
          dlqCount: 0,
          status: 'healthy'
        }
      ]
    }
  },
  {
    route: 'POST /api/v0/projection/backfill',
    schema: Contracts.BackfillResultSchema,
    fixture: {
      jobId: 'job-1',
      processedCount: 12,
      errors: 0,
      lastCursor: { factId: 'fact-1', timestamp: '2026-06-04T10:00:00.000Z' },
      status: 'completed'
    }
  },
  {
    route: 'GET /api/v0/projection/dlq',
    schema: Contracts.ProjectionDLQResponseSchema,
    fixture: {
      records: [
        {
          id: 'dlq-1',
          jobId: 'job-1',
          factId: 'fact-1',
          index: 'timeline',
          error: 'decode failed',
          attemptedAt: ['2026-06-04T10:00:00.000Z'],
          retries: 1,
          createdAt: '2026-06-04T10:00:00.000Z'
        }
      ]
    }
  },
  {
    route: 'POST /api/v0/projection/dlq/:id/replay',
    schema: Contracts.ProjectionReplayResponseSchema,
    fixture: { replayed: true }
  },
  {
    route: 'POST /api/v0/projection/dlq/:id/skip',
    schema: Contracts.ProjectionSkipResponseSchema,
    fixture: { skipped: true }
  }
]
