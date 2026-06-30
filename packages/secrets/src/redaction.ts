import type {
  RedactedSecretRefFromSchema,
  SecretRefFromSchema
} from '../../contracts/src/schemas/secret-provider.ts'

/**
 * 任何日志、错误和跨边界返回都只能暴露 provider/keyPath/version，不允许泄露 metadata/value。
 */
export function redactSecretRef(ref: SecretRefFromSchema): RedactedSecretRefFromSchema {
  return {
    provider: ref.provider,
    keyPath: ref.keyPath,
    ...(ref.version === undefined ? {} : { version: ref.version })
  }
}
