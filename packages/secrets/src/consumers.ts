import type { Result } from '../../common/src/result.ts'
import { ok } from '../../common/src/result.ts'
import type {
  DeploymentSecretBindingsFromSchema,
  NetBirdInfrastructureSecretBindingsFromSchema,
  OidcSecretBindingsFromSchema,
  SecretFailureFromSchema,
  SecretRefFromSchema,
  SidecarSecretBindingsFromSchema
} from '../../contracts/src/schemas/secret-provider.ts'
import type { SecretManager } from './manager.ts'

async function readOptionalSecret(
  manager: SecretManager,
  ref: SecretRefFromSchema | undefined
): Promise<Result<string | undefined, SecretFailureFromSchema>> {
  if (!ref) return ok(undefined)
  return manager.read(ref)
}

/**
 * OIDC 先定义消费接口，T3 再决定具体 caller/route 接线。
 */
export async function resolveOidcSecretBindings(
  manager: SecretManager,
  bindings: OidcSecretBindingsFromSchema
): Promise<Result<{ clientSecret?: string; jwks?: string }, SecretFailureFromSchema>> {
  const clientSecret = await readOptionalSecret(manager, bindings.clientSecretRef)
  if (!clientSecret.ok) return clientSecret

  const jwks = await readOptionalSecret(manager, bindings.jwksRef)
  if (!jwks.ok) return jwks

  return ok({
    ...(clientSecret.value === undefined ? {} : { clientSecret: clientSecret.value }),
    ...(jwks.value === undefined ? {} : { jwks: jwks.value })
  })
}

export async function resolveNetBirdInfrastructureSecrets(
  manager: SecretManager,
  bindings: NetBirdInfrastructureSecretBindingsFromSchema
): Promise<
  Result<
    {
      signalCredential?: string
      relayCredential?: string
      stunCredential?: string
    },
    SecretFailureFromSchema
  >
> {
  const signalCredential = await readOptionalSecret(manager, bindings.signalCredentialRef)
  if (!signalCredential.ok) return signalCredential

  const relayCredential = await readOptionalSecret(manager, bindings.relayCredentialRef)
  if (!relayCredential.ok) return relayCredential

  const stunCredential = await readOptionalSecret(manager, bindings.stunCredentialRef)
  if (!stunCredential.ok) return stunCredential

  return ok({
    ...(signalCredential.value === undefined ? {} : { signalCredential: signalCredential.value }),
    ...(relayCredential.value === undefined ? {} : { relayCredential: relayCredential.value }),
    ...(stunCredential.value === undefined ? {} : { stunCredential: stunCredential.value })
  })
}

export async function resolveSidecarCredentials(
  manager: SecretManager,
  bindings: SidecarSecretBindingsFromSchema
): Promise<Result<{ authToken?: string; configSecret?: string }, SecretFailureFromSchema>> {
  const authToken = await readOptionalSecret(manager, bindings.authTokenRef)
  if (!authToken.ok) return authToken

  const configSecret = await readOptionalSecret(manager, bindings.configSecretRef)
  if (!configSecret.ok) return configSecret

  return ok({
    ...(authToken.value === undefined ? {} : { authToken: authToken.value }),
    ...(configSecret.value === undefined ? {} : { configSecret: configSecret.value })
  })
}

export async function resolveDeploymentSecretBindings(
  manager: SecretManager,
  bindings: DeploymentSecretBindingsFromSchema
): Promise<Result<Record<string, string>, SecretFailureFromSchema>> {
  const resolved: Record<string, string> = {}
  for (const binding of bindings) {
    const value = await manager.read(binding.ref)
    if (!value.ok) return value
    resolved[binding.envVar] = value.value
  }

  return ok(resolved)
}
