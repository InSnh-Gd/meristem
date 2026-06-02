import { describe, expect, it } from 'bun:test'
import { mintLocalToken } from '../../packages/auth/src/index.ts'
import { internalTokenHeaderName } from '../../packages/internal-http/src/index.ts'
import { extensionPermission, mExtensionApiRoutes, mExtensionEventSubjects, mExtensionManifestVersion, type ActorId, type Permission } from '../../packages/contracts/src/index.ts'
import { createMExtensionApp, type MExtensionDeps, type PolicyDecisionResult } from '../../services/m-extension/src/app.ts'
import { createInMemoryExtensionStore } from '../../services/m-extension/src/store.ts'

const jwtSecret = 'm-extension-test-secret'

const manifest = {
  id: 'extension-metadata-demo',
  manifestVersion: mExtensionManifestVersion,
  displayName: 'Metadata Demo',
  kind: 'metadata-only',
  owner: 'meristem',
  license: 'Apache-2.0',
  declaredCapabilities: ['metadata.registry'],
  requestedPermissions: [extensionPermission.read],
  riskClass: 'low',
  lifecycleStatus: 'active',
  controlPlaneOnly: true
} as const

type Captured = {
  audits: unknown[]
  timeline: string[]
  full: unknown[]
  events: string[]
}

async function token(actor: ActorId): Promise<string> {
  return mintLocalToken({ actor, secret: jwtSecret })
}

function headers(bearer: string): Record<string, string> {
  return { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }
}

function testDeps(captured: Captured, result: PolicyDecisionResult = 'allow'): MExtensionDeps {
  return {
    jwtSecret,
    store: createInMemoryExtensionStore(),
    policy: {
      async authorize(_actor: ActorId, _action: Permission, _resource: string) {
        return { result, id: crypto.randomUUID(), reasons: result === 'allow' ? ['permission_present'] : ['missing_permission'] }
      }
    },
    log: {
      async writeTimeline(summary) { captured.timeline.push(summary) },
      async writeFull(_level, message, _correlationId, payload) { captured.full.push({ message, payload }) },
      async writeAudit(actor, action, resource, resultValue, correlationId, payload) { captured.audits.push({ actor, action, resource, result: resultValue, correlationId, payload }) }
    },
    events: {
      async publish(subject) { captured.events.push(subject) }
    },
    readiness: async () => ({ ready: true })
  }
}

describe('M-Extension external REST routes', () => {
  it('registers, lists, shows, enables, and disables a system/default extension', async () => {
    const captured: Captured = { audits: [], timeline: [], full: [], events: [] }
    const app = createMExtensionApp(testDeps(captured))
    const adminToken = await token('admin')

    const registerResponse = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.register}`, {
      method: 'POST',
      headers: headers(adminToken),
      body: JSON.stringify({ manifest, reason: 'contract smoke' })
    }))
    expect(registerResponse.status).toBe(200)
    const registered = await registerResponse.json() as { definition: { id: string }; instance: { status: string }; policyDecisionId: string }
    expect(registered.definition.id).toBe('extension-metadata-demo')
    expect(registered.instance.status).toBe('disabled')

    const listResponse = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}`, { headers: headers(adminToken) }))
    expect(listResponse.status).toBe(200)
    const list = await listResponse.json() as { extensions: unknown[] }
    expect(list.extensions).toHaveLength(1)

    const showResponse = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}/extension-metadata-demo`, { headers: headers(adminToken) }))
    expect(showResponse.status).toBe(200)

    const enableResponse = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}/extension-metadata-demo/enable`, {
      method: 'POST',
      headers: headers(adminToken),
      body: JSON.stringify({ reason: 'enable smoke' })
    }))
    expect(enableResponse.status).toBe(200)
    const enabled = await enableResponse.json() as { instance: { status: string } }
    expect(enabled.instance.status).toBe('enabled')

    const disableResponse = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}/extension-metadata-demo/disable`, {
      method: 'POST',
      headers: headers(adminToken),
      body: JSON.stringify({ reason: 'disable smoke' })
    }))
    expect(disableResponse.status).toBe(200)
    const disabled = await disableResponse.json() as { instance: { status: string } }
    expect(disabled.instance.status).toBe('disabled')

    expect(captured.audits).toHaveLength(3)
    expect(captured.events).toEqual([mExtensionEventSubjects.definitionRegistered, mExtensionEventSubjects.instanceEnabled, mExtensionEventSubjects.instanceDisabled])
    expect(captured.timeline).toEqual(['registered extension extension-metadata-demo', 'enabled extension extension-metadata-demo', 'disabled extension extension-metadata-demo'])
  })

  it('fails closed on missing token and unsupported scope', async () => {
    const captured: Captured = { audits: [], timeline: [], full: [], events: [] }
    const app = createMExtensionApp(testDeps(captured))
    const missingToken = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}`))
    expect(missingToken.status).toBe(401)

    const adminToken = await token('admin')
    await app.handle(new Request(`http://localhost${mExtensionApiRoutes.register}`, {
      method: 'POST',
      headers: headers(adminToken),
      body: JSON.stringify({ manifest })
    }))
    const badScope = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}/extension-metadata-demo/enable`, {
      method: 'POST',
      headers: headers(adminToken),
      body: JSON.stringify({ scopeType: 'node', scopeId: 'node-1' })
    }))
    expect(badScope.status).toBe(409)
  })

  it('re-registering an enabled extension does not implicitly disable the existing instance', async () => {
    const captured: Captured = { audits: [], timeline: [], full: [], events: [] }
    const app = createMExtensionApp(testDeps(captured))
    const adminToken = await token('admin')

    await app.handle(new Request(`http://localhost${mExtensionApiRoutes.register}`, {
      method: 'POST', headers: headers(adminToken), body: JSON.stringify({ manifest })
    }))
    await app.handle(new Request(`http://localhost${mExtensionApiRoutes.collection}/extension-metadata-demo/enable`, {
      method: 'POST', headers: headers(adminToken), body: JSON.stringify({})
    }))
    const registeredAgain = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.register}`, {
      method: 'POST', headers: headers(adminToken), body: JSON.stringify({ manifest: { ...manifest, displayName: 'Renamed Demo' } })
    }))

    expect(registeredAgain.status).toBe(200)
    const body = await registeredAgain.json() as { instance: { status: string } }
    expect(body.instance.status).toBe('enabled')
  })

  it('reports internal readiness through the shared internal token boundary', async () => {
    const captured: Captured = { audits: [], timeline: [], full: [], events: [] }
    const app = createMExtensionApp(testDeps(captured))

    const unauthorized = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.ready}`))
    expect(unauthorized.status).toBe(401)

    process.env.MERISTEM_INTERNAL_TOKEN = 'm-extension-ready-token'
    const ready = await app.handle(new Request(`http://localhost${mExtensionApiRoutes.ready}`, { headers: { [internalTokenHeaderName]: 'm-extension-ready-token' } }))
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ ready: true })
  })
})
