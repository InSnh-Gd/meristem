import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import type {
  MDeployDesiredStateDocumentV01FromSchema,
  MDeployInfrastructureTopologyV01FromSchema
} from '../../../packages/contracts/src/index.ts'
import {
  createOpenTofuDriver,
  createPodmanRuntimeDriver,
  probePodmanRuntimeHealth
} from '../../../services/m-deploy/src/infrastructure-driver-adapters.ts'
import {
  deriveMDeployRuntimeHealth,
  renderComposeCompatibility,
  renderOpenTofuModuleInput,
  renderPodmanQuadlets,
  reportMDeployRuntimeDrift
} from '../../../services/m-deploy/src/infrastructure-driver-renderers.ts'
import { resolveMDeployRuntimeAdapter } from '../../../services/m-deploy/src/production.ts'

const digest = {
  algorithm: 'sha256',
  value: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
} as const

function topology(): MDeployInfrastructureTopologyV01FromSchema {
  const nodes = [
    ...Array.from({ length: 3 }, (_, index) => ({
      nodeId: `control-state-${index + 1}`,
      workloadClass: 'control-state' as const,
      failureDomain: `rack-${index + 1}`,
      resources: { vcpu: 4, memoryMiB: 8192, diskGiB: 100 },
      runtimeDriver: 'podman' as const
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      nodeId: `search-${index + 1}`,
      workloadClass: 'search' as const,
      failureDomain: `rack-${index + 1}`,
      resources: { vcpu: 8, memoryMiB: 16384, diskGiB: 500 },
      runtimeDriver: 'podman' as const
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      nodeId: `leaf-${index + 1}`,
      workloadClass: 'leaf' as const,
      failureDomain: `edge-${index + 1}`,
      resources: { vcpu: 2, memoryMiB: 4096, diskGiB: 50 },
      runtimeDriver: 'podman' as const
    }))
  ]
  return {
    schemaVersion: 'mdeploy.infrastructure-topology@0.1.0',
    topologyId: 'production-validation',
    revision: 'fixture-1',
    network: { networkId: 'meristem-production', cidr: '10.77.0.0/24' },
    nodes
  }
}

function desiredState(
  runtimeDriver: 'podman' | 'docker' = 'podman'
): MDeployDesiredStateDocumentV01FromSchema {
  return {
    schemaVersion: 'mdeploy.desired-state@0.1.0',
    source: {
      repositoryUrl: 'https://git.example/meristem/desired-state.git',
      branch: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'deploy/production',
      digest,
      syncedAt: '2026-07-21T00:00:00.000Z'
    },
    runtime: {
      driver: runtimeDriver,
      iacDriver: 'opentofu',
      targetScope: ['production']
    },
    topology: {
      topologyId: 'production-validation',
      revision: 'fixture-1',
      nodes: [
        {
          nodeId: 'control-state-1',
          hostId: 'host-1',
          role: 'controller',
          runtimeDriver
        }
      ]
    },
    services: [
      {
        serviceId: 'm-deploy',
        image: { image: 'registry.example/meristem/m-deploy', digest },
        config: {
          MERISTEM_LOG_LEVEL: { kind: 'plain', value: 'info' },
          MERISTEM_INTERNAL_TOKEN: {
            kind: 'secretRef',
            secretRef: {
              provider: 'vault-kv-v2',
              keyPath: 'secret/data/mdeploy/internal-token',
              version: 7
            }
          }
        },
        secretRefs: []
      }
    ],
    generatedAt: '2026-07-21T00:00:00.000Z'
  }
}

describe('M-Deploy provider-neutral IaC and runtime drivers', () => {
  it('renders the 3 control/state + 3 search + 2 leaf topology through a neutral module input', () => {
    const result = renderOpenTofuModuleInput(topology())

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.topology.nodes).toHaveLength(8)
    expect(
      result.value.topology.nodes.filter(node => node.workloadClass === 'control-state')
    ).toHaveLength(3)
    expect(
      result.value.topology.nodes.filter(node => node.workloadClass === 'search')
    ).toHaveLength(3)
    expect(result.value.topology.nodes.filter(node => node.workloadClass === 'leaf')).toHaveLength(
      2
    )
    expect(JSON.stringify(result.value)).not.toMatch(/libvirt|aws|azure|gcp/i)
  })

  it('simulates OpenTofu plan then apply through injected command and file boundaries', async () => {
    const commands: string[] = []
    const writes: string[][] = []
    const driver = createOpenTofuDriver({
      async writeFiles(_root, files) {
        writes.push(files.map(file => file.path))
        return { ok: true, value: undefined }
      },
      async run(command, args) {
        commands.push([command, ...args].join(' '))
        return { ok: true, value: { stdout: '', stderr: '' } }
      }
    })

    const planned = await driver.plan({
      operationId: 'operation-1',
      topology: topology(),
      workDir: 'tests/evidence/mdeploy-opentofu-plan',
      checkedAt: '2026-07-21T00:01:00.000Z'
    })
    const applied = await driver.apply({
      operationId: 'operation-1',
      topology: topology(),
      workDir: 'tests/evidence/mdeploy-opentofu-plan',
      checkedAt: '2026-07-21T00:02:00.000Z'
    })

    expect(planned).toMatchObject({
      ok: true,
      value: { planStatus: 'planned', applyStatus: 'not_started' }
    })
    expect(applied).toMatchObject({
      ok: true,
      value: { planStatus: 'planned', applyStatus: 'succeeded' }
    })
    expect(writes).toEqual([['topology.auto.tfvars.json'], ['topology.auto.tfvars.json']])
    expect(commands).toEqual([
      'tofu plan -input=false -lock=false -out=mdeploy.tfplan',
      'tofu plan -input=false -lock=false -out=mdeploy.tfplan',
      'tofu apply -input=false -auto-approve mdeploy.tfplan'
    ])
  })

  it('renders rootless Quadlet/systemd as production and Compose as compatibility-only', () => {
    const quadlets = renderPodmanQuadlets(desiredState())
    const compose = renderComposeCompatibility(desiredState('docker'))

    expect(quadlets.ok).toBe(true)
    if (!quadlets.ok) throw new Error(quadlets.error.message)
    expect(quadlets.value.rootlessUnitDirectory).toBe('%h/.config/containers/systemd')
    expect(quadlets.value.files.map(file => file.path)).toContain('m-deploy.container')
    expect(quadlets.value.files.map(file => file.path)).toContain('meristem.target')
    expect(quadlets.value.files[0]?.content).toContain(
      `Image=registry.example/meristem/m-deploy@sha256:${digest.value}`
    )
    expect(quadlets.value.files[0]?.content).toContain('Secret=')
    expect(quadlets.value.files[0]?.content).not.toContain('plaintext')

    expect(compose.ok).toBe(true)
    if (!compose.ok) throw new Error(compose.error.message)
    expect(compose.value).toContain('io.meristem.runtime-class: compatibility')
    expect(compose.value).toContain('compatibility-only')
    expect(compose.value).not.toContain('production: true')
  })

  it('renders rollback state and invokes the user systemd runtime seam', async () => {
    const commands: string[] = []
    const writes: string[][] = []
    const driver = createPodmanRuntimeDriver({
      async writeFiles(root, files) {
        expect(root).toBe('%h/.config/containers/systemd')
        writes.push(files.map(file => file.path))
        return { ok: true, value: undefined }
      },
      async run(command, args) {
        commands.push([command, ...args].join(' '))
        return { ok: true, value: { stdout: '', stderr: '' } }
      }
    })
    const state = desiredState()
    const envelope = {
      schemaVersion: 'mdeploy.signed-envelope@0.1.0',
      payload: state,
      signature: { algorithm: 'ed25519', value: 'signed', payloadDigest: digest },
      signer: { kind: 'mdeploy-controller', identity: 'controller' },
      issuedAt: '2026-07-21T00:00:00.000Z',
      expiresAt: '2026-07-21T00:15:00.000Z',
      verification: {
        verified: true,
        verifiedAt: '2026-07-21T00:00:01.000Z',
        verifier: 'trusted-verifier'
      }
    } as const
    const agent = {
      enrollment: {
        schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
        agentId: 'agent-1',
        hostId: 'host-1',
        capabilities: [{ runtimeDriver: 'podman', version: '5.0.0', features: ['quadlet'] }],
        controllerTrust: {
          issuer: 'controller',
          audience: 'agent',
          publicKeyFingerprint: 'sha256:test',
          expiresAt: '2026-07-22T00:00:00.000Z'
        },
        enrolledAt: '2026-07-21T00:00:00.000Z'
      }
    } as const

    const rolledBack = await driver.rollback({ agent, envelope, correlationId: 'corr-rollback' })

    expect(rolledBack).toEqual({ ok: true, value: undefined })
    expect(writes).toHaveLength(1)
    expect(commands).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user restart meristem.target'
    ])
  })

  it('maps static runtime health and reports digest drift', () => {
    const health = deriveMDeployRuntimeHealth({
      agentId: 'agent-1',
      hostId: 'host-1',
      runtimeAvailable: true,
      unitManagerAvailable: false,
      immutableImageVerified: true,
      appliedImageDigest: digest,
      checkedAt: '2026-07-21T00:03:00.000Z'
    })
    const drift = reportMDeployRuntimeDrift({
      reportId: 'drift-1',
      agentId: 'agent-1',
      expectedDigest: digest,
      actualDigest: { ...digest, value: 'f'.repeat(64) },
      timestamp: '2026-07-21T00:03:00.000Z'
    })

    expect(health.health).toBe('degraded')
    expect(health.runtime.runtimeDriver).toBe('podman')
    expect(drift).toMatchObject({ driftType: 'artifact_digest', severity: 'high' })
  })

  it('maps unavailable Podman tooling to a typed runtime health failure', async () => {
    const health = await probePodmanRuntimeHealth(
      {
        async writeFiles() {
          return { ok: true, value: undefined }
        },
        async run() {
          return {
            ok: false,
            error: {
              code: 'external_tool_unavailable' as const,
              message: 'podman was not found on this host'
            }
          }
        }
      },
      {
        agentId: 'agent-1',
        hostId: 'host-1',
        immutableImageVerified: true,
        checkedAt: '2026-07-21T00:04:00.000Z'
      }
    )

    expect(health).toMatchObject({
      ok: false,
      error: { code: 'external_tool_unavailable' }
    })
  })

  it('connects explicit local driver effects to the production runtime adapter boundary', () => {
    const runtime = resolveMDeployRuntimeAdapter({
      git: {
        async fetchSignedEnvelope() {
          return {
            ok: false,
            error: { code: 'git.unavailable', message: 'not used in this seam test' }
          }
        }
      },
      agentIdentity: {
        async verifyEnrollment() {
          return { ok: true, value: undefined }
        }
      },
      controller: {
        async isAvailable() {
          return true
        }
      },
      infrastructureDriverEffects: {
        async writeFiles() {
          return { ok: true, value: undefined }
        },
        async run() {
          return { ok: true, value: { stdout: '', stderr: '' } }
        }
      }
    })

    expect(typeof runtime.apply).toBe('function')
    expect(typeof runtime.rollback).toBe('function')
  })

  it('keeps the libvirt fixture provider-specific, gated, and free of remote-control behavior', async () => {
    const fixtureRoot = join(import.meta.dir, '../../../ops/m-deploy/open-tofu/libvirt')
    const [main, variables, readme] = await Promise.all(
      ['main.tf', 'variables.tf', 'README.md'].map(file => Bun.file(join(fixtureRoot, file)).text())
    )

    expect(main).toContain('enable_libvirt_resources ? 1 : 0')
    expect(variables).toContain('mdeploy.opentofu-module-input@0.1.0')
    expect(readme).toContain('enable_libvirt_resources` defaults to `false`')
    expect(`${main}\n${variables}`).not.toMatch(/\bssh\b|remote shell|password=/i)
    expect(readme).toContain('never transfers secrets or establishes SSH access')
  })
})
