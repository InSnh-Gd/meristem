import { describe, expect, it } from 'bun:test'
import {
  createApprovalClient,
  createPolicyAuthorizeClient
} from '../../services/m-net/src/external-client-factories.ts'
import {
  createEventPublisher,
  createLogWriters,
  createProfileEventsClient,
  createProfileLogClient
} from '../../services/m-net/src/event-log-factories.ts'

function makeFetcher(handler: () => Promise<Response>): typeof fetch {
  return Object.assign(handler, { preconnect: fetch.preconnect })
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init
  })
}

describe('M-Net extracted client factories', () => {
  it('approval client returns approval id on success and structured error on invalid success body', async () => {
    const successFetcher = makeFetcher(async () =>
      jsonResponse({ approval: { id: 'approval-1' } }, { status: 200 })
    )

    const client = createApprovalClient(successFetcher)
    await expect(
      client.create({
        policyDecisionId: 'policy-1',
        originService: 'm-net',
        operationId: 'op-1',
        requestedBy: 'actor-1',
        requiredAction: 'approve',
        quorumRequired: 1,
        expiresAt: '2026-06-19T00:00:00.000Z'
      })
    ).resolves.toEqual({ ok: true, value: { approvalId: 'approval-1' } })

    const invalidFetcher = makeFetcher(async () => jsonResponse({ ok: true }, { status: 200 }))

    await expect(
      createApprovalClient(invalidFetcher).create({
        policyDecisionId: 'policy-1',
        originService: 'm-net',
        operationId: 'op-1',
        requestedBy: 'actor-1',
        requiredAction: 'approve',
        quorumRequired: 1,
        expiresAt: '2026-06-19T00:00:00.000Z'
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'approval.create_failed', message: 'invalid approval response' }
    })
  })

  it('approval client preserves upstream error envelope and policy authorize fails closed', async () => {
    const failingFetcher = makeFetcher(async () =>
      jsonResponse(
        { error: { code: 'policy.denied', message: 'manual approval required' } },
        { status: 403 }
      )
    )

    await expect(
      createApprovalClient(failingFetcher).create({
        policyDecisionId: 'policy-1',
        originService: 'm-net',
        operationId: 'op-1',
        requestedBy: 'actor-1',
        requiredAction: 'approve',
        quorumRequired: 1,
        expiresAt: '2026-06-19T00:00:00.000Z'
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'policy.denied', message: 'manual approval required' }
    })

    const denyFetcher = makeFetcher(async () => jsonResponse({}, { status: 503 }))
    await expect(createPolicyAuthorizeClient(denyFetcher).authorize('actor', 'write', 'resource')).resolves.toEqual({
      result: 'deny',
      id: expect.any(String),
      reasons: ['policy service unavailable']
    })
  })

  it('event and log factory wrappers call internal clients and surface write failures', async () => {
    const calls: string[] = []

    const eventBus = {
      health: { get: async () => ({ data: { ok: true }, error: null, response: new Response() }) },
      ready: { get: async () => ({ data: { ready: true }, error: null, response: new Response() }) },
      internal: {
        v0: {
          publish: {
            post: async ({ subject }: { subject: string }) => {
              calls.push(`publish:${subject}`)
              return { error: null, data: { ok: true } }
            }
          }
        }
      }
    } as unknown as Parameters<typeof createEventPublisher>[0]

    const logService = {
      health: { get: async () => ({ data: { ok: true }, error: null, response: new Response() }) },
      ready: { get: async () => ({ data: { ready: true }, error: null, response: new Response() }) },
      internal: {
        v0: {
          timeline: {
            post: async ({ summary }: { summary: string }) => {
              calls.push(`timeline:${summary}`)
              return { error: null, data: { ok: true } }
            }
          },
          full: {
            post: async ({ message }: { message: string }) => {
              calls.push(`full:${message}`)
              return { error: null, data: { ok: true } }
            }
          },
          audit: {
            post: async ({ action }: { action: string }) => {
              calls.push(`audit:${action}`)
              return { error: null, data: { ok: true } }
            }
          }
        }
      }
    } as unknown as Parameters<typeof createLogWriters>[0]

    await createEventPublisher(eventBus)('subject.one', 'type.one', { ok: true }, 'corr-1')
    await createProfileEventsClient(eventBus).publish('subject.two', 'type.two', { ok: true }, 'corr-2')

    const writers = createLogWriters(logService)
    await writers.writeTimeline('timeline one', 'subject.one', 'corr-1')
    await writers.writeFull('info', 'full one', 'corr-1')
    await writers.writeAudit('resource-1', 'write', 'corr-1')

    const profileLog = createProfileLogClient(logService)
    await profileLog.writeTimeline('timeline two', 'subject.two', 'corr-2')
    await profileLog.writeFull('info', 'full two', 'corr-2')
    await profileLog.writeAudit('operator', 'delete', 'resource-2', 'deny', 'corr-2')

    expect(calls).toEqual([
      'publish:subject.one',
      'publish:subject.two',
      'timeline:timeline one',
      'full:full one',
      'audit:write',
      'timeline:timeline two',
      'full:full two',
      'audit:delete'
    ])

    const brokenEventBus = {
      health: { get: async () => ({ data: { ok: true }, error: null, response: new Response() }) },
      ready: { get: async () => ({ data: { ready: true }, error: null, response: new Response() }) },
      internal: { v0: { publish: { post: async () => ({ error: true, data: null }) } } }
    } as unknown as Parameters<typeof createEventPublisher>[0]
    await expect(
      createEventPublisher(brokenEventBus)('subject.fail', 'type.fail', {}, 'corr-3')
    ).rejects.toThrow('failed to publish subject.fail')
  })
})
