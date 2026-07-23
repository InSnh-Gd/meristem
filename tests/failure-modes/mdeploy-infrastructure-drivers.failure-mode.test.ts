import { describe, expect, it } from 'bun:test'
import {
  renderComposeCompatibility,
  renderOpenTofuModuleInput,
  renderPodmanQuadlets
} from '../../services/m-deploy/src/infrastructure-driver-renderers.ts'

const digest = {
  algorithm: 'sha256',
  value: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
} as const

function desiredState(): Record<string, unknown> {
  return {
    schemaVersion: 'mdeploy.desired-state@0.1.0',
    source: {
      repositoryUrl: 'https://git.example/desired-state.git',
      branch: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'deploy/production',
      digest,
      syncedAt: '2026-07-21T00:00:00.000Z'
    },
    runtime: { driver: 'podman', iacDriver: 'opentofu', targetScope: ['production'] },
    topology: {
      topologyId: 'production-validation',
      revision: 'fixture-1',
      nodes: [
        {
          nodeId: 'node-1',
          hostId: 'host-1',
          role: 'controller',
          runtimeDriver: 'podman'
        }
      ]
    },
    services: [
      {
        serviceId: 'm-deploy',
        image: { image: 'registry.example/meristem/m-deploy', digest },
        config: { MERISTEM_LOG_LEVEL: { kind: 'plain', value: 'info' } },
        secretRefs: []
      }
    ],
    generatedAt: '2026-07-21T00:00:00.000Z'
  }
}

describe('M-Deploy infrastructure driver failure modes', () => {
  it('rejects literal secrets before calling any output boundary', () => {
    const unsafe = desiredState()
    const services = unsafe.services as Array<Record<string, unknown>>
    const first = services[0]
    if (!first) throw new Error('expected service fixture')
    first.config = {
      DATABASE_PASSWORD: { kind: 'plain', value: 'plaintext-must-never-render' }
    }

    const result = renderPodmanQuadlets(unsafe)

    expect(result).toMatchObject({ ok: false, error: { code: 'literal_secret_rejected' } })
    expect(JSON.stringify(result)).not.toContain('plaintext-must-never-render')
  })

  it('rejects Docker desired state at the production Podman boundary', () => {
    const wrongRuntime = desiredState()
    wrongRuntime.runtime = {
      driver: 'docker',
      iacDriver: 'opentofu',
      targetScope: ['production']
    }

    expect(renderPodmanQuadlets(wrongRuntime)).toMatchObject({
      ok: false,
      error: { code: 'runtime_driver_mismatch' }
    })
  })

  it('rejects Podman desired state at the Compose compatibility boundary', () => {
    expect(renderComposeCompatibility(desiredState())).toMatchObject({
      ok: false,
      error: { code: 'runtime_driver_mismatch' }
    })
  })

  it('rejects mutable or malformed image digests', () => {
    const mutable = desiredState()
    const services = mutable.services as Array<Record<string, unknown>>
    const first = services[0]
    if (!first) throw new Error('expected service fixture')
    first.image = {
      image: 'registry.example/meristem/m-deploy:latest',
      digest: { algorithm: 'sha256', value: 'not-a-digest' }
    }

    expect(renderPodmanQuadlets(mutable)).toMatchObject({
      ok: false,
      error: { code: 'mutable_image_reference' }
    })
  })

  it('rejects malformed desired state before any runtime file can be rendered', () => {
    expect(renderPodmanQuadlets({ services: [] })).toMatchObject({
      ok: false,
      error: { code: 'desired_state_invalid' }
    })
  })

  it('rejects invalid neutral topology counts and non-Podman fixture nodes', () => {
    const invalid = {
      schemaVersion: 'mdeploy.infrastructure-topology@0.1.0',
      topologyId: 'invalid',
      revision: 'fixture-1',
      network: { networkId: 'meristem-production', cidr: '10.77.0.0/24' },
      nodes: [
        {
          nodeId: 'control-state-1',
          workloadClass: 'control-state',
          failureDomain: 'rack-1',
          resources: { vcpu: 4, memoryMiB: 8192, diskGiB: 100 },
          runtimeDriver: 'docker'
        }
      ]
    }

    expect(renderOpenTofuModuleInput(invalid)).toMatchObject({
      ok: false,
      error: { code: 'topology_invalid' }
    })
  })
})
