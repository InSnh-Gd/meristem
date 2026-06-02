import * as Schema from 'effect/Schema'
import { permissions, type Permission } from '../../../packages/contracts/src/literals.ts'
import { MExtensionManifestV01Schema } from '../../../packages/contracts/src/schemas/extension.ts'
import { mExtensionManifestVersion, type MExtensionManifestV01 } from '../../../packages/contracts/src/types/extension.ts'

export type ManifestValidationResult =
  | { ok: true; manifest: MExtensionManifestV01 }
  | { ok: false; code: string; message: string }

const knownPermissions = new Set<string>(permissions)
const forbiddenExecutableFields = ['script', 'command', 'wasmBinary', 'webhookToken', 'secretValue', 'config']
const unsupportedFutureFields = ['futureEntrypoint', 'futureRuntime', 'futureWebhookVerification', 'futureResourceLimits']
const extensionIdPattern = /^[a-z0-9][a-z0-9-]{2,63}$/
const safeTextPattern = /^[^\u0000-\u001f\u007f]{1,256}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringArrayField(record: Record<string, unknown>, field: string): string[] | null {
  const value = record[field]
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null
}

function containsForbiddenField(value: unknown): string | null {
  if (!isRecord(value)) return null
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenExecutableFields.includes(key)) return key
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = containsForbiddenField(item)
        if (found) return found
      }
    } else {
      const found = containsForbiddenField(nested)
      if (found) return found
    }
  }
  return null
}

function hasSafeText(value: unknown): value is string {
  return typeof value === 'string' && safeTextPattern.test(value)
}

/**
 * M-Extension manifest 校验是纯函数：先执行 Phase 15 风险和权限规则，再交给 Effect Schema 锁定版本化形状。
 */
export function validateExtensionManifest(value: unknown): ManifestValidationResult {
  if (!isRecord(value)) {
    return { ok: false, code: 'extension.manifest.invalid', message: 'manifest must be an object' }
  }

  const riskClass = value.riskClass
  if (riskClass === 'high' || riskClass === 'critical') {
    return { ok: false, code: 'extension.manifest.risk_unsupported', message: 'high and critical risk manifests are not supported in Phase 15' }
  }

  if (typeof value.id !== 'string' || !extensionIdPattern.test(value.id)) {
    return { ok: false, code: 'extension.manifest.invalid_id', message: 'manifest id must be a lowercase kebab-case identifier between 3 and 64 characters' }
  }

  for (const field of ['displayName', 'owner', 'license']) {
    if (!hasSafeText(value[field])) return { ok: false, code: 'extension.manifest.invalid_text', message: `${field} must be non-empty safe text` }
  }

  const requestedPermissions = stringArrayField(value, 'requestedPermissions')
  if (!requestedPermissions) {
    return { ok: false, code: 'extension.manifest.invalid_permissions', message: 'requestedPermissions must be a string array' }
  }
  const unknownPermission = requestedPermissions.find((permission) => !knownPermissions.has(permission))
  if (unknownPermission) {
    return { ok: false, code: 'extension.manifest.unknown_permission', message: `unknown permission: ${unknownPermission}` }
  }

  const forbiddenField = containsForbiddenField(value)
  if (forbiddenField) {
    return { ok: false, code: 'extension.manifest.executable_payload', message: `manifest must not contain ${forbiddenField}` }
  }

  const unsupportedFutureField = unsupportedFutureFields.find((field) => Reflect.has(value, field))
  if (unsupportedFutureField) {
    return { ok: false, code: 'extension.manifest.future_field_unsupported', message: `${unsupportedFutureField} is declared but not accepted in Phase 15` }
  }

  try {
    const manifest = Schema.decodeUnknownSync(MExtensionManifestV01Schema)(value)
    const normalizedManifest: MExtensionManifestV01 = {
      id: manifest.id,
      manifestVersion: manifest.manifestVersion,
      displayName: manifest.displayName,
      ...(manifest.description ? { description: manifest.description } : {}),
      kind: manifest.kind,
      owner: manifest.owner,
      license: manifest.license,
      declaredCapabilities: Array.from(manifest.declaredCapabilities),
      requestedPermissions: Array.from(manifest.requestedPermissions) as Permission[],
      ...(manifest.configSchemaRef ? { configSchemaRef: manifest.configSchemaRef } : {}),
      ...(manifest.requestedEvents ? { requestedEvents: Array.from(manifest.requestedEvents) } : {}),
      ...(manifest.emittedEvents ? { emittedEvents: Array.from(manifest.emittedEvents) } : {}),
      riskClass: manifest.riskClass,
      lifecycleStatus: manifest.lifecycleStatus,
      controlPlaneOnly: true,
      ...(manifest.futureEntrypoint ? { futureEntrypoint: manifest.futureEntrypoint } : {}),
      ...(manifest.futureRuntime ? { futureRuntime: manifest.futureRuntime } : {}),
      ...(manifest.futureWebhookVerification ? { futureWebhookVerification: manifest.futureWebhookVerification } : {}),
      ...(manifest.futureResourceLimits ? { futureResourceLimits: { ...manifest.futureResourceLimits } } : {}),
      ...(manifest.createdAt ? { createdAt: manifest.createdAt } : {}),
      ...(manifest.updatedAt ? { updatedAt: manifest.updatedAt } : {})
    }
    return {
      ok: true,
      manifest: normalizedManifest
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : `manifest does not match ${mExtensionManifestVersion}`
    return { ok: false, code: 'extension.manifest.invalid', message }
  }
}
