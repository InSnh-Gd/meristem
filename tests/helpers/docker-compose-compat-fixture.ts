import type {
  MDeployDesiredStateDocumentV01FromSchema,
  MDeployDigestFromSchema
} from '../../packages/contracts/src/index.ts'
import { renderComposeCompatibility } from '../../services/m-deploy/src/infrastructure-driver-renderers.ts'

type DockerComposeCommandResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

type DockerComposeCli =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string }

type DockerComposeLiveFixture =
  | {
      readonly available: true
      readonly image: {
        readonly image: string
        readonly digest: MDeployDigestFromSchema
      }
    }
  | { readonly available: false; readonly reason: string }

type ComposeFixtureOptions = {
  readonly image?: {
    readonly image: string
    readonly digest: MDeployDigestFromSchema
  }
  readonly includeSecretRef: boolean
}

const defaultImage = {
  image: 'docker.io/library/alpine',
  digest: {
    algorithm: 'sha256',
    value: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  }
} as const satisfies ComposeFixtureOptions['image']

export const dockerComposeServiceId = 'mdeploy-compose-proof'

export function dockerComposeCompatibilityFixture(options: ComposeFixtureOptions): {
  readonly serviceId: string
  readonly desiredState: MDeployDesiredStateDocumentV01FromSchema
  readonly manifest: string
} {
  const desiredState = dockerComposeDesiredState(options)
  const rendered = renderComposeCompatibility(desiredState)
  if (!rendered.ok)
    throw new Error(`render Docker Compose compatibility manifest: ${rendered.error.message}`)
  return { serviceId: dockerComposeServiceId, desiredState, manifest: rendered.value }
}

export function dockerComposeDesiredState(
  options: ComposeFixtureOptions
): MDeployDesiredStateDocumentV01FromSchema {
  const image = options.image ?? defaultImage
  return {
    schemaVersion: 'mdeploy.desired-state@0.1.0',
    source: {
      repositoryUrl: 'https://git.example/meristem/desired-state.git',
      branch: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'deploy/compatibility',
      digest: image.digest,
      syncedAt: '2026-07-24T00:00:00.000Z'
    },
    runtime: { driver: 'docker', iacDriver: 'disabled', targetScope: ['compatibility'] },
    topology: {
      topologyId: 'docker-compose-compatibility-proof',
      revision: 'docker-compose-compatibility-1',
      nodes: [
        {
          nodeId: 'compose-host-1',
          hostId: 'compose-host-1',
          role: 'controller',
          runtimeDriver: 'docker'
        }
      ]
    },
    services: [
      {
        serviceId: dockerComposeServiceId,
        image,
        config: {
          MERISTEM_LOG_LEVEL: { kind: 'plain', value: 'info' },
          ...(options.includeSecretRef
            ? {
                MERISTEM_DATABASE_PASSWORD: {
                  kind: 'secretRef' as const,
                  secretRef: {
                    provider: 'vault',
                    keyPath: 'meristem/compatibility/database-password',
                    version: 1
                  }
                }
              }
            : {})
        },
        secretRefs: []
      }
    ],
    generatedAt: '2026-07-24T00:00:00.000Z'
  }
}

export async function detectDockerComposeCli(): Promise<DockerComposeCli> {
  const version = await runDockerCompose(['version', '--short'])
  return version.exitCode === 0
    ? { available: true }
    : {
        available: false,
        reason: version.stderr.trim() || 'Docker Compose CLI is unavailable'
      }
}

export async function runDockerCompose(
  args: readonly string[]
): Promise<DockerComposeCommandResult> {
  return await runProcess('docker', ['compose', ...args])
}

async function runDocker(args: readonly string[]): Promise<DockerComposeCommandResult> {
  return await runProcess('docker', args)
}

async function runProcess(
  command: string,
  args: readonly string[]
): Promise<DockerComposeCommandResult> {
  try {
    const subprocess = Bun.spawn([command, ...args], { stdout: 'pipe', stderr: 'pipe' })
    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited,
      readText(subprocess.stdout),
      readText(subprocess.stderr)
    ])
    return { exitCode, stdout, stderr }
  } catch (cause) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: cause instanceof Error ? cause.message : String(cause)
    }
  }
}

async function readText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  return stream ? await new Response(stream).text() : ''
}

async function detectDockerComposeLiveFixture(): Promise<DockerComposeLiveFixture> {
  if (process.env.MERISTEM_MDEPLOY_DOCKER_COMPOSE_PROOF !== '1') {
    return {
      available: false,
      reason: 'set MERISTEM_MDEPLOY_DOCKER_COMPOSE_PROOF=1 to run the live Docker Compose smoke'
    }
  }

  const daemon = await runDocker(['version', '--format', '{{.Server.Version}}'])
  if (daemon.exitCode !== 0 || daemon.stdout.trim().length === 0) {
    return { available: false, reason: 'Docker daemon is unavailable' }
  }

  const image = await runDocker([
    'image',
    'inspect',
    'docker.io/library/alpine:3.20',
    '--format',
    '{{index .RepoDigests 0}}'
  ])
  const pinnedImage = image.exitCode === 0 ? parsePinnedImage(image.stdout) : null
  return pinnedImage
    ? { available: true, image: pinnedImage }
    : {
        available: false,
        reason: 'a local digest-pinned docker.io/library/alpine:3.20 image is unavailable'
      }
}

function parsePinnedImage(value: string): {
  readonly image: string
  readonly digest: MDeployDigestFromSchema
} | null {
  const pinnedImage = value.trim()
  const separator = pinnedImage.lastIndexOf('@')
  if (separator <= 0 || separator !== pinnedImage.indexOf('@')) return null

  const image = pinnedImage.slice(0, separator)
  const digest = pinnedImage.slice(separator + 1)
  const match = /^(sha256|sha512):([a-f0-9]+)$/.exec(digest)
  if (!match) return null
  const algorithm = match[1]
  const digestValue = match[2]
  if ((algorithm !== 'sha256' && algorithm !== 'sha512') || digestValue === undefined) return null
  const expectedLength = algorithm === 'sha256' ? 64 : 128
  if (digestValue.length !== expectedLength) return null
  return { image, digest: { algorithm, value: digestValue } }
}

export const dockerComposeLiveFixture = await detectDockerComposeLiveFixture()
