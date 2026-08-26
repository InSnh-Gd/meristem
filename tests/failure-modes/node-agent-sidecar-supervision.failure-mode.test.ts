import { describe, expect, it } from 'bun:test'
import type {
  DeploymentConfigV02FromSchema,
  NodeAgentRuntimeDesiredSidecar
} from '../../packages/contracts/src/index.ts'
import type { SecretManager } from '../../packages/secrets/src/index.ts'
import { applySidecarDesiredState } from '../../services/node-agent/src/node-agent-sidecar-lifecycle-operations.ts'
import {
  resolveNetBirdLaunchConfig,
  stopSidecarProcessIfRunning
} from '../../services/node-agent/src/node-agent-sidecar-process-supervision.ts'

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
  internalAuth: { headerName: 'x-meristem-internal-token', tokenEnvVar: 'MERISTEM_INTERNAL_TOKEN' },
  oidc: {
    provider: 'oidc',
    issuer: 'https://keycloak.test/realms/meristem',
    audiences: ['meristem-core']
  },
  secretProvider: {
    providerName: 'runtime',
    backend: 'local-dev-env',
    namedProvider: { name: 'runtime', config: { backend: 'local-dev-env', envMappings: {} } }
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
    uiBff: { kind: 'http-get', target: 'uiBff', endpoint: '/ready' },
    nodeAgent: { kind: 'http-get', target: 'node-agent', endpoint: '/ready' }
  }
}

const desired: NodeAgentRuntimeDesiredSidecar = {
  desiredState: 'start',
  credentialStatus: 'ready',
  healthStatus: 'healthy',
  signalConfigRef: { configRef: 'netbird/signal' },
  relayConfigRef: { configRef: 'netbird/relay' },
  stunConfigRef: { configRef: 'netbird/stun' },
  sidecarCredentialRef: { provider: 'runtime', keyPath: 'netbird/sidecar' }
}

function secretManager(values: Readonly<Record<string, string>>): SecretManager {
  return {
    async read(ref) {
      const value = values[ref.keyPath]
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
      return { ok: true as const, value: [] }
    },
    async write() {
      return { ok: true as const, value: undefined }
    }
  }
}

function lifecycleInput() {
  return {
    nodeId: 'node-sidecar-guard',
    correlationId: 'corr-sidecar-guard',
    observedAt: '2026-08-01T00:00:00.000Z',
    desired,
    runtimeMap: { networkId: 'network-sidecar-guard', mapVersion: 1 }
  }
}

describe('node-agent sidecar supervision fail-closed guards', () => {
  it('rejects invalid launch configuration and never kills an absent process', async () => {
    expect(
      resolveNetBirdLaunchConfig({
        env: { MERISTEM_NETBIRD_BINARY_PATH: '' },
        deploymentConfig,
        setupKey: 'setup-key'
      })
    ).toMatchObject({ ok: false, reason: { code: 'netbird.binary.invalid' } })
    expect(
      resolveNetBirdLaunchConfig({ env: {}, deploymentConfig, setupKey: undefined })
    ).toMatchObject({ ok: false, reason: { code: 'netbird.setup_key.missing' } })

    let killCount = 0
    await stopSidecarProcessIfRunning(
      {
        async killProcess() {
          killCount += 1
        }
      },
      undefined
    )
    expect(killCount).toBe(0)
  })

  it('fails closed before rendering or spawning when infrastructure or sidecar secrets are unavailable', async () => {
    const writes: string[] = []
    const spawns: string[] = []
    const unavailableInfrastructure = await applySidecarDesiredState(lifecycleInput(), {
      deploymentConfig,
      secretManager: secretManager({}),
      async writeTextFile(_path, contents) {
        writes.push(contents)
      },
      async spawnProcess(command) {
        spawns.push(command.join(' '))
        return { pid: 100 }
      }
    })
    expect(unavailableInfrastructure.runtimeStatus.degradedReasons).toEqual([
      {
        code: 'secret.missing',
        message: 'infrastructure secret resolution failed',
        detail: 'secret_missing'
      }
    ])
    expect(writes).toEqual([])
    expect(spawns).toEqual([])

    const unavailableSidecar = await applySidecarDesiredState(lifecycleInput(), {
      deploymentConfig,
      secretManager: secretManager({
        'netbird/signal': 'signal',
        'netbird/relay': 'relay',
        'netbird/stun': 'stun'
      }),
      async writeTextFile(_path, contents) {
        writes.push(contents)
      },
      async spawnProcess(command) {
        spawns.push(command.join(' '))
        return { pid: 101 }
      }
    })
    expect(unavailableSidecar.runtimeStatus.degradedReasons).toEqual([
      {
        code: 'secret.missing',
        message: 'sidecar secret resolution failed',
        detail: 'secret_missing'
      }
    ])
    expect(writes).toEqual([])
    expect(spawns).toEqual([])
  })

  it('reports spawn and probe failures as degraded rather than healthy forwarding', async () => {
    const allSecrets = {
      'netbird/signal': 'signal',
      'netbird/relay': 'relay',
      'netbird/stun': 'stun',
      'netbird/sidecar': 'sidecar-key'
    }
    const spawnFailure = await applySidecarDesiredState(lifecycleInput(), {
      deploymentConfig,
      secretManager: secretManager(allSecrets),
      async mkdir() {},
      async writeTextFile() {},
      async spawnProcess() {
        throw new Error('sidecar executable unavailable')
      }
    })
    expect(spawnFailure.runtimeStatus).toMatchObject({
      kind: 'degraded',
      degradedReasons: [expect.objectContaining({ code: 'netbird.start_failed' })]
    })

    const probeFailure = await applySidecarDesiredState(lifecycleInput(), {
      deploymentConfig,
      secretManager: secretManager(allSecrets),
      async mkdir() {},
      async writeTextFile() {},
      async spawnProcess() {
        return { pid: 102 }
      },
      isProcessRunning: () => false
    })
    expect(probeFailure.runtimeStatus).toMatchObject({
      kind: 'degraded',
      degradedReasons: [expect.objectContaining({ code: 'netbird.process.not_running' })]
    })
  })
})
