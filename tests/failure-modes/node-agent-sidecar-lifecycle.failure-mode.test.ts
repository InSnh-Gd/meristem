import { describe, expect, it } from 'bun:test'
import type {
  DeploymentConfigV02FromSchema,
  NodeAgentRuntimeDesiredSidecar
} from '../../packages/contracts/src/index.ts'
import type { SecretManager } from '../../packages/secrets/src/index.ts'
import { applySidecarDesiredState } from '../../services/node-agent/src/node-agent-sidecar-lifecycle.ts'

const deploymentConfig: DeploymentConfigV02FromSchema = {
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
  oidc: {
    provider: 'oidc',
    issuer: 'https://keycloak.test/realms/meristem',
    audiences: ['meristem-core']
  },
  secretProvider: {
    providerName: 'runtime',
    backend: 'local-dev-env',
    namedProvider: {
      name: 'runtime',
      config: {
        backend: 'local-dev-env',
        envMappings: {}
      }
    }
  },
  secretBindings: [],
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

const desiredSidecar: NodeAgentRuntimeDesiredSidecar = {
  desiredState: 'start',
  credentialStatus: 'ready',
  healthStatus: 'healthy',
  signalConfigRef: { configRef: 'netbird/signal/test' },
  relayConfigRef: { configRef: 'netbird/relay/test' },
  stunConfigRef: { configRef: 'netbird/stun/test' },
  sidecarCredentialRef: { provider: 'runtime', keyPath: 'netbird/sidecar/test' }
}

function managerWithSecrets(secrets: Readonly<Record<string, string>>): SecretManager {
  return {
    async read(ref) {
      const value = secrets[ref.keyPath]
      return value
        ? { ok: true as const, value }
        : {
            ok: false as const,
            error: {
              code: 'secret_missing' as const,
              provider: ref.provider,
              ref: { provider: ref.provider, keyPath: ref.keyPath },
              message: 'secret is missing'
            }
          }
    },
    async list() {
      return { ok: true as const, value: Object.keys(secrets) }
    },
    async write(_ref, _value) {
      return { ok: true as const, value: undefined }
    }
  }
}

describe('node-agent SecretProvider sidecar lifecycle failure modes', () => {
  it('resolves NetBird infrastructure and sidecar credential refs through SecretProvider', async () => {
    const writes: string[] = []
    const result = await applySidecarDesiredState(
      {
        nodeId: 'node-1',
        correlationId: 'corr-1',
        observedAt: '2026-07-01T00:00:00.000Z',
        desired: desiredSidecar,
        runtimeMap: { networkId: 'network-1', mapVersion: 1 }
      },
      {
        deploymentConfig,
        secretManager: managerWithSecrets({
          'netbird/signal/test': 'signal-secret',
          'netbird/relay/test': 'relay-secret',
          'netbird/stun/test': 'stun-secret',
          'netbird/sidecar/test': 'sidecar-secret'
        }),
        env: { MERISTEM_NODE_AGENT_SIDECAR_CONFIG_PATH: '/tmp/sidecar.json' },
        async mkdir() {},
        async writeTextFile(_path, contents) {
          writes.push(contents)
        },
        async spawnProcess() {
          return { pid: 42_001 }
        },
        isProcessRunning: () => true,
        async runCommand() {
          return { exitCode: 0, stdout: 'connected', stderr: '' }
        }
      }
    )

    expect(result.runtimeStatus.kind).toBe('healthy')
    expect(result.runtimeStatus.dependencies).toEqual({
      signal: 'ready',
      relay: 'ready',
      stun: 'ready'
    })
    expect(result.runtimeStatus.credentialRef).toEqual({
      provider: 'runtime',
      keyPath: 'netbird/sidecar/test'
    })
    expect(result.process.processRef).toBe('sidecar:node-1:1')
    expect(writes).toHaveLength(1)
    expect(writes.join('\n')).not.toContain('sidecar-secret')
  })

  it('degrades without spawning when the NetBird sidecar credential is missing', async () => {
    const writes: string[] = []
    const result = await applySidecarDesiredState(
      {
        nodeId: 'node-1',
        correlationId: 'corr-2',
        observedAt: '2026-07-01T00:00:00.000Z',
        desired: desiredSidecar,
        runtimeMap: { networkId: 'network-1', mapVersion: 2 }
      },
      {
        deploymentConfig,
        secretManager: managerWithSecrets({
          'netbird/signal/test': 'signal-secret',
          'netbird/relay/test': 'relay-secret',
          'netbird/stun/test': 'stun-secret'
        }),
        async mkdir() {},
        async writeTextFile(_path, contents) {
          writes.push(contents)
        }
      }
    )

    expect(result.runtimeStatus.kind).toBe('degraded')
    expect(result.runtimeStatus.degradedReasons).toEqual([
      {
        code: 'secret.missing',
        message: 'sidecar secret resolution failed',
        detail: 'secret_missing'
      }
    ])
    expect(result.process.processRef).toBeUndefined()
    expect(writes).toHaveLength(0)
  })
})
