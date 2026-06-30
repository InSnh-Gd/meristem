import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { Result } from '../../common/src/result.ts'
import { err, ok } from '../../common/src/result.ts'
import type {
  LocalDevEnvSecretProviderConfigFromSchema,
  SecretFailureFromSchema,
  SecretListPrefixFromSchema,
  SecretProviderConfigFromSchema,
  SecretRefFromSchema,
  VaultKvV2SecretProviderConfigFromSchema
} from '../../contracts/src/schemas/secret-provider.ts'
import { redactSecretRef } from './redaction.ts'

const VaultKvV2ReadResponseSchema = Type.Object(
  {
    data: Type.Object(
      {
        data: Type.Record(Type.String(), Type.Unknown())
      },
      { additionalProperties: true }
    )
  },
  { additionalProperties: true }
)

const VaultListResponseSchema = Type.Object(
  {
    data: Type.Object(
      {
        keys: Type.Array(Type.String())
      },
      { additionalProperties: true }
    )
  },
  { additionalProperties: true }
)

type VaultKvV2ReadResponse = Static<typeof VaultKvV2ReadResponseSchema>
type VaultListResponse = Static<typeof VaultListResponseSchema>

export type SecretProviderAdapter = {
  readonly name: string
  readonly backend: string
  read(ref: SecretRefFromSchema): Promise<Result<string, SecretFailureFromSchema>>
  list(
    prefix: SecretListPrefixFromSchema
  ): Promise<Result<readonly string[], SecretFailureFromSchema>>
  write(ref: SecretRefFromSchema, value: string): Promise<Result<void, SecretFailureFromSchema>>
}

export type VaultAuthHeadersResolver = (
  authMethodRef: string,
  providerName: string
) => Promise<Result<Record<string, string>, SecretFailureFromSchema>>

export type VaultFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function providerUnavailable(
  provider: string,
  ref: SecretRefFromSchema,
  message: string
): SecretFailureFromSchema {
  return {
    code: 'provider_unavailable',
    provider,
    ref: redactSecretRef(ref),
    message
  }
}

function secretMissing(
  provider: string,
  ref: SecretRefFromSchema,
  message: string
): SecretFailureFromSchema {
  return {
    code: 'secret_missing',
    provider,
    ref: redactSecretRef(ref),
    message
  }
}

function permissionDenied(
  provider: string,
  ref: SecretRefFromSchema,
  message: string
): SecretFailureFromSchema {
  return {
    code: 'permission_denied',
    provider,
    ref: redactSecretRef(ref),
    message
  }
}

function unsupportedBackend(provider: string, backend: string): SecretFailureFromSchema {
  return {
    code: 'unsupported_backend',
    provider,
    backend,
    message: `Secret provider backend "${backend}" is not supported`
  }
}

function createUnsupportedSecretProvider(name: string, backend: string): SecretProviderAdapter {
  return {
    name,
    backend,
    async read(_ref) {
      return err(unsupportedBackend(name, backend))
    },
    async list() {
      return err(unsupportedBackend(name, backend))
    },
    async write() {
      return err(unsupportedBackend(name, backend))
    }
  }
}

/**
 * local-dev/env provider 只负责把逻辑 keyPath 映射到 env var，不承担生产秘密托管能力。
 */
export function createLocalDevEnvSecretProvider(
  name: string,
  config: LocalDevEnvSecretProviderConfigFromSchema,
  env: NodeJS.ProcessEnv = process.env
): SecretProviderAdapter {
  function envVarFor(ref: SecretRefFromSchema): string | null {
    return config.envMappings[ref.keyPath] ?? null
  }

  return {
    name,
    backend: config.backend,
    async read(ref) {
      const envVar = envVarFor(ref)
      if (!envVar) {
        return err(
          secretMissing(name, ref, `No env mapping configured for keyPath "${ref.keyPath}"`)
        )
      }

      const value = env[envVar]
      if (!value) {
        return err(secretMissing(name, ref, `Mapped env var "${envVar}" is not set`))
      }

      return ok(value)
    },
    async list(prefix) {
      const keys = Object.keys(config.envMappings).filter(key => key.startsWith(prefix.keyPath))
      return ok(keys)
    },
    async write(ref, value) {
      const envVar = envVarFor(ref)
      if (!envVar) {
        return err(
          secretMissing(name, ref, `No env mapping configured for keyPath "${ref.keyPath}"`)
        )
      }

      env[envVar] = value
      return ok(undefined)
    }
  }
}

function joinVaultPath(
  address: string,
  mountPath: string,
  section: 'data' | 'metadata',
  keyPath: string
): URL {
  const normalizedAddress = address.endsWith('/') ? address : `${address}/`
  return new URL(`v1/${mountPath}/${section}/${keyPath}`, normalizedAddress)
}

function decodeVaultKvV2ReadResponse(payload: unknown): VaultKvV2ReadResponse | null {
  try {
    return Value.Cast(VaultKvV2ReadResponseSchema, payload)
  } catch {
    return null
  }
}

function decodeVaultListResponse(payload: unknown): VaultListResponse | null {
  try {
    return Value.Cast(VaultListResponseSchema, payload)
  } catch {
    return null
  }
}

function extractVaultValue(payload: VaultKvV2ReadResponse): string | null {
  const explicitValue = payload.data.data.value
  if (typeof explicitValue === 'string') return explicitValue
  const entries = Object.values(payload.data.data).filter(
    (candidate): candidate is string => typeof candidate === 'string'
  )
  return entries.length === 1 ? (entries[0] ?? null) : null
}

function extractVaultListKeys(payload: VaultListResponse): readonly string[] {
  return payload.data.keys
}

async function defaultVaultAuthHeadersResolver(
  _authMethodRef: string,
  providerName: string
): Promise<Result<Record<string, string>, SecretFailureFromSchema>> {
  const token = process.env.MERISTEM_VAULT_TOKEN
  if (!token) {
    return err({
      code: 'provider_unavailable',
      provider: providerName,
      ref: { provider: providerName, keyPath: 'vault-auth' },
      message: 'MERISTEM_VAULT_TOKEN is required for the default Vault auth resolver'
    })
  }
  return ok({ 'x-vault-token': token })
}

/**
 * Vault provider只实现 KV v2 的 read/list/write 最小接口，其他 backend 语义不在当前范围内。
 */
export function createVaultKvV2SecretProvider(
  name: string,
  config: VaultKvV2SecretProviderConfigFromSchema,
  options: {
    fetchImpl?: VaultFetch
    resolveAuthHeaders?: VaultAuthHeadersResolver
  } = {}
): SecretProviderAdapter {
  const fetchImpl = options.fetchImpl ?? fetch
  const resolveAuthHeaders = options.resolveAuthHeaders ?? defaultVaultAuthHeadersResolver

  async function request(
    ref: SecretRefFromSchema,
    section: 'data' | 'metadata',
    init?: RequestInit,
    query?: Record<string, string>
  ): Promise<Result<Response, SecretFailureFromSchema>> {
    const authHeaders = await resolveAuthHeaders(config.authMethodRef, name)
    if (!authHeaders.ok) return authHeaders

    const url = joinVaultPath(config.address, config.mountPath, section, ref.keyPath)
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value)
    }

    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: {
          ...(authHeaders.value ?? {}),
          ...(init?.headers instanceof Headers
            ? Object.fromEntries(init.headers.entries())
            : (init?.headers ?? {}))
        }
      })
      return ok(response)
    } catch (error) {
      return err(
        providerUnavailable(
          name,
          ref,
          error instanceof Error ? error.message : 'Vault request failed'
        )
      )
    }
  }

  function mapVaultStatus(
    ref: SecretRefFromSchema,
    response: Response
  ): SecretFailureFromSchema | null {
    if (response.ok) return null
    if (response.status === 401 || response.status === 403) {
      return permissionDenied(name, ref, `Vault denied access with status ${response.status}`)
    }
    if (response.status === 404) {
      return secretMissing(name, ref, `Vault secret "${ref.keyPath}" was not found`)
    }
    if (response.status === 405 || response.status === 501) {
      return unsupportedBackend(name, config.backend)
    }
    return providerUnavailable(name, ref, `Vault returned status ${response.status}`)
  }

  return {
    name,
    backend: config.backend,
    async read(ref) {
      const response = await request(
        ref,
        'data',
        { method: 'GET' },
        ref.version === undefined ? undefined : { version: String(ref.version) }
      )
      if (!response.ok) return response
      const failure = mapVaultStatus(ref, response.value)
      if (failure) return err(failure)
      const payload = decodeVaultKvV2ReadResponse(await response.value.json())
      if (payload === null) {
        return err(
          providerUnavailable(
            name,
            ref,
            'Vault KV v2 response did not contain a scalar secret value'
          )
        )
      }
      const value = extractVaultValue(payload)
      return value === null
        ? err(
            providerUnavailable(
              name,
              ref,
              'Vault KV v2 response did not contain a scalar secret value'
            )
          )
        : ok(value)
    },
    async list(prefix) {
      const ref: SecretRefFromSchema = {
        provider: prefix.provider,
        keyPath: prefix.keyPath,
        metadata: { operation: 'list' }
      }
      const response = await request(ref, 'metadata', { method: 'LIST' })
      if (!response.ok) return response
      const failure = mapVaultStatus(ref, response.value)
      if (failure) return err(failure)
      const payload = decodeVaultListResponse(await response.value.json())
      if (payload === null) {
        return err(
          providerUnavailable(name, ref, 'Vault KV v2 list response did not contain keys[]')
        )
      }
      return ok(extractVaultListKeys(payload))
    },
    async write(ref, value) {
      const response = await request(ref, 'data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: { value } })
      })
      if (!response.ok) return response
      const failure = mapVaultStatus(ref, response.value)
      return failure ? err(failure) : ok(undefined)
    }
  }
}

export function createSecretProviderFromConfig(
  name: string,
  config:
    | (SecretProviderConfigFromSchema & { backend: string })
    | { backend: string; [key: string]: unknown },
  options: {
    env?: NodeJS.ProcessEnv
    fetchImpl?: VaultFetch
    resolveAuthHeaders?: VaultAuthHeadersResolver
  } = {}
): SecretProviderAdapter {
  switch (config.backend) {
    case 'local-dev-env':
      return createLocalDevEnvSecretProvider(
        name,
        config as LocalDevEnvSecretProviderConfigFromSchema,
        options.env
      )
    case 'vault-kv-v2':
      return createVaultKvV2SecretProvider(
        name,
        config as VaultKvV2SecretProviderConfigFromSchema,
        {
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          ...(options.resolveAuthHeaders ? { resolveAuthHeaders: options.resolveAuthHeaders } : {})
        }
      )
    default:
      return createUnsupportedSecretProvider(name, config.backend)
  }
}
