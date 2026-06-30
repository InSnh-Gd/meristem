import * as Schema from 'effect/Schema'

export const SecretRefMetadataSchema = Schema.Record({ key: Schema.String, value: Schema.String })
export type SecretRefMetadataFromSchema = typeof SecretRefMetadataSchema.Type

/**
 * 运行时 SecretRef 只暴露 provider/keyPath/version/metadata，禁止在契约层携带明文值。
 */
export const SecretRefSchema = Schema.Struct({
  provider: Schema.String,
  keyPath: Schema.String,
  version: Schema.optional(Schema.Number),
  metadata: Schema.optional(SecretRefMetadataSchema)
})
export type SecretRefFromSchema = typeof SecretRefSchema.Type

/**
 * Redaction 输出只允许保留 provider/keyPath/version，metadata 由调用方自行决定是否保留。
 */
export const RedactedSecretRefSchema = Schema.Struct({
  provider: Schema.String,
  keyPath: Schema.String,
  version: Schema.optional(Schema.Number)
})
export type RedactedSecretRefFromSchema = typeof RedactedSecretRefSchema.Type

export const SecretListPrefixSchema = Schema.Struct({
  provider: Schema.String,
  keyPath: Schema.String
})
export type SecretListPrefixFromSchema = typeof SecretListPrefixSchema.Type

export const SecretProviderBackendSchema = Schema.Literal('local-dev-env', 'vault-kv-v2')
export type SecretProviderBackendFromSchema = typeof SecretProviderBackendSchema.Type

export const SecretCachePolicySchema = Schema.Struct({
  freshTtlMs: Schema.Number,
  staleTtlMs: Schema.Number
})
export type SecretCachePolicyFromSchema = typeof SecretCachePolicySchema.Type

export const LocalDevEnvSecretProviderConfigSchema = Schema.Struct({
  backend: Schema.Literal('local-dev-env'),
  envMappings: Schema.Record({ key: Schema.String, value: Schema.String })
})
export type LocalDevEnvSecretProviderConfigFromSchema =
  typeof LocalDevEnvSecretProviderConfigSchema.Type

export const VaultKvV2SecretProviderConfigSchema = Schema.Struct({
  backend: Schema.Literal('vault-kv-v2'),
  address: Schema.String,
  mountPath: Schema.String,
  authMethodRef: Schema.String
})
export type VaultKvV2SecretProviderConfigFromSchema =
  typeof VaultKvV2SecretProviderConfigSchema.Type

export const SecretProviderConfigSchema = Schema.Union(
  LocalDevEnvSecretProviderConfigSchema,
  VaultKvV2SecretProviderConfigSchema
)
export type SecretProviderConfigFromSchema = typeof SecretProviderConfigSchema.Type

export const NamedSecretProviderConfigSchema = Schema.Struct({
  name: Schema.String,
  config: SecretProviderConfigSchema,
  cache: Schema.optional(SecretCachePolicySchema)
})
export type NamedSecretProviderConfigFromSchema = typeof NamedSecretProviderConfigSchema.Type

export const OidcSecretBindingsSchema = Schema.Struct({
  clientSecretRef: Schema.optional(SecretRefSchema),
  jwksRef: Schema.optional(SecretRefSchema)
})
export type OidcSecretBindingsFromSchema = typeof OidcSecretBindingsSchema.Type

export const NetBirdInfrastructureSecretBindingsSchema = Schema.Struct({
  signalCredentialRef: Schema.optional(SecretRefSchema),
  relayCredentialRef: Schema.optional(SecretRefSchema),
  stunCredentialRef: Schema.optional(SecretRefSchema)
})
export type NetBirdInfrastructureSecretBindingsFromSchema =
  typeof NetBirdInfrastructureSecretBindingsSchema.Type

export const SidecarSecretBindingsSchema = Schema.Struct({
  authTokenRef: Schema.optional(SecretRefSchema),
  configSecretRef: Schema.optional(SecretRefSchema)
})
export type SidecarSecretBindingsFromSchema = typeof SidecarSecretBindingsSchema.Type

export const DeploymentSecretEnvBindingSchema = Schema.Struct({
  envVar: Schema.String,
  ref: SecretRefSchema
})
export type DeploymentSecretEnvBindingFromSchema = typeof DeploymentSecretEnvBindingSchema.Type

export const DeploymentSecretBindingsSchema = Schema.Array(DeploymentSecretEnvBindingSchema)
export type DeploymentSecretBindingsFromSchema = typeof DeploymentSecretBindingsSchema.Type

export const SecretProviderUnavailableFailureSchema = Schema.Struct({
  code: Schema.Literal('provider_unavailable'),
  provider: Schema.String,
  ref: RedactedSecretRefSchema,
  message: Schema.String
})
export type SecretProviderUnavailableFailureFromSchema =
  typeof SecretProviderUnavailableFailureSchema.Type

export const SecretMissingFailureSchema = Schema.Struct({
  code: Schema.Literal('secret_missing'),
  provider: Schema.String,
  ref: RedactedSecretRefSchema,
  message: Schema.String
})
export type SecretMissingFailureFromSchema = typeof SecretMissingFailureSchema.Type

export const SecretPermissionDeniedFailureSchema = Schema.Struct({
  code: Schema.Literal('permission_denied'),
  provider: Schema.String,
  ref: RedactedSecretRefSchema,
  message: Schema.String
})
export type SecretPermissionDeniedFailureFromSchema =
  typeof SecretPermissionDeniedFailureSchema.Type

export const SecretUnsupportedBackendFailureSchema = Schema.Struct({
  code: Schema.Literal('unsupported_backend'),
  provider: Schema.String,
  backend: Schema.String,
  message: Schema.String
})
export type SecretUnsupportedBackendFailureFromSchema =
  typeof SecretUnsupportedBackendFailureSchema.Type

export const StaleCachedSecretFailureSchema = Schema.Struct({
  code: Schema.Literal('stale_secret'),
  provider: Schema.String,
  ref: RedactedSecretRefSchema,
  cachedAt: Schema.String,
  expiredAt: Schema.String,
  message: Schema.String
})
export type StaleCachedSecretFailureFromSchema = typeof StaleCachedSecretFailureSchema.Type

export const SecretFailureSchema = Schema.Union(
  SecretProviderUnavailableFailureSchema,
  SecretMissingFailureSchema,
  SecretPermissionDeniedFailureSchema,
  SecretUnsupportedBackendFailureSchema,
  StaleCachedSecretFailureSchema
)
export type SecretFailureFromSchema = typeof SecretFailureSchema.Type
