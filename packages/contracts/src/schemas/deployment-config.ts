import * as Schema from 'effect/Schema'
import {
  OidcAuthProviderConfigSchema,
  OidcSupportedAlgorithmSchema
} from './auth-runtime-config.ts'
import {
  DeploymentSecretBindingsSchema,
  NamedSecretProviderConfigSchema,
  RedactedSecretRefSchema,
  SecretProviderBackendSchema
} from './secret-provider.ts'

const NonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

/**
 * v0.2 部署配置只覆盖当前支持的两条部署轨道。
 */
export const DeploymentTrackSchema = Schema.Literal('nixos', 'oci')
export type DeploymentTrackFromSchema = typeof DeploymentTrackSchema.Type

/**
 * 控制面与 node-agent 的 URL 由部署层统一显式声明，禁止依赖隐式 loopback 推断。
 */
export const DeploymentServiceUrlsSchema = Schema.Struct({
  core: NonEmptyStringSchema,
  mnet: NonEmptyStringSchema,
  policy: NonEmptyStringSchema,
  log: NonEmptyStringSchema,
  eventbus: NonEmptyStringSchema,
  task: NonEmptyStringSchema,
  extension: NonEmptyStringSchema,
  uiBff: NonEmptyStringSchema,
  nodeAgent: NonEmptyStringSchema
})
export type DeploymentServiceUrlsFromSchema = typeof DeploymentServiceUrlsSchema.Type

/**
 * 内部鉴权配置只暴露 header 名、token env 名和 redacted SecretRef 元数据。
 */
export const InternalAuthDeploymentConfigSchema = Schema.Struct({
  headerName: NonEmptyStringSchema,
  tokenEnvVar: NonEmptyStringSchema,
  tokenSecretRef: Schema.optional(RedactedSecretRefSchema)
})
export type InternalAuthDeploymentConfigFromSchema = typeof InternalAuthDeploymentConfigSchema.Type

/**
 * NetBird 基础设施只保留 endpoint 引用，credentials 继续走 SecretProvider。
 */
export const NetBirdInfrastructureRefsSchema = Schema.Struct({
  signalEndpoint: NonEmptyStringSchema,
  relayEndpoint: NonEmptyStringSchema,
  stunEndpoint: NonEmptyStringSchema
})
export type NetBirdInfrastructureRefsFromSchema = typeof NetBirdInfrastructureRefsSchema.Type

/**
 * node-agent host capability 配置描述宿主机必须提供的系统能力和工具路径。
 */
export const NodeAgentHostCapabilitiesSchema = Schema.Struct({
  netAdmin: Schema.Boolean,
  wireguardModulePath: NonEmptyStringSchema,
  wgBinaryPath: NonEmptyStringSchema,
  ipBinaryPath: NonEmptyStringSchema,
  // legacy v0.1 wstunnel — migration-required only, not v0.2 runtime
  wstunnelBinaryPath: Schema.optional(NonEmptyStringSchema)
})
export type NodeAgentHostCapabilitiesFromSchema = typeof NodeAgentHostCapabilitiesSchema.Type

/**
 * readiness 声明遵循当前仓库已有的 HTTP / postgres select 1 / preflight command 三类探针模式。
 */
export const DeploymentReadinessKindSchema = Schema.Literal(
  'http-get',
  'postgres-select-1',
  'command'
)
export type DeploymentReadinessKindFromSchema = typeof DeploymentReadinessKindSchema.Type

export const ReadinessProbeSchema = Schema.Struct({
  kind: DeploymentReadinessKindSchema,
  target: NonEmptyStringSchema,
  endpoint: Schema.optional(NonEmptyStringSchema),
  command: Schema.optional(Schema.Array(NonEmptyStringSchema))
})
export type ReadinessProbeFromSchema = typeof ReadinessProbeSchema.Type

export const DeploymentReadinessSchema = Schema.Struct({
  postgres: ReadinessProbeSchema,
  core: ReadinessProbeSchema,
  mnet: ReadinessProbeSchema,
  policy: ReadinessProbeSchema,
  log: ReadinessProbeSchema,
  eventbus: ReadinessProbeSchema,
  task: ReadinessProbeSchema,
  extension: ReadinessProbeSchema,
  uiBff: ReadinessProbeSchema,
  nodeAgent: ReadinessProbeSchema
})
export type DeploymentReadinessFromSchema = typeof DeploymentReadinessSchema.Type

/**
 * 部署层仍然复用已有 SecretProvider 契约，但要求显式给出 backend 和 provider 名。
 */
export const DeploymentSecretProviderConfigSchema = Schema.Struct({
  providerName: NonEmptyStringSchema,
  backend: SecretProviderBackendSchema,
  namedProvider: NamedSecretProviderConfigSchema
})
export type DeploymentSecretProviderConfigFromSchema =
  typeof DeploymentSecretProviderConfigSchema.Type

/**
 * NixOS 轨道同时覆盖 bare-metal 与 systemd/unit 级部署包装。
 */
export const NixosDeploymentConfigV02Schema = Schema.Struct({
  track: Schema.Literal('nixos'),
  serviceUrls: DeploymentServiceUrlsSchema,
  internalAuth: InternalAuthDeploymentConfigSchema,
  oidc: OidcAuthProviderConfigSchema,
  secretProvider: DeploymentSecretProviderConfigSchema,
  secretBindings: DeploymentSecretBindingsSchema,
  netbird: NetBirdInfrastructureRefsSchema,
  nodeAgentCapabilities: NodeAgentHostCapabilitiesSchema,
  readiness: DeploymentReadinessSchema
})
export type NixosDeploymentConfigV02FromSchema = typeof NixosDeploymentConfigV02Schema.Type

/**
 * OCI 轨道要求所有需要的 secret 输入都通过 SecretRef metadata 或 env binding 声明。
 */
export const OciDeploymentConfigV02Schema = Schema.Struct({
  track: Schema.Literal('oci'),
  serviceUrls: DeploymentServiceUrlsSchema,
  internalAuth: InternalAuthDeploymentConfigSchema,
  oidc: OidcAuthProviderConfigSchema,
  secretProvider: DeploymentSecretProviderConfigSchema,
  secretBindings: DeploymentSecretBindingsSchema,
  netbird: NetBirdInfrastructureRefsSchema,
  nodeAgentCapabilities: NodeAgentHostCapabilitiesSchema,
  readiness: DeploymentReadinessSchema
})
export type OciDeploymentConfigV02FromSchema = typeof OciDeploymentConfigV02Schema.Type

export const DeploymentConfigV02Schema = Schema.Union(
  NixosDeploymentConfigV02Schema,
  OciDeploymentConfigV02Schema
)
export type DeploymentConfigV02FromSchema = typeof DeploymentConfigV02Schema.Type

/**
 * proof 输出里的 OIDC 摘要只保留允许安全展示的结构化字段。
 */
export const RedactedOidcSummarySchema = Schema.Struct({
  issuer: NonEmptyStringSchema,
  audiences: Schema.Array(NonEmptyStringSchema),
  allowedAlgorithms: Schema.Array(OidcSupportedAlgorithmSchema),
  jwksRefreshIntervalMs: Schema.Number,
  jwksTtlMs: Schema.Number,
  clockToleranceSeconds: Schema.Number
})
export type RedactedOidcSummaryFromSchema = typeof RedactedOidcSummarySchema.Type
