import { describe, expect, it } from 'bun:test'
import {
  CoreSecretStartupError,
  createRuntimeSecretManager,
  resolveCoreOidcStartupSecrets
} from '../../apps/core/src/adapters.ts'
import type { RuntimeDeploymentConfig } from '../../packages/config/src/index.ts'

function runtimeConfigWithSecretBindings(
  bindings: RuntimeDeploymentConfig['raw']['secretBindings']
): RuntimeDeploymentConfig {
  const oidc: RuntimeDeploymentConfig['oidc'] = {
    provider: 'oidc',
    issuer: 'https://keycloak.test/realms/meristem',
    audiences: ['meristem-core']
  }
  const raw: RuntimeDeploymentConfig['raw'] = {
    track: 'nixos',
    serviceUrls: {
      core: 'http://core.test',
      mnet: 'http://mnet.test',
      policy: 'http://policy.test',
      log: 'http://log.test',
      eventbus: 'http://eventbus.test',
      task: 'http://task.test',
      extension: 'http://extension.test',
      uiBff: 'http://ui-bff.test',
      nodeAgent: 'http://node-agent.test'
    },
    internalAuth: {
      headerName: 'x-meristem-internal-token',
      tokenEnvVar: 'MERISTEM_INTERNAL_TOKEN'
    },
    oidc,
    secretProvider: {
      providerName: 'runtime',
      backend: 'local-dev-env',
      namedProvider: {
        name: 'runtime',
        config: {
          backend: 'local-dev-env',
          envMappings: {
            'keycloak/client-secret': 'TEST_OIDC_CLIENT_SECRET',
            'keycloak/jwks': 'TEST_OIDC_JWKS'
          }
        }
      }
    },
    secretBindings: bindings,
    netbird: {
      signalEndpoint: 'https://signal.test',
      relayEndpoint: 'https://relay.test',
      stunEndpoint: 'stun:stun.test:3478'
    },
    nodeAgentCapabilities: {
      netAdmin: true,
      wireguardModulePath: '/lib/modules/wireguard.ko',
      wgBinaryPath: '/usr/bin/wg',
      ipBinaryPath: '/usr/bin/ip'
    },
    readiness: {
      postgres: { kind: 'postgres-select-1', target: 'postgres' },
      core: { kind: 'http-get', target: 'core', endpoint: '/ready' },
      mnet: { kind: 'http-get', target: 'mnet', endpoint: '/ready' },
      policy: { kind: 'http-get', target: 'policy', endpoint: '/ready' },
      log: { kind: 'http-get', target: 'log', endpoint: '/ready' },
      eventbus: { kind: 'http-get', target: 'eventbus', endpoint: '/ready' },
      task: { kind: 'http-get', target: 'task', endpoint: '/ready' },
      extension: { kind: 'http-get', target: 'extension', endpoint: '/ready' },
      uiBff: { kind: 'http-get', target: 'ui-bff', endpoint: '/ready' },
      nodeAgent: { kind: 'http-get', target: 'node-agent', endpoint: '/ready' }
    }
  }

  return {
    deploymentTarget: raw.track,
    auth: oidc,
    oidc,
    secretProvider: raw.secretProvider,
    netbird: raw.netbird,
    raw
  }
}

describe('Core SecretProvider startup failure modes', () => {
  it('resolves Keycloak OIDC credential refs through SecretProvider', async () => {
    const config = runtimeConfigWithSecretBindings([
      {
        envVar: 'MERISTEM_OIDC_CLIENT_SECRET',
        ref: { provider: 'runtime', keyPath: 'keycloak/client-secret' }
      },
      {
        envVar: 'MERISTEM_OIDC_JWKS',
        ref: { provider: 'runtime', keyPath: 'keycloak/jwks' }
      }
    ])
    const manager = createRuntimeSecretManager(config, {
      TEST_OIDC_CLIENT_SECRET: 'keycloak-client-secret-value',
      TEST_OIDC_JWKS: '{"keys":[]}'
    })

    const resolved = await resolveCoreOidcStartupSecrets(config, manager)

    expect(resolved).toEqual({
      clientSecret: 'keycloak-client-secret-value',
      jwks: '{"keys":[]}'
    })
  })

  it('fails Core startup closed when required OIDC client secret is missing', async () => {
    const config = runtimeConfigWithSecretBindings([
      {
        envVar: 'MERISTEM_OIDC_CLIENT_SECRET',
        ref: { provider: 'runtime', keyPath: 'keycloak/client-secret' }
      }
    ])
    const manager = createRuntimeSecretManager(config, {})

    await expect(resolveCoreOidcStartupSecrets(config, manager)).rejects.toMatchObject({
      name: 'CoreSecretStartupError',
      failure: {
        code: 'core.secret_startup_failed',
        consumer: 'oidc',
        reason: 'secret_missing'
      }
    })
  })

  it('redacts denied OIDC secret access in typed startup errors', async () => {
    const config = runtimeConfigWithSecretBindings([
      {
        envVar: 'MERISTEM_OIDC_CLIENT_SECRET',
        ref: { provider: 'runtime', keyPath: 'keycloak/client-secret', metadata: { token: 'raw' } }
      }
    ])
    const manager = {
      async read(ref: RuntimeDeploymentConfig['raw']['secretBindings'][number]['ref']) {
        return {
          ok: false as const,
          error: {
            code: 'permission_denied' as const,
            provider: ref.provider,
            ref: { provider: ref.provider, keyPath: ref.keyPath },
            message: 'denied by provider policy'
          }
        }
      },
      async list() {
        return { ok: true as const, value: [] }
      },
      async write() {
        return { ok: true as const, value: undefined }
      }
    }

    try {
      await resolveCoreOidcStartupSecrets(config, manager)
      throw new Error('expected OIDC startup to fail closed')
    } catch (error) {
      expect(error).toBeInstanceOf(CoreSecretStartupError)
      const failure = error instanceof CoreSecretStartupError ? error.failure : null
      expect(failure?.reason).toBe('permission_denied')
      expect(JSON.stringify(failure)).not.toContain('raw')
    }
  })
})
