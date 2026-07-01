import { Either } from 'effect'
import * as Schema from 'effect/Schema'
import { err, ok, type Result } from '../../common/src/result.ts'
import {
  DeploymentConfigV02Schema,
  type DeploymentConfigV02FromSchema,
  type DeploymentSecretProviderConfigFromSchema,
  type NetBirdInfrastructureRefsFromSchema,
  type LocalDevAuthProviderConfigFromSchema,
  type OidcAuthProviderConfigFromSchema
} from '../../contracts/src/index.ts'

export const RUNTIME_DEPLOYMENT_CONFIG_ENV = 'MERISTEM_V02_DEPLOYMENT_CONFIG'

export type RuntimeDeploymentConfigFailure =
  | {
      code: 'runtime_deployment_config.missing_env'
      envVar: typeof RUNTIME_DEPLOYMENT_CONFIG_ENV
      message: string
    }
  | {
      code: 'runtime_deployment_config.missing_file'
      path: string
      message: string
    }
  | {
      code: 'runtime_deployment_config.malformed_json'
      path: string
      message: string
    }
  | {
      code: 'runtime_deployment_config.invalid_provider'
      path: string
      provider: string
      message: string
    }
  | {
      code: 'runtime_deployment_config.missing_oidc_field'
      path: string
      field: 'issuer' | 'audiences'
      message: string
    }
  | {
      code: 'runtime_deployment_config.invalid_schema'
      path: string
      message: string
    }

type RuntimeDeploymentConfigBase = {
  deploymentTarget: DeploymentConfigV02FromSchema['track']
  secretProvider: DeploymentSecretProviderConfigFromSchema
  netbird: NetBirdInfrastructureRefsFromSchema
  raw: DeploymentConfigV02FromSchema
}

export type RuntimeDeploymentConfig =
  | (RuntimeDeploymentConfigBase & {
      auth: OidcAuthProviderConfigFromSchema
      oidc: OidcAuthProviderConfigFromSchema
    })
  | (RuntimeDeploymentConfigBase & {
      auth: LocalDevAuthProviderConfigFromSchema
      oidc?: never
    })

export type RuntimeDeploymentConfigLoaderDeps = {
  env?: NodeJS.ProcessEnv
  readTextFile?: (path: string) => Promise<string>
}

export class RuntimeDeploymentConfigError extends Error {
  readonly failure: RuntimeDeploymentConfigFailure

  constructor(failure: RuntimeDeploymentConfigFailure) {
    super(failure.message)
    this.name = 'RuntimeDeploymentConfigError'
    this.failure = failure
  }
}

async function defaultReadTextFile(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new Error('file does not exist')
  }
  return file.text()
}

function pathFromEnv(env: NodeJS.ProcessEnv): Result<string, RuntimeDeploymentConfigFailure> {
  const path = env[RUNTIME_DEPLOYMENT_CONFIG_ENV]?.trim()
  if (!path) {
    return err({
      code: 'runtime_deployment_config.missing_env',
      envVar: RUNTIME_DEPLOYMENT_CONFIG_ENV,
      message: `${RUNTIME_DEPLOYMENT_CONFIG_ENV} must point to a v0.2 deployment config JSON file`
    })
  }
  return ok(path)
}

function parseDeploymentConfigJson(
  path: string,
  text: string
): Result<unknown, RuntimeDeploymentConfigFailure> {
  try {
    return ok(JSON.parse(text))
  } catch (error) {
    return err({
      code: 'runtime_deployment_config.malformed_json',
      path,
      message: `Deployment config at ${path} is not valid JSON: ${String(error)}`
    })
  }
}

function providerFromUnknown(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('oidc' in value)) return 'missing'
  const oidc = value.oidc
  if (typeof oidc !== 'object' || oidc === null || !('provider' in oidc)) return 'missing'
  const provider = oidc.provider
  return typeof provider === 'string' ? provider : 'non-string'
}

function missingOidcFieldFromUnknown(
  path: string,
  value: unknown
): RuntimeDeploymentConfigFailure | null {
  if (typeof value !== 'object' || value === null || !('oidc' in value)) return null
  const oidc = value.oidc
  if (typeof oidc !== 'object' || oidc === null) return null
  if (!('provider' in oidc) || oidc.provider !== 'oidc') return null

  const issuer = 'issuer' in oidc ? oidc.issuer : undefined
  if (typeof issuer !== 'string' || issuer.trim().length === 0) {
    return {
      code: 'runtime_deployment_config.missing_oidc_field',
      path,
      field: 'issuer',
      message: `Deployment config at ${path} selects oidc but does not provide oidc.issuer`
    }
  }

  const audiences = 'audiences' in oidc ? oidc.audiences : undefined
  if (!Array.isArray(audiences) || audiences.length === 0) {
    return {
      code: 'runtime_deployment_config.missing_oidc_field',
      path,
      field: 'audiences',
      message: `Deployment config at ${path} selects oidc but does not provide oidc.audiences`
    }
  }

  return null
}

function decodeDeploymentConfig(
  path: string,
  value: unknown
): Result<DeploymentConfigV02FromSchema, RuntimeDeploymentConfigFailure> {
  const provider = providerFromUnknown(value)
  if (provider !== 'oidc' && provider !== 'local-dev') {
    return err({
      code: 'runtime_deployment_config.invalid_provider',
      path,
      provider,
      message: `Deployment config at ${path} must select oidc or local-dev auth provider for v0.2 runtime startup`
    })
  }

  const oidcFieldFailure = missingOidcFieldFromUnknown(path, value)
  if (oidcFieldFailure) return err(oidcFieldFailure)

  const decoded = Schema.decodeUnknownEither(DeploymentConfigV02Schema)(value)
  if (Either.isRight(decoded)) return ok(decoded.right)

  return err({
    code: 'runtime_deployment_config.invalid_schema',
    path,
    message: `Deployment config at ${path} does not match the v0.2 deployment contract: ${String(decoded.left)}`
  })
}

function validateOidcRuntimeFields(
  path: string,
  config: DeploymentConfigV02FromSchema
): Result<DeploymentConfigV02FromSchema, RuntimeDeploymentConfigFailure> {
  if (config.oidc.provider !== 'oidc') {
    return ok(config)
  }

  if (config.oidc.issuer.trim().length === 0) {
    return err({
      code: 'runtime_deployment_config.missing_oidc_field',
      path,
      field: 'issuer',
      message: `Deployment config at ${path} selects oidc but does not provide oidc.issuer`
    })
  }

  if (config.oidc.audiences.length === 0) {
    return err({
      code: 'runtime_deployment_config.missing_oidc_field',
      path,
      field: 'audiences',
      message: `Deployment config at ${path} selects oidc but does not provide oidc.audiences`
    })
  }

  return ok(config)
}

function toRuntimeDeploymentConfig(config: DeploymentConfigV02FromSchema): RuntimeDeploymentConfig {
  const base = {
    deploymentTarget: config.track,
    secretProvider: config.secretProvider,
    netbird: config.netbird,
    raw: config
  }

  if (config.oidc.provider === 'oidc') {
    return {
      ...base,
      auth: config.oidc,
      oidc: config.oidc
    }
  }

  return {
    ...base,
    auth: config.oidc
  }
}

/**
 * Core 和后续运行时服务只从部署层声明的 v0.2 JSON 读取启动配置，避免生产启动隐式回落到本地开发凭据。
 */
export async function loadRuntimeDeploymentConfig(
  deps: RuntimeDeploymentConfigLoaderDeps = {}
): Promise<Result<RuntimeDeploymentConfig, RuntimeDeploymentConfigFailure>> {
  const env = deps.env ?? process.env
  const configPath = pathFromEnv(env)
  if (!configPath.ok) return configPath

  const readTextFile = deps.readTextFile ?? defaultReadTextFile
  let text: string
  try {
    text = await readTextFile(configPath.value)
  } catch (error) {
    return err({
      code: 'runtime_deployment_config.missing_file',
      path: configPath.value,
      message: `Deployment config file ${configPath.value} could not be read: ${String(error)}`
    })
  }

  const parsed = parseDeploymentConfigJson(configPath.value, text)
  if (!parsed.ok) return parsed

  const decoded = decodeDeploymentConfig(configPath.value, parsed.value)
  if (!decoded.ok) return decoded

  const validated = validateOidcRuntimeFields(configPath.value, decoded.value)
  if (!validated.ok) return validated

  return ok(toRuntimeDeploymentConfig(validated.value))
}

/**
 * 启动装配使用抛错形式让进程 fail closed；测试和调用方可使用 Result 形式检查 typed failure。
 */
export async function loadRuntimeDeploymentConfigOrThrow(
  deps: RuntimeDeploymentConfigLoaderDeps = {}
): Promise<RuntimeDeploymentConfig> {
  const result = await loadRuntimeDeploymentConfig(deps)
  if (result.ok) return result.value
  throw new RuntimeDeploymentConfigError(result.error)
}
