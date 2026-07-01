import { describe, expect, test } from 'bun:test'
import {
  loadRuntimeDeploymentConfig,
  RUNTIME_DEPLOYMENT_CONFIG_ENV
} from '../../packages/config/src/index.ts'

const CONFIG_PATH = '/tmp/meristem-runtime-deployment-config.json'

function validDeploymentConfig() {
  return {
    track: 'nixos',
    serviceUrls: {
      core: 'http://127.0.0.1:3000',
      mnet: 'http://127.0.0.1:3104',
      policy: 'http://127.0.0.1:3101',
      log: 'http://127.0.0.1:3102',
      eventbus: 'http://127.0.0.1:3103',
      task: 'http://127.0.0.1:3105',
      extension: 'http://127.0.0.1:3106',
      uiBff: 'http://127.0.0.1:3200',
      nodeAgent: 'http://127.0.0.1:3307'
    },
    internalAuth: {
      headerName: 'x-meristem-internal-token',
      tokenEnvVar: 'MERISTEM_INTERNAL_TOKEN'
    },
    oidc: {
      provider: 'oidc',
      issuer: 'https://identity.control-plane.example.com',
      audiences: ['meristem-core'],
      allowedAlgorithms: ['RS256'],
      jwksCache: {
        refreshIntervalMs: 300_000,
        ttlMs: 900_000
      },
      clockToleranceSeconds: 30
    },
    secretProvider: {
      providerName: 'local-dev',
      backend: 'local-dev-env',
      namedProvider: {
        name: 'local-dev',
        config: {
          backend: 'local-dev-env',
          envMappings: {}
        }
      }
    },
    secretBindings: [],
    netbird: {
      signalEndpoint: 'https://signal.control-plane.example.com:443',
      relayEndpoint: 'turns://relay.control-plane.example.com:443',
      stunEndpoint: 'stun:relay.control-plane.example.com:3478'
    },
    nodeAgentCapabilities: {
      netAdmin: true,
      wireguardModulePath: '/sys/module/wireguard',
      wgBinaryPath: '/run/current-system/sw/bin/wg',
      ipBinaryPath: '/run/current-system/sw/bin/ip'
    },
    readiness: {
      postgres: { kind: 'postgres-select-1', target: 'postgres' },
      core: { kind: 'http-get', target: 'core', endpoint: 'http://127.0.0.1:3000/api/v0/ready' },
      mnet: { kind: 'http-get', target: 'm-net', endpoint: 'http://127.0.0.1:3104/ready' },
      policy: { kind: 'http-get', target: 'm-policy', endpoint: 'http://127.0.0.1:3101/ready' },
      log: { kind: 'http-get', target: 'm-log', endpoint: 'http://127.0.0.1:3102/ready' },
      eventbus: {
        kind: 'http-get',
        target: 'm-eventbus',
        endpoint: 'http://127.0.0.1:3103/ready'
      },
      task: { kind: 'http-get', target: 'm-task', endpoint: 'http://127.0.0.1:3105/health' },
      extension: {
        kind: 'http-get',
        target: 'm-extension',
        endpoint: 'http://127.0.0.1:3106/ready'
      },
      uiBff: { kind: 'http-get', target: 'm-ui-bff', endpoint: 'http://127.0.0.1:3200/ready' },
      nodeAgent: { kind: 'command', target: 'node-agent', command: ['systemctl', 'is-active'] }
    }
  }
}

function envWithConfigPath(): NodeJS.ProcessEnv {
  return { [RUNTIME_DEPLOYMENT_CONFIG_ENV]: CONFIG_PATH }
}

function readConfig(value: unknown): (path: string) => Promise<string> {
  return async path => {
    expect(path).toBe(CONFIG_PATH)
    return JSON.stringify(value)
  }
}

describe('runtime deployment config loader', () => {
  test('loads a valid v0.2 deployment config', async () => {
    const result = await loadRuntimeDeploymentConfig({
      env: envWithConfigPath(),
      readTextFile: readConfig(validDeploymentConfig())
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.deploymentTarget).toBe('nixos')
    expect(result.value.auth.provider).toBe('oidc')
    expect(result.value.oidc).toBeDefined()
    if (result.value.oidc === undefined) return
    expect(result.value.oidc.issuer).toBe('https://identity.control-plane.example.com')
    expect(result.value.secretProvider.backend).toBe('local-dev-env')
    expect(result.value.netbird.signalEndpoint).toBe('https://signal.control-plane.example.com:443')
  })

  test('fails when the config file is missing', async () => {
    const result = await loadRuntimeDeploymentConfig({
      env: envWithConfigPath(),
      readTextFile: async () => {
        throw new Error('ENOENT')
      }
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('runtime_deployment_config.missing_file')
  })

  test('fails when the config file contains malformed JSON', async () => {
    const result = await loadRuntimeDeploymentConfig({
      env: envWithConfigPath(),
      readTextFile: async () => '{not-json'
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('runtime_deployment_config.malformed_json')
  })

  test('loads local-dev auth provider selection', async () => {
    const config = validDeploymentConfig()
    Object.assign(config, { oidc: { provider: 'local-dev' } })

    const result = await loadRuntimeDeploymentConfig({
      env: envWithConfigPath(),
      readTextFile: readConfig(config)
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.auth.provider).toBe('local-dev')
    expect(result.value.oidc).toBeUndefined()
  })

  test('fails when the auth provider is unsupported', async () => {
    const config = validDeploymentConfig()
    config.oidc.provider = 'internal'

    const result = await loadRuntimeDeploymentConfig({
      env: envWithConfigPath(),
      readTextFile: readConfig(config)
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('runtime_deployment_config.invalid_provider')
    if (result.error.code !== 'runtime_deployment_config.invalid_provider') return
    expect(result.error.provider).toBe('internal')
  })

  test('fails when oidc issuer is missing', async () => {
    const config = validDeploymentConfig()
    config.oidc.issuer = ''

    const result = await loadRuntimeDeploymentConfig({
      env: envWithConfigPath(),
      readTextFile: readConfig(config)
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('runtime_deployment_config.missing_oidc_field')
    if (result.error.code !== 'runtime_deployment_config.missing_oidc_field') return
    expect(result.error.field).toBe('issuer')
  })
})
