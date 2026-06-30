import type { Result } from '../../common/src/result.ts'
import { err, ok } from '../../common/src/result.ts'
import type {
  SecretCachePolicyFromSchema,
  SecretFailureFromSchema,
  SecretListPrefixFromSchema,
  SecretRefFromSchema
} from '../../contracts/src/schemas/secret-provider.ts'
import { createSecretProviderFromConfig, type SecretProviderAdapter } from './providers.ts'
import { redactSecretRef } from './redaction.ts'

type Clock = { now(): number }

type CacheEntry = {
  value: string
  cachedAtMs: number
  refreshing: Promise<void> | null
}

const defaultCachePolicy: SecretCachePolicyFromSchema = {
  freshTtlMs: 60_000,
  staleTtlMs: 300_000
}

function cacheKey(ref: SecretRefFromSchema): string {
  return `${ref.provider}:${ref.keyPath}:${ref.version ?? 'latest'}`
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString()
}

export type SecretManager = {
  read(ref: SecretRefFromSchema): Promise<Result<string, SecretFailureFromSchema>>
  list(
    prefix: SecretListPrefixFromSchema
  ): Promise<Result<readonly string[], SecretFailureFromSchema>>
  write(ref: SecretRefFromSchema, value: string): Promise<Result<void, SecretFailureFromSchema>>
}

/**
 * SecretManager 在 provider 之上统一提供命名路由和 stale-while-revalidate 缓存语义。
 */
export function createSecretManager(input: {
  providers: readonly SecretProviderAdapter[]
  cache?: Partial<SecretCachePolicyFromSchema>
  clock?: Clock
}): SecretManager {
  const providers = new Map(input.providers.map(provider => [provider.name, provider]))
  const cache = new Map<string, CacheEntry>()
  const policy: SecretCachePolicyFromSchema = { ...defaultCachePolicy, ...(input.cache ?? {}) }
  const clock = input.clock ?? { now: () => Date.now() }

  function resolveProvider(
    ref: SecretRefFromSchema
  ): Result<SecretProviderAdapter, SecretFailureFromSchema> {
    const provider = providers.get(ref.provider)
    return provider
      ? ok(provider)
      : err({
          code: 'unsupported_backend',
          provider: ref.provider,
          backend: ref.provider,
          message: `No secret provider named "${ref.provider}" is registered`
        })
  }

  async function refreshEntry(
    provider: SecretProviderAdapter,
    ref: SecretRefFromSchema,
    nowMs: number
  ): Promise<Result<string, SecretFailureFromSchema>> {
    const refreshed = await provider.read(ref)
    if (refreshed.ok) {
      cache.set(cacheKey(ref), {
        value: refreshed.value,
        cachedAtMs: nowMs,
        refreshing: null
      })
    }
    return refreshed
  }

  function startBackgroundRefresh(provider: SecretProviderAdapter, ref: SecretRefFromSchema): void {
    const key = cacheKey(ref)
    const entry = cache.get(key)
    if (!entry || entry.refreshing) return

    entry.refreshing = refreshEntry(provider, ref, clock.now())
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        const updated = cache.get(key)
        if (updated) {
          cache.set(key, { ...updated, refreshing: null })
        }
      })
  }

  return {
    async read(ref) {
      const provider = resolveProvider(ref)
      if (!provider.ok) return provider

      const key = cacheKey(ref)
      const cached = cache.get(key)
      const nowMs = clock.now()
      if (!cached) {
        return refreshEntry(provider.value, ref, nowMs)
      }

      const ageMs = nowMs - cached.cachedAtMs
      if (ageMs <= policy.freshTtlMs) {
        return ok(cached.value)
      }
      if (ageMs <= policy.staleTtlMs) {
        startBackgroundRefresh(provider.value, ref)
        return ok(cached.value)
      }

      const refreshed = await refreshEntry(provider.value, ref, nowMs)
      if (!refreshed.ok && refreshed.error.code === 'provider_unavailable') {
        return err({
          code: 'stale_secret',
          provider: ref.provider,
          ref: redactSecretRef(ref),
          cachedAt: isoAt(cached.cachedAtMs),
          expiredAt: isoAt(cached.cachedAtMs + policy.staleTtlMs),
          message: 'Cached secret expired before provider refresh could succeed'
        })
      }

      return refreshed
    },
    async list(prefix) {
      const provider = providers.get(prefix.provider)
      return provider
        ? provider.list(prefix)
        : err({
            code: 'unsupported_backend',
            provider: prefix.provider,
            backend: prefix.provider,
            message: `No secret provider named "${prefix.provider}" is registered`
          })
    },
    async write(ref, value) {
      const provider = resolveProvider(ref)
      if (!provider.ok) return provider

      const written = await provider.value.write(ref, value)
      if (written.ok) {
        cache.set(cacheKey(ref), {
          value,
          cachedAtMs: clock.now(),
          refreshing: null
        })
      }
      return written
    }
  }
}

export function createSecretManagerFromConfigs(input: {
  providers: ReadonlyArray<{ name: string; config: { backend: string; [key: string]: unknown } }>
  cache?: Partial<SecretCachePolicyFromSchema>
  clock?: Clock
  env?: NodeJS.ProcessEnv
}): SecretManager {
  return createSecretManager({
    providers: input.providers.map(provider =>
      createSecretProviderFromConfig(provider.name, provider.config, {
        ...(input.env ? { env: input.env } : {})
      })
    ),
    ...(input.cache ? { cache: input.cache } : {}),
    ...(input.clock ? { clock: input.clock } : {})
  })
}
