import { describe, expect, it } from 'bun:test'
import { mExtensionManifestVersion } from '../../../packages/contracts/src/types/extension.ts'
import { validateExtensionManifest } from '../../../services/m-extension/src/manifest.ts'

const validManifest = () => ({
  id: 'audit-viewer',
  manifestVersion: mExtensionManifestVersion,
  displayName: 'Audit Viewer',
  description: 'Display audit records',
  kind: 'metadata-only',
  owner: 'platform',
  license: 'Apache-2.0',
  declaredCapabilities: ['audit.display'],
  requestedPermissions: ['extension:read', 'audit:read'],
  riskClass: 'low',
  lifecycleStatus: 'draft',
  controlPlaneOnly: true,
  createdAt: '2026-01-01T00:00:00.000Z'
})

describe('validateExtensionManifest', () => {
  it('accepts a valid metadata-only manifest and normalizes arrays', () => {
    const result = validateExtensionManifest(validManifest())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.manifest.id).toBe('audit-viewer')
    expect(result.manifest.manifestVersion).toBe(mExtensionManifestVersion)
    expect(result.manifest.controlPlaneOnly).toBe(true)
    expect(result.manifest.requestedPermissions).toEqual(['extension:read', 'audit:read'])
    expect(result.manifest.declaredCapabilities).toEqual(['audit.display'])
  })

  it('rejects non-object manifests', () => {
    const result = validateExtensionManifest(null)

    expect(result).toEqual({
      ok: false,
      code: 'extension.manifest.invalid',
      message: 'manifest must be an object'
    })
  })

  it('rejects unsupported risk classes before schema decoding', () => {
    const result = validateExtensionManifest({ ...validManifest(), riskClass: 'high' })

    expect(result).toEqual({
      ok: false,
      code: 'extension.manifest.risk_unsupported',
      message: 'high and critical risk manifests are not supported'
    })
  })

  it('rejects invalid extension identifiers', () => {
    const result = validateExtensionManifest({ ...validManifest(), id: 'Bad_Id' })

    expect(result).toEqual({
      ok: false,
      code: 'extension.manifest.invalid_id',
      message: 'manifest id must be a lowercase kebab-case identifier between 3 and 64 characters'
    })
  })

  it('rejects unsafe text fields', () => {
    const result = validateExtensionManifest({ ...validManifest(), owner: 'platform\nteam' })

    expect(result).toEqual({
      ok: false,
      code: 'extension.manifest.invalid_text',
      message: 'owner must be non-empty safe text'
    })
  })

  it('rejects non-string permission arrays', () => {
    const result = validateExtensionManifest({
      ...validManifest(),
      requestedPermissions: ['extension:read', 1]
    })

    expect(result).toEqual({
      ok: false,
      code: 'extension.manifest.invalid_permissions',
      message: 'requestedPermissions must be a string array'
    })
  })

  it('rejects unknown permissions', () => {
    const result = validateExtensionManifest({
      ...validManifest(),
      requestedPermissions: ['extension:read', 'extension:execute']
    })

    expect(result).toEqual({
      ok: false,
      code: 'extension.manifest.unknown_permission',
      message: 'unknown permission: extension:execute'
    })
  })

  it('rejects nested executable payload fields', () => {
    const result = validateExtensionManifest({
      ...validManifest(),
      metadata: { hooks: [{ command: 'run.sh' }] }
    })

    expect(result).toEqual({
      ok: false,
      code: 'extension.manifest.executable_payload',
      message: 'manifest must not contain command'
    })
  })

  it('rejects unsupported future fields', () => {
    const result = validateExtensionManifest({
      ...validManifest(),
      futureRuntime: 'wasi'
    })

    expect(result).toEqual({
      ok: false,
      code: 'extension.manifest.future_field_unsupported',
      message: 'futureRuntime is declared but not accepted in the current version'
    })
  })

  it('returns schema errors for structurally invalid manifests', () => {
    const result = validateExtensionManifest({
      ...validManifest(),
      controlPlaneOnly: false
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected invalid manifest')
    expect(result.code).toBe('extension.manifest.invalid')
    expect(result.message.length).toBeGreaterThan(0)
  })
})
