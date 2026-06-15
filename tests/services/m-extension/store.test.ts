import { describe, expect, it } from 'bun:test'
import {
  type MExtensionManifestV01,
  mExtensionManifestVersion
} from '../../../packages/contracts/src/types/extension.ts'
import { createInMemoryExtensionStore } from '../../../services/m-extension/src/store.ts'

const manifest = (): MExtensionManifestV01 => ({
  id: 'audit-viewer',
  manifestVersion: mExtensionManifestVersion,
  displayName: 'Audit Viewer',
  kind: 'metadata-only',
  owner: 'platform',
  license: 'Apache-2.0',
  declaredCapabilities: ['audit.display'],
  requestedPermissions: ['extension:read'],
  riskClass: 'low',
  lifecycleStatus: 'draft',
  controlPlaneOnly: true
})

describe('createInMemoryExtensionStore', () => {
  it('registers definitions with a disabled default instance', async () => {
    const store = createInMemoryExtensionStore()
    const result = await store.register({
      manifest: manifest(),
      actor: 'admin',
      policyDecisionId: 'decision-1',
      correlationId: 'correlation-1'
    })

    expect(result.definition.id).toBe('audit-viewer')
    expect(result.definition.status).toBe('registered')
    expect(result.definition.registeredBy).toBe('admin')
    expect(result.instance.extensionId).toBe('audit-viewer')
    expect(result.instance.scopeType).toBe('system')
    expect(result.instance.scopeId).toBe('default')
    expect(result.instance.status).toBe('disabled')
  })

  it('returns null for unknown definitions and transitions', async () => {
    const store = createInMemoryExtensionStore()

    await expect(store.get('missing-extension')).resolves.toBeNull()
    await expect(
      store.enable({
        extensionId: 'missing-extension',
        actor: 'admin',
        policyDecisionId: 'decision-1',
        correlationId: 'correlation-1'
      })
    ).resolves.toBeNull()
  })

  it('lists cloned definitions and instances', async () => {
    const store = createInMemoryExtensionStore()
    await store.register({
      manifest: manifest(),
      actor: 'admin',
      policyDecisionId: 'decision-1',
      correlationId: 'correlation-1'
    })

    const listed = await store.list()
    listed[0]?.definition.requestedPermissions.push('audit:read')
    listed[0]?.definition.manifest.declaredCapabilities.push('mutated')
    const current = await store.get('audit-viewer')

    expect(current?.definition.requestedPermissions).toEqual(['extension:read'])
    expect(current?.definition.manifest.declaredCapabilities).toEqual(['audit.display'])
  })

  it('enables and disables an instance with transition records', async () => {
    const store = createInMemoryExtensionStore()
    await store.register({
      manifest: manifest(),
      actor: 'admin',
      policyDecisionId: 'decision-register',
      correlationId: 'correlation-register'
    })

    const enabled = await store.enable({
      extensionId: 'audit-viewer',
      actor: 'operator',
      reason: 'needed for audit',
      policyDecisionId: 'decision-enable',
      correlationId: 'correlation-enable'
    })
    const disabled = await store.disable({
      extensionId: 'audit-viewer',
      actor: 'operator',
      reason: 'maintenance',
      policyDecisionId: 'decision-disable',
      correlationId: 'correlation-disable'
    })
    const transitions = await store.transitions()

    expect(enabled?.instance.status).toBe('enabled')
    expect(enabled?.instance.enabledBy).toBe('operator')
    expect(enabled?.instance.policyDecisionId).toBe('decision-enable')
    expect(disabled?.instance.status).toBe('disabled')
    expect(disabled?.instance.disabledBy).toBe('operator')
    expect(disabled?.instance.policyDecisionId).toBe('decision-disable')
    expect(transitions.map(transition => transition.toStatus)).toEqual([
      'registered',
      'enabled',
      'disabled'
    ])
    expect(transitions[1]).toMatchObject({
      extensionId: 'audit-viewer',
      fromStatus: 'disabled',
      toStatus: 'enabled',
      actor: 'operator',
      reason: 'needed for audit',
      policyDecisionId: 'decision-enable',
      correlationId: 'correlation-enable'
    })
  })

  it('preserves instance identity when a definition is re-registered', async () => {
    const store = createInMemoryExtensionStore()
    const first = await store.register({
      manifest: manifest(),
      actor: 'admin',
      policyDecisionId: 'decision-1',
      correlationId: 'correlation-1'
    })
    const second = await store.register({
      manifest: { ...manifest(), displayName: 'Audit Viewer Updated' },
      actor: 'security-admin',
      policyDecisionId: 'decision-2',
      correlationId: 'correlation-2'
    })

    expect(second.instance.id).toBe(first.instance.id)
    expect(second.definition.displayName).toBe('Audit Viewer Updated')
    expect(second.definition.registeredBy).toBe('security-admin')
    expect(second.definition.createdAt).toBe(first.definition.createdAt)
  })
})
