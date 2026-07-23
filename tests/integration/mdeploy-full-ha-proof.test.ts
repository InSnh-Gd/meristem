import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MDeployDigestFromSchema } from '../../packages/contracts/src/index.ts'
import {
  createPodmanRuntimeDriver,
  probePodmanRuntimeHealth
} from '../../services/m-deploy/src/infrastructure-driver-adapters.ts'
import {
  renderOpenTofuModuleInput,
  renderPodmanQuadlets
} from '../../services/m-deploy/src/infrastructure-driver-renderers.ts'
import {
  createLiveDriverEffects,
  deploymentState,
  expectSuccess,
  fixtureAgent,
  fullHaTopology,
  liveFixture,
  parseDigest,
  removeContainer,
  respondsToHealth,
  rootlessUnitDirectory,
  runCommand,
  signedEnvelope,
  startHealthContainer,
  stopAndInspectContainer
} from '../helpers/mdeploy-full-ha-fixture.ts'
import { waitForHttpOk, waitForReadyJson } from '../helpers/wait.ts'

describe('integration: M-Deploy Podman-first Full HA proof', () => {
  test('renders the libvirt 3 control/state + 3 search + 2 leaf fixture into ordered Quadlets', async () => {
    const topology = fullHaTopology()
    const moduleInput = renderOpenTofuModuleInput(topology)
    const fixtureVariables = await Bun.file(
      join(import.meta.dir, '../../ops/m-deploy/open-tofu/libvirt/variables.tf')
    ).text()
    const digest: MDeployDigestFromSchema = {
      algorithm: 'sha256',
      value: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    }
    const quadlets = renderPodmanQuadlets(
      deploymentState(['mdeploy-api', 'mdeploy-worker'], digest)
    )

    expect(moduleInput.ok).toBe(true)
    if (!moduleInput.ok) throw new Error(moduleInput.error.message)
    expect(fixtureVariables).toContain('length(var.topology.nodes) == 8')
    expect(fixtureVariables).toContain('node.runtimeDriver == "podman"')
    expect(moduleInput.value.topology.nodes).toHaveLength(8)
    for (const [workloadClass, count] of [
      ['control-state', 3],
      ['search', 3],
      ['leaf', 2]
    ] as const) {
      expect(
        moduleInput.value.topology.nodes.filter(node => node.workloadClass === workloadClass)
      ).toHaveLength(count)
    }

    expect(quadlets.ok).toBe(true)
    if (!quadlets.ok) throw new Error(quadlets.error.message)
    expect(quadlets.value.runtimeDriver).toBe('podman')
    expect(quadlets.value.unitManager).toBe('quadlet-systemd')
    expect(quadlets.value.rootlessUnitDirectory).toBe(rootlessUnitDirectory)
    const target = quadlets.value.files.find(file => file.path === 'meristem.target')
    expect(target?.content).toContain('Wants=mdeploy-api.service mdeploy-worker.service')
    expect(target?.content).toContain('After=network-online.target')
  })

  test.skipIf(!liveFixture.available)(
    'uses real Podman and user-systemd interfaces for lifecycle, health, and no-gap replacement',
    async () => {
      if (!liveFixture.available) throw new Error(liveFixture.reason)
      const serviceId = `mdeploy-proof-${crypto.randomUUID().slice(0, 12)}`
      const containerA = `${serviceId}-a`
      const containerB = `${serviceId}-b`
      const evidenceRoot = await mkdtemp(join(tmpdir(), 'meristem-mdeploy-full-ha-proof-'))
      const availability: boolean[] = []
      let keepCheckingAvailability = false
      let firstEndpoint = ''
      let secondEndpoint = ''

      try {
        const agent = fixtureAgent()
        const effects = createLiveDriverEffects(
          liveFixture.quadletDirectory,
          liveFixture.systemdUnitDirectory
        )
        const runtime = createPodmanRuntimeDriver(effects)
        const digest = parseDigest(liveFixture.image.slice(liveFixture.image.lastIndexOf('@') + 1))
        if (!digest) throw new Error('live fixture image did not retain an immutable digest')
        const state = deploymentState([serviceId], digest)
        expect(
          await runtime.apply({
            agent,
            envelope: signedEnvelope(state),
            correlationId: `corr-${serviceId}`
          })
        ).toEqual({ ok: true, value: undefined })

        expect(
          await probePodmanRuntimeHealth(effects, {
            agentId: agent.enrollment.agentId,
            hostId: agent.enrollment.hostId,
            immutableImageVerified: true,
            appliedImageDigest: digest,
            checkedAt: state.generatedAt
          })
        ).toMatchObject({
          ok: true,
          value: {
            health: 'healthy',
            checks: {
              runtimeAvailable: true,
              unitManagerAvailable: true,
              immutableImageVerified: true
            }
          }
        })

        const target = expectSuccess(
          await runCommand('systemctl', [
            '--user',
            'show',
            'meristem.target',
            '--property=Wants',
            '--property=After'
          ]),
          'inspect generated Meristem target ordering'
        ).stdout
        expect(target).toContain(`Wants=${serviceId}.service`)
        const after = target.split('\n').find(line => line.startsWith('After='))
        expect(after).toContain(`${serviceId}.service`)
        expect(after).toContain('network-online.target')

        firstEndpoint = await startHealthContainer(containerA, liveFixture.image)
        await waitForHttpOk({
          url: `${firstEndpoint}/health`,
          label: 'first Podman replica health endpoint',
          timeoutMs: 5_000,
          intervalMs: 50
        })
        await waitForReadyJson({
          url: `${firstEndpoint}/ready`,
          label: 'first Podman replica ready endpoint',
          timeoutMs: 5_000,
          intervalMs: 50
        })

        keepCheckingAvailability = true
        const availabilityLoop = (async () => {
          while (keepCheckingAvailability) {
            const checks = await Promise.all([
              respondsToHealth(firstEndpoint),
              secondEndpoint === '' ? Promise.resolve(false) : respondsToHealth(secondEndpoint)
            ])
            availability.push(checks.some(Boolean))
            await Bun.sleep(25)
          }
        })()

        try {
          secondEndpoint = await startHealthContainer(containerB, liveFixture.image)
          await waitForHttpOk({
            url: `${secondEndpoint}/health`,
            label: 'replacement Podman replica health endpoint',
            timeoutMs: 5_000,
            intervalMs: 50
          })
          await waitForReadyJson({
            url: `${secondEndpoint}/ready`,
            label: 'replacement Podman replica ready endpoint',
            timeoutMs: 5_000,
            intervalMs: 50
          })
          await stopAndInspectContainer(containerA)
          await waitForHttpOk({
            url: `${secondEndpoint}/health`,
            label: 'replacement health after original shutdown',
            timeoutMs: 5_000,
            intervalMs: 50
          })
        } finally {
          keepCheckingAvailability = false
          await availabilityLoop
        }

        expect(availability.length).toBeGreaterThan(0)
        expect(availability).not.toContain(false)
        await stopAndInspectContainer(containerB)

        const evidencePath = join(evidenceRoot, 'mdeploy-full-ha-proof.json')
        await writeFile(
          evidencePath,
          JSON.stringify({
            proof: 'mdeploy-full-ha',
            topology: { controlState: 3, search: 3, leaf: 2 },
            runtime: { driver: 'podman', unitManager: 'quadlet-systemd' },
            lifecycle: ['created', 'running', 'exited'],
            healthEndpoints: ['/health', '/ready'],
            restartAvailabilitySamples: availability.length,
            restartAvailabilityGapObserved: false
          })
        )
        expect(await Bun.file(evidencePath).text()).toContain(
          '"restartAvailabilityGapObserved":false'
        )
      } finally {
        keepCheckingAvailability = false
        await removeContainer(containerA)
        await removeContainer(containerB)
        await runCommand('systemctl', ['--user', 'stop', 'meristem.target'])
        await runCommand('systemctl', ['--user', 'stop', `${serviceId}.service`])
        await removeContainer(`meristem-${serviceId}`)
        await runCommand('systemctl', ['--user', 'reset-failed', `${serviceId}.service`])
        await rm(join(liveFixture.quadletDirectory, `${serviceId}.container`), { force: true })
        await rm(join(liveFixture.systemdUnitDirectory, 'meristem.target'), { force: true })
        await runCommand('systemctl', ['--user', 'daemon-reload'])
        await rm(evidenceRoot, { recursive: true, force: true })
      }
    },
    30_000
  )
})
