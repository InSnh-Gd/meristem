import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  extensionPermission,
  extensionPermissions,
  permissions
} from '../../packages/contracts/src/literals.ts'
import {
  MExtensionEventSubjectSchema,
  MExtensionLifecyclePayloadSchema,
  MExtensionManifestV01Schema
} from '../../packages/contracts/src/schemas/extension.ts'
import {
  mExtensionEventSubjects,
  mExtensionManifestVersion,
  mExtensionScope
} from '../../packages/contracts/src/types/extension.ts'
import { validateExtensionManifest } from '../../services/m-extension/src/manifest.ts'

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

describe('M-Extension manifest contracts', () => {
  it('decodes and encodes MExtensionManifestV01', () => {
    const decoded = Schema.decodeUnknownSync(MExtensionManifestV01Schema)(manifest)
    expect(decoded.manifestVersion).toBe(mExtensionManifestVersion)
    expect(Schema.encodeSync(MExtensionManifestV01Schema)(decoded)).toEqual(manifest)
  })

  it('rejects unknown permissions and high risk manifests before registration', () => {
    const unknownPermission = validateExtensionManifest({
      ...manifest,
      requestedPermissions: ['dynamic:grant']
    })
    expect(unknownPermission.ok).toBe(false)
    if (!unknownPermission.ok)
      expect(unknownPermission.code).toBe('extension.manifest.unknown_permission')

    const highRisk = validateExtensionManifest({ ...manifest, riskClass: 'high' })
    expect(highRisk.ok).toBe(false)
    if (!highRisk.ok) expect(highRisk.code).toBe('extension.manifest.risk_unsupported')
  })

  it('rejects unsafe manifest identifiers and nested executable or secret payloads', () => {
    const invalidId = validateExtensionManifest({ ...manifest, id: 'bad/id' })
    expect(invalidId.ok).toBe(false)
    if (!invalidId.ok) expect(invalidId.code).toBe('extension.manifest.invalid_id')

    const nestedSecret = validateExtensionManifest({
      ...manifest,
      futureResourceLimits: { nested: { webhookToken: 'secret' } }
    })
    expect(nestedSecret.ok).toBe(false)
    if (!nestedSecret.ok) expect(nestedSecret.code).toBe('extension.manifest.executable_payload')

    const futureEntrypoint = validateExtensionManifest({
      ...manifest,
      futureEntrypoint: 'https://example.invalid/hook'
    })
    expect(futureEntrypoint.ok).toBe(false)
    if (!futureEntrypoint.ok)
      expect(futureEntrypoint.code).toBe('extension.manifest.future_field_unsupported')
  })

  it('exports M-Extension permissions as fixed literals', () => {
    expect(extensionPermissions).toEqual([
      extensionPermission.read,
      extensionPermission.register,
      extensionPermission.enable,
      extensionPermission.disable
    ])
    for (const permission of extensionPermissions) expect(permissions).toContain(permission)
  })

  it('validates lifecycle event subjects and payloads', () => {
    expect(
      Schema.decodeUnknownSync(MExtensionEventSubjectSchema)(
        mExtensionEventSubjects.instanceEnabled
      )
    ).toBe(mExtensionEventSubjects.instanceEnabled)
    const payload = Schema.decodeUnknownSync(MExtensionLifecyclePayloadSchema)({
      extensionId: 'extension-metadata-demo',
      manifestVersion: mExtensionManifestVersion,
      kind: 'metadata-only',
      actor: 'admin',
      decisionId: 'decision-extension-1',
      scopeType: mExtensionScope.type,
      scopeId: mExtensionScope.id,
      correlationId: 'corr-extension-1'
    })
    expect(payload.scopeId).toBe(mExtensionScope.id)
  })
})
