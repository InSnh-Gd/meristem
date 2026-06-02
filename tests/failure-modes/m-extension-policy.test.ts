import { describe, expect, it } from 'bun:test'
import { mintLocalToken } from '../../packages/auth/src/index.ts'
import { extensionPermission, mExtensionApiRoutes, mExtensionEventSubjects, mExtensionManifestVersion, type ActorId, type Permission } from '../../packages/contracts/src/index.ts'
import { createMExtensionApp, type MExtensionDeps } from '../../services/m-extension/src/app.ts'
import { createInMemoryExtensionStore } from '../../services/m-extension/src/store.ts'

const manifest = {
  id: 'extension-denied-demo',
  manifestVersion: mExtensionManifestVersion,
  displayName: 'Denied Demo',
  kind: 'metadata-only',
  owner: 'meristem',
  license: 'Apache-2.0',
  declaredCapabilities: ['metadata.registry'],
  requestedPermissions: [extensionPermission.read],
  riskClass: 'medium',
  lifecycleStatus: 'active',
  controlPlaneOnly: true
}

function deniedDeps(fullLogs: unknown[]): MExtensionDeps {
  return {
    jwtSecret: 'm-extension-deny-secret',
    store: createInMemoryExtensionStore(),
    policy: {
      async authorize(_actor: ActorId, _action: Permission, _resource: string) {
        return { result: 'deny', id: 'decision-denied', reasons: ['missing_permission'] }
      }
    },
    log: {
      async writeTimeline() {},
      async writeFull(_level, message, _correlationId, payload) { fullLogs.push({ message, payload }) },
      async writeAudit() {}
    },
    events: { async publish() {} },
    readiness: async () => ({ ready: true })
  }
}

function allowDeps(fullLogs: unknown[] = [], audits: unknown[] = [], events: string[] = [], store = createInMemoryExtensionStore()): MExtensionDeps {
  return {
    jwtSecret: 'm-extension-allow-secret',
    store,
    policy: { async authorize() { return { result: 'allow', id: 'decision-allow', reasons: [] } } },
    log: {
      async writeTimeline() {},
      async writeFull(_level, message, _correlationId, payload) { fullLogs.push({ message, payload }) },
      async writeAudit(actor, action, resource, result, correlationId, payload) { audits.push({ actor, action, resource, result, correlationId, payload }) }
    },
    events: { async publish(subject) { events.push(subject) } },
    readiness: async () => ({ ready: true })
  }
}

async function register(app: ReturnType<typeof createMExtensionApp>, token: string, next: unknown = manifest) {
  return app.handle(new Request(`http://localhost${mExtensionApiRoutes.register}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ manifest: next })
  }))
}

function manifestWith(overrides: Record<string, unknown>): unknown {
  return { ...manifest, ...overrides }
}

describe('M-Extension failure modes', () => {
  it('policy denial fails closed before registration persistence', async () => {
    const fullLogs: unknown[] = []
    const app = createMExtensionApp(deniedDeps(fullLogs))
    const token = await mintLocalToken({ actor: 'operator', secret: 'm-extension-deny-secret' })

    const response = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.register}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ manifest })
    }))

    expect(response.status).toBe(403)
    expect(fullLogs.length).toBeGreaterThan(0)
    const list = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}`, { headers: { authorization: `Bearer ${token}` } }))
    expect(list.status).toBe(403)
  })

  it('manifest validation failure writes Full Log and rejects state mutation', async () => {
    const fullLogs: unknown[] = []
    const audits: unknown[] = []
    const events: string[] = []
    const store = createInMemoryExtensionStore()
    const app = createMExtensionApp({
      jwtSecret: 'm-extension-validation-secret',
      store,
      policy: { async authorize() { return { result: 'allow', id: 'decision-allow', reasons: [] } } },
      log: {
        async writeTimeline() {},
        async writeFull(_level, message, _correlationId, payload) { fullLogs.push({ message, payload }) },
        async writeAudit(actor, action, resource, result, correlationId, payload) { audits.push({ actor, action, resource, result, correlationId, payload }) }
      },
      events: { async publish(subject) { events.push(subject) } },
      readiness: async () => ({ ready: true })
    })
    const token = await mintLocalToken({ actor: 'admin', secret: 'm-extension-validation-secret' })

    const response = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.register}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: { ...manifest, riskClass: 'critical' } })
    }))

    expect(response.status).toBe(409)
    expect(fullLogs.length).toBe(1)
    expect(audits.length).toBe(1)
    expect(events).toEqual(['extension.definition.rejected.v0'])
    expect(await store.get('extension-denied-demo')).toBeNull()
  })

  it('manifest validation rejection normalizes invalid kind in rejected lifecycle payload', async () => {
    const events: Array<{ subject: string; payload: { kind: string } }> = []
    const app = createMExtensionApp({
      ...allowDeps(),
      events: { async publish(subject, _type, payload) { events.push({ subject, payload }) } }
    })
    const token = await mintLocalToken({ actor: 'admin', secret: 'm-extension-allow-secret' })

    const response = await register(app, token, manifestWith({ id: 'extension-invalid-kind', kind: 'script' }))

    expect(response.status).toBe(409)
    expect(events).toEqual([{ subject: mExtensionEventSubjects.definitionRejected, payload: expect.objectContaining({ kind: 'metadata-only' }) }])
  })

  it('policy denial writes Audit for denied write operations before returning 403', async () => {
    const fullLogs: unknown[] = []
    const audits: unknown[] = []
    const app = createMExtensionApp({
      ...deniedDeps(fullLogs),
      log: {
        async writeTimeline() {},
        async writeFull(_level, message, _correlationId, payload) { fullLogs.push({ message, payload }) },
        async writeAudit(actor, action, resource, result, correlationId, payload) { audits.push({ actor, action, resource, result, correlationId, payload }) }
      }
    })
    const token = await mintLocalToken({ actor: 'admin', secret: 'm-extension-deny-secret' })

    const response = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.register}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ manifest })
    }))

    expect(response.status).toBe(403)
    expect(audits.length).toBe(1)
  })

  it('policy denial audit failure returns stable 503 before denied write response', async () => {
    const app = createMExtensionApp({
      ...deniedDeps([]),
      log: {
        async writeTimeline() {},
        async writeFull() {},
        async writeAudit() { throw new Error('audit unavailable') }
      }
    })
    const token = await mintLocalToken({ actor: 'admin', secret: 'm-extension-deny-secret' })

    const response = await register(app, token)
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(503)
    expect(body.error.code).toBe('audit.unavailable')
  })

  it('high-risk rejection audit failure returns stable 503 before rejection response', async () => {
    const app = createMExtensionApp({
      ...allowDeps(),
      log: {
        async writeTimeline() {},
        async writeFull() {},
        async writeAudit() { throw new Error('audit unavailable') }
      }
    })
    const token = await mintLocalToken({ actor: 'admin', secret: 'm-extension-allow-secret' })

    const response = await register(app, token, manifestWith({ riskClass: 'critical' }))
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(503)
    expect(body.error.code).toBe('audit.unavailable')
  })

  it('enable and disable policy denial write Audit before returning 403', async () => {
    const store = createInMemoryExtensionStore()
    const setupApp = createMExtensionApp(allowDeps([], [], [], store))
    const allowToken = await mintLocalToken({ actor: 'admin', secret: 'm-extension-allow-secret' })
    expect((await register(setupApp, allowToken)).status).toBe(200)

    const audits: unknown[] = []
    const app = createMExtensionApp({
      ...deniedDeps([]),
      store,
      log: {
        async writeTimeline() {},
        async writeFull() {},
        async writeAudit(actor, action, resource, result, correlationId, payload) { audits.push({ actor, action, resource, result, correlationId, payload }) }
      }
    })
    const denyToken = await mintLocalToken({ actor: 'admin', secret: 'm-extension-deny-secret' })

    const enable = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}/${manifest.id}/enable`, {
      method: 'POST', headers: { authorization: `Bearer ${denyToken}`, 'content-type': 'application/json' }, body: JSON.stringify({})
    }))
    const disable = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}/${manifest.id}/disable`, {
      method: 'POST', headers: { authorization: `Bearer ${denyToken}`, 'content-type': 'application/json' }, body: JSON.stringify({})
    }))

    expect(enable.status).toBe(403)
    expect(disable.status).toBe(403)
    expect(audits).toHaveLength(2)
  })

  it('audit failure fails closed before register, enable, and disable mutations', async () => {
    const store = createInMemoryExtensionStore()
    const token = await mintLocalToken({ actor: 'admin', secret: 'm-extension-allow-secret' })
    const failingLog = { ...allowDeps().log, async writeAudit() { throw new Error('audit unavailable') } }

    const registerApp = createMExtensionApp({ ...allowDeps([], [], [], store), log: failingLog })
    const registerResponse = await register(registerApp, token, manifestWith({ id: 'extension-audit-register' }))
    expect(registerResponse.status).toBe(503)
    expect(await store.get('extension-audit-register')).toBeNull()

    const setupApp = createMExtensionApp(allowDeps([], [], [], store))
    expect((await register(setupApp, token, manifestWith({ id: 'extension-audit-control' }))).status).toBe(200)
    const controlApp = createMExtensionApp({ ...allowDeps([], [], [], store), log: failingLog })
    const enable = await controlApp.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}/extension-audit-control/enable`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({})
    }))
    const disable = await controlApp.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}/extension-audit-control/disable`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({})
    }))
    const persisted = await store.get('extension-audit-control')

    expect(enable.status).toBe(503)
    expect(disable.status).toBe(503)
    expect(persisted?.instance?.status).toBe('disabled')
  })

  it('event publication failure returns a stable 503 envelope and writes Full Log', async () => {
    const fullLogs: unknown[] = []
    const store = createInMemoryExtensionStore()
    const app = createMExtensionApp({
      jwtSecret: 'm-extension-event-secret',
      store,
      policy: { async authorize() { return { result: 'allow', id: 'decision-allow', reasons: [] } } },
      log: {
        async writeTimeline() {},
        async writeFull(_level, message, _correlationId, payload) { fullLogs.push({ message, payload }) },
        async writeAudit() {}
      },
      events: { async publish() { throw new Error('event bus unavailable') } },
      readiness: async () => ({ ready: true })
    })
    const token = await mintLocalToken({ actor: 'admin', secret: 'm-extension-event-secret' })

    const response = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.register}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: { ...manifest, id: 'extension-event-failure' } })
    }))

    expect(response.status).toBe(503)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('extension.event_publish_failed')
    expect(fullLogs.length).toBe(1)
  })

  it('enable and disable event publication failures emit failure lifecycle events', async () => {
    const store = createInMemoryExtensionStore()
    const events: string[] = []
    const setupApp = createMExtensionApp(allowDeps([], [], [], store))
    const token = await mintLocalToken({ actor: 'admin', secret: 'm-extension-allow-secret' })
    expect((await register(setupApp, token, manifestWith({ id: 'extension-event-control' }))).status).toBe(200)

    const app = createMExtensionApp({
      ...allowDeps([], [], [], store),
      events: { async publish(subject) { events.push(subject); if (subject === mExtensionEventSubjects.instanceEnabled || subject === mExtensionEventSubjects.instanceDisabled) throw new Error('event bus unavailable') } }
    })

    const enable = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}/extension-event-control/enable`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({})
    }))
    const disable = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}/extension-event-control/disable`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({})
    }))

    expect(enable.status).toBe(503)
    expect(disable.status).toBe(503)
    expect(events).toContain('extension.instance.enable_failed.v0')
    expect(events).toContain('extension.instance.disable_failed.v0')
  })

  it('store dependency failure returns stable 503 envelopes', async () => {
    const app = createMExtensionApp({
      ...allowDeps(),
      store: {
        async list() { throw new Error('postgres unavailable') },
        async get() { throw new Error('postgres unavailable') },
        async register() { throw new Error('postgres unavailable') },
        async enable() { throw new Error('postgres unavailable') },
        async disable() { throw new Error('postgres unavailable') },
        async transitions() { throw new Error('postgres unavailable') }
      }
    })
    const token = await mintLocalToken({ actor: 'admin', secret: 'm-extension-allow-secret' })

    const list = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}`, { headers: { authorization: `Bearer ${token}` } }))
    const show = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}/${manifest.id}`, { headers: { authorization: `Bearer ${token}` } }))
    const registerResponse = await register(app, token, manifestWith({ id: 'extension-store-down' }))

    expect(list.status).toBe(503)
    expect(show.status).toBe(503)
    expect(registerResponse.status).toBe(503)
  })
})
