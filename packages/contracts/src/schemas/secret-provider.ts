import * as Schema from 'effect/Schema'

export const SecretRefMetadataSchema = Schema.Record(Schema.String, Schema.String)
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

export const SecretProviderBackendSchema = Schema.Literals(['local-dev-env', 'vault-kv-v2'])
export type SecretProviderBackendFromSchema = typeof SecretProviderBackendSchema.Type

export const SecretCachePolicySchema = Schema.Struct({
  freshTtlMs: Schema.Number,
  staleTtlMs: Schema.Number
})
export type SecretCachePolicyFromSchema = typeof SecretCachePolicySchema.Type

export const LocalDevEnvSecretProviderConfigSchema = Schema.Struct({
  backend: Schema.Literal('local-dev-env'),
  envMappings: Schema.Record(Schema.String, Schema.String)
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

export const VaultRaftStorageV02Schema = Schema.Struct({
  backend: Schema.Literal('raft-integrated'),
  nodeCount: Schema.Literal(3),
  autopilotEnabled: Schema.Boolean
})
export type VaultRaftStorageV02FromSchema = typeof VaultRaftStorageV02Schema.Type

export const VaultUnsealModeV02Schema = Schema.Literals(['shamir', 'self-hosted-auto-unseal'])
export type VaultUnsealModeV02FromSchema = typeof VaultUnsealModeV02Schema.Type

export const VaultHaConfigV02Schema = Schema.Struct({
  version: Schema.Literal('vault-ha@0.2.0'),
  backend: Schema.Literal('vault-kv-v2'),
  clusterName: Schema.String,
  address: Schema.String,
  mountPath: Schema.String,
  authMethodRef: Schema.String,
  storage: VaultRaftStorageV02Schema,
  unsealMode: VaultUnsealModeV02Schema,
  keyCustodyRef: Schema.String,
  secretZeroCeremonyRef: Schema.String,
  workloadAuthRef: Schema.String
})
export type VaultHaConfigV02FromSchema = typeof VaultHaConfigV02Schema.Type

export const VaultWorkloadAuthMethodV02Schema = Schema.Literals(['approle', 'workload-identity'])
export type VaultWorkloadAuthMethodV02FromSchema = typeof VaultWorkloadAuthMethodV02Schema.Type

export const VaultWorkloadAuthV02Schema = Schema.Struct({
  version: Schema.Literal('vault-workload-auth@0.2.0'),
  provider: Schema.String,
  method: VaultWorkloadAuthMethodV02Schema,
  roleIdRef: RedactedSecretRefSchema,
  secretIdRef: RedactedSecretRefSchema,
  policyRef: Schema.String,
  tokenTtlSeconds: Schema.Number,
  renewable: Schema.Boolean,
  auditId: Schema.String
})
export type VaultWorkloadAuthV02FromSchema = typeof VaultWorkloadAuthV02Schema.Type

export const VaultPolicyCapabilityV02Schema = Schema.Literals([
  'read',
  'list',
  'create',
  'update',
  'delete'
])
export type VaultPolicyCapabilityV02FromSchema = typeof VaultPolicyCapabilityV02Schema.Type

export const VaultPolicyRuleV02Schema = Schema.Struct({
  path: Schema.String,
  capabilities: Schema.Array(VaultPolicyCapabilityV02Schema),
  workloadRef: Schema.String
})
export type VaultPolicyRuleV02FromSchema = typeof VaultPolicyRuleV02Schema.Type

export const VaultPolicyModelV02Schema = Schema.Struct({
  version: Schema.Literal('vault-policy@0.2.0'),
  provider: Schema.String,
  defaultDeny: Schema.Literal(true),
  rules: Schema.Array(VaultPolicyRuleV02Schema)
})
export type VaultPolicyModelV02FromSchema = typeof VaultPolicyModelV02Schema.Type

/**
 * 统一 Vault provider 分支保留旧 KV v2 输入，并允许完整 HA metadata 通过同一边界编码。
 * 完整 HA 配置仍需先通过 VaultHaConfigV02Schema 校验，避免部分 HA 声明被当成有效拓扑。
 */
export const VaultCompatibleSecretProviderConfigV02Schema = Schema.Struct({
  backend: Schema.Literal('vault-kv-v2'),
  address: Schema.String,
  mountPath: Schema.String,
  authMethodRef: Schema.String,
  version: Schema.optional(Schema.Literal('vault-ha@0.2.0')),
  clusterName: Schema.optional(Schema.String),
  storage: Schema.optional(VaultRaftStorageV02Schema),
  unsealMode: Schema.optional(VaultUnsealModeV02Schema),
  keyCustodyRef: Schema.optional(Schema.String),
  secretZeroCeremonyRef: Schema.optional(Schema.String),
  workloadAuthRef: Schema.optional(Schema.String)
})
export type VaultCompatibleSecretProviderConfigV02FromSchema =
  typeof VaultCompatibleSecretProviderConfigV02Schema.Type

export const SecretProviderConfigSchema = Schema.Union([
  LocalDevEnvSecretProviderConfigSchema,
  VaultCompatibleSecretProviderConfigV02Schema
])
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

export const SecretFailureSchema = Schema.Union([
  SecretProviderUnavailableFailureSchema,
  SecretMissingFailureSchema,
  SecretPermissionDeniedFailureSchema,
  SecretUnsupportedBackendFailureSchema,
  StaleCachedSecretFailureSchema
])
export type SecretFailureFromSchema = typeof SecretFailureSchema.Type

export const VaultHealthStatusV02Schema = Schema.Struct({
  version: Schema.Literal('vault-health@0.2.0'),
  provider: Schema.String,
  status: Schema.Literals(['healthy', 'sealed', 'unavailable', 'quorum_lost']),
  sealed: Schema.Boolean,
  leader: Schema.Boolean,
  quorum: Schema.Boolean,
  raftAppliedIndex: Schema.Number,
  checkedAt: Schema.String
})
export type VaultHealthStatusV02FromSchema = typeof VaultHealthStatusV02Schema.Type

export const SecretRefResolutionFailureReasonV02Schema = Schema.Literals([
  'vault_sealed',
  'vault_unreachable',
  'vault_quorum_lost',
  'secret_not_found',
  'missing_policy_capability',
  'version_expired',
  'cache_expired',
  'credential_expired',
  'credential_revoked'
])
export type SecretRefResolutionFailureReasonV02FromSchema =
  typeof SecretRefResolutionFailureReasonV02Schema.Type

export const SecretRefResolutionSuccessV02Schema = Schema.Struct({
  status: Schema.Literal('success'),
  provider: Schema.String,
  ref: RedactedSecretRefSchema,
  resolvedVersion: Schema.Number,
  auditId: Schema.String,
  resolvedAt: Schema.String
})
export type SecretRefResolutionSuccessV02FromSchema =
  typeof SecretRefResolutionSuccessV02Schema.Type

/**
 * Vault 失败结果只保留 closed vocabulary 与审计引用，避免自由文本携带秘密内容。
 */
export const SecretRefResolutionFailureV02Schema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('provider_unavailable'),
    provider: Schema.String,
    ref: RedactedSecretRefSchema,
    reason: Schema.Literals(['vault_sealed', 'vault_unreachable', 'vault_quorum_lost']),
    failClosed: Schema.Literal(true),
    auditId: Schema.String
  }),
  Schema.Struct({
    status: Schema.Literal('secret_missing'),
    provider: Schema.String,
    ref: RedactedSecretRefSchema,
    reason: Schema.Literals(['secret_not_found', 'version_expired']),
    failClosed: Schema.Literal(true),
    auditId: Schema.String
  }),
  Schema.Struct({
    status: Schema.Literal('permission_denied'),
    provider: Schema.String,
    ref: RedactedSecretRefSchema,
    reason: Schema.Literal('missing_policy_capability'),
    failClosed: Schema.Literal(true),
    auditId: Schema.String
  }),
  Schema.Struct({
    status: Schema.Literal('stale_secret'),
    provider: Schema.String,
    ref: RedactedSecretRefSchema,
    reason: Schema.Literal('cache_expired'),
    failClosed: Schema.Literal(true),
    auditId: Schema.String
  }),
  Schema.Struct({
    status: Schema.Literal('credential_expired'),
    provider: Schema.String,
    ref: RedactedSecretRefSchema,
    reason: Schema.Literal('credential_expired'),
    failClosed: Schema.Literal(true),
    auditId: Schema.String
  }),
  Schema.Struct({
    status: Schema.Literal('credential_revoked'),
    provider: Schema.String,
    ref: RedactedSecretRefSchema,
    reason: Schema.Literal('credential_revoked'),
    failClosed: Schema.Literal(true),
    auditId: Schema.String
  })
])
export type SecretRefResolutionFailureV02FromSchema =
  typeof SecretRefResolutionFailureV02Schema.Type

export const SecretRefResolutionResultV02Schema = Schema.Union([
  SecretRefResolutionSuccessV02Schema,
  SecretRefResolutionFailureV02Schema
])
export type SecretRefResolutionResultV02FromSchema = typeof SecretRefResolutionResultV02Schema.Type

export const VaultWorkloadAuthFailureStatusV02Schema = Schema.Literals([
  'provider_unavailable',
  'permission_denied',
  'credential_expired',
  'credential_revoked'
])
export type VaultWorkloadAuthFailureStatusV02FromSchema =
  typeof VaultWorkloadAuthFailureStatusV02Schema.Type

export const VaultWorkloadAuthSuccessV02Schema = Schema.Struct({
  status: Schema.Literal('authenticated'),
  provider: Schema.String,
  authMethodRef: Schema.String,
  policyRef: Schema.String,
  leaseHandle: Schema.String,
  ttlSeconds: Schema.Number,
  auditId: Schema.String
})
export type VaultWorkloadAuthSuccessV02FromSchema = typeof VaultWorkloadAuthSuccessV02Schema.Type

export const VaultWorkloadAuthFailureV02Schema = Schema.Struct({
  status: VaultWorkloadAuthFailureStatusV02Schema,
  provider: Schema.String,
  authMethodRef: Schema.String,
  policyRef: Schema.String,
  failClosed: Schema.Literal(true),
  auditId: Schema.String
})
export type VaultWorkloadAuthFailureV02FromSchema = typeof VaultWorkloadAuthFailureV02Schema.Type

export const VaultWorkloadAuthResultV02Schema = Schema.Union([
  VaultWorkloadAuthSuccessV02Schema,
  VaultWorkloadAuthFailureV02Schema
])
export type VaultWorkloadAuthResultV02FromSchema = typeof VaultWorkloadAuthResultV02Schema.Type

export const SecretRotationRequestV02Schema = Schema.Struct({
  version: Schema.Literal('secret-rotation@0.2.0'),
  secretId: Schema.String,
  oldVersion: Schema.Number,
  actor: Schema.String,
  auditId: Schema.String,
  requestedAt: Schema.String
})
export type SecretRotationRequestV02FromSchema = typeof SecretRotationRequestV02Schema.Type

export const SecretVersionStateV02Schema = Schema.Struct({
  version: Schema.Number,
  state: Schema.Literals(['active', 'deactivated'])
})
export type SecretVersionStateV02FromSchema = typeof SecretVersionStateV02Schema.Type

export const SecretActiveVersionV02Schema = Schema.Struct({
  version: Schema.Number,
  state: Schema.Literal('active')
})
export type SecretActiveVersionV02FromSchema = typeof SecretActiveVersionV02Schema.Type

export const SecretDeactivatedVersionV02Schema = Schema.Struct({
  version: Schema.Number,
  state: Schema.Literal('deactivated')
})
export type SecretDeactivatedVersionV02FromSchema = typeof SecretDeactivatedVersionV02Schema.Type

export const SecretRotationSuccessV02Schema = Schema.Struct({
  status: Schema.Literal('rotated'),
  secretId: Schema.String,
  oldVersion: SecretDeactivatedVersionV02Schema,
  newVersion: SecretActiveVersionV02Schema,
  actor: Schema.String,
  auditId: Schema.String,
  rotatedAt: Schema.String
})
export type SecretRotationSuccessV02FromSchema = typeof SecretRotationSuccessV02Schema.Type

export const SecretMutationFailureV02Schema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('provider_unavailable'),
    secretId: Schema.String,
    provider: Schema.String,
    reason: Schema.Literals(['vault_sealed', 'vault_unreachable', 'vault_quorum_lost']),
    failClosed: Schema.Literal(true),
    auditId: Schema.String
  }),
  Schema.Struct({
    status: Schema.Literal('secret_missing'),
    secretId: Schema.String,
    provider: Schema.String,
    reason: Schema.Literals(['secret_not_found', 'version_expired']),
    failClosed: Schema.Literal(true),
    auditId: Schema.String
  }),
  Schema.Struct({
    status: Schema.Literal('permission_denied'),
    secretId: Schema.String,
    provider: Schema.String,
    reason: Schema.Literal('missing_policy_capability'),
    failClosed: Schema.Literal(true),
    auditId: Schema.String
  }),
  Schema.Struct({
    status: Schema.Literal('stale_secret'),
    secretId: Schema.String,
    provider: Schema.String,
    reason: Schema.Literal('cache_expired'),
    failClosed: Schema.Literal(true),
    auditId: Schema.String
  }),
  Schema.Struct({
    status: Schema.Literal('credential_expired'),
    secretId: Schema.String,
    provider: Schema.String,
    reason: Schema.Literal('credential_expired'),
    failClosed: Schema.Literal(true),
    auditId: Schema.String
  }),
  Schema.Struct({
    status: Schema.Literal('credential_revoked'),
    secretId: Schema.String,
    provider: Schema.String,
    reason: Schema.Literal('credential_revoked'),
    failClosed: Schema.Literal(true),
    auditId: Schema.String
  })
])
export type SecretMutationFailureV02FromSchema = typeof SecretMutationFailureV02Schema.Type

export const SecretRotationResultV02Schema = Schema.Union([
  SecretRotationSuccessV02Schema,
  SecretMutationFailureV02Schema
])
export type SecretRotationResultV02FromSchema = typeof SecretRotationResultV02Schema.Type

export const SecretRevokeRequestV02Schema = Schema.Struct({
  version: Schema.Literal('secret-revoke@0.2.0'),
  secretId: Schema.String,
  actor: Schema.String,
  auditId: Schema.String,
  requestedAt: Schema.String
})
export type SecretRevokeRequestV02FromSchema = typeof SecretRevokeRequestV02Schema.Type

export const SecretRevokeSuccessV02Schema = Schema.Struct({
  status: Schema.Literal('revoked'),
  secretId: Schema.String,
  revokedVersion: Schema.Number,
  actor: Schema.String,
  auditId: Schema.String,
  revokedAt: Schema.String
})
export type SecretRevokeSuccessV02FromSchema = typeof SecretRevokeSuccessV02Schema.Type

export const SecretRevokeResultV02Schema = Schema.Union([
  SecretRevokeSuccessV02Schema,
  SecretMutationFailureV02Schema
])
export type SecretRevokeResultV02FromSchema = typeof SecretRevokeResultV02Schema.Type
