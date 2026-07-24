import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectDockerComposeCli,
  dockerComposeCompatibilityFixture,
  dockerComposeLiveFixture,
  runDockerCompose
} from '../helpers/docker-compose-compat-fixture.ts'

const dockerComposeCli = await detectDockerComposeCli()

describe('integration: Docker Compose compatibility proof', () => {
  test('renders a compatibility-only manifest from versioned M-Deploy desired state', () => {
    const fixture = dockerComposeCompatibilityFixture({ includeSecretRef: true })

    expect(fixture.desiredState.schemaVersion).toBe('mdeploy.desired-state@0.1.0')
    expect(fixture.desiredState.runtime).toEqual({
      driver: 'docker',
      iacDriver: 'disabled',
      targetScope: ['compatibility']
    })
    expect(fixture.manifest).toContain('name: meristem-compatibility-only')
    expect(fixture.manifest).toContain('io.meristem.runtime-class: compatibility')
    expect(fixture.manifest).toContain('io.meristem.compatibility-only: "true"')
    expect(fixture.manifest).toContain('secrets:')
    expect(fixture.manifest).toContain('external: true')
    expect(fixture.manifest).not.toContain('quadlet-systemd')
    expect(fixture.manifest).not.toContain('[Unit]')
  })

  test.skipIf(!dockerComposeCli.available)(
    'passes Docker Compose static validation without contacting the Docker daemon',
    async () => {
      const fixture = dockerComposeCompatibilityFixture({ includeSecretRef: true })
      const manifestRoot = await mkdtemp(join(tmpdir(), 'meristem-docker-compose-config-'))
      const manifestPath = join(manifestRoot, 'compose.yaml')

      try {
        await writeFile(manifestPath, fixture.manifest)
        const validation = await runDockerCompose(['-f', manifestPath, 'config', '--quiet'])

        expect(validation.exitCode).toBe(0)
      } finally {
        await rm(manifestRoot, { recursive: true, force: true })
      }
    }
  )

  test.skipIf(!dockerComposeLiveFixture.available)(
    'runs the minimal compatibility smoke only against an available local Docker image',
    async () => {
      if (!dockerComposeLiveFixture.available) {
        throw new Error(dockerComposeLiveFixture.reason)
      }
      const fixture = dockerComposeCompatibilityFixture({
        image: dockerComposeLiveFixture.image,
        includeSecretRef: false
      })
      const projectName = `meristem-compose-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
      const manifestRoot = await mkdtemp(join(tmpdir(), 'meristem-docker-compose-smoke-'))
      const manifestPath = join(manifestRoot, 'compose.yaml')

      try {
        await writeFile(manifestPath, fixture.manifest)
        const smoke = await runDockerCompose([
          '--project-name',
          projectName,
          '-f',
          manifestPath,
          'up',
          '--abort-on-container-exit',
          '--exit-code-from',
          fixture.serviceId
        ])

        expect(smoke.exitCode).toBe(0)
      } finally {
        await runDockerCompose([
          '--project-name',
          projectName,
          '-f',
          manifestPath,
          'down',
          '--volumes',
          '--remove-orphans'
        ])
        await rm(manifestRoot, { recursive: true, force: true })
      }
    },
    30_000
  )
})
