import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { err, ok, type Result } from '../../packages/common/src/result.ts'
import type {
  MDeployAgentEnrollmentV01FromSchema,
  MDeployDesiredStateDocumentV01FromSchema,
  MDeployDigestFromSchema,
  MDeployInfrastructureTopologyV01FromSchema,
  MDeploySignedEnvelopeV01FromSchema
} from '../../packages/contracts/src/index.ts'
import type { MDeployAgentRecord } from '../../services/m-deploy/src/deps.ts'
import type {
  MDeployDriverEffects,
  MDeployDriverError
} from '../../services/m-deploy/src/infrastructure-driver-types.ts'

export const rootlessUnitDirectory = '%h/.config/containers/systemd'
const healthPort = '8080'
const liveProofEnabled = process.env.MERISTEM_MDEPLOY_FULL_HA_PROOF === '1'
const healthServerProgram = [
  "const http = require('http')",
  'const server = http.createServer((request, response) => {',
  "  const healthy = request.url === '/health' || request.url === '/ready'",
  "  response.writeHead(healthy ? 200 : 404, { 'content-type': 'application/json' })",
  '  response.end(JSON.stringify({ ready: healthy }))',
  '})',
  "process.on('SIGTERM', () => server.close(() => process.exit(0)))",
  "server.listen(Number(process.env.PORT), '0.0.0.0')"
].join(';')

type CommandOutput = { readonly stdout: string; readonly stderr: string }
type CommandOptions = { readonly cwd?: string; readonly env?: Record<string, string | undefined> }
type LiveFixture =
  | {
      readonly available: true
      readonly image: string
      readonly quadletDirectory: string
      readonly systemdUnitDirectory: string
    }
  | { readonly available: false; readonly reason: string }

function commandFailure(
  command: string,
  args: readonly string[],
  cause: unknown
): MDeployDriverError {
  const message = cause instanceof Error ? cause.message : String(cause)
  return { code: 'command_failed', message: `${command} ${args.join(' ')} failed: ${message}` }
}

async function readText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return ''
  return await new Response(stream).text()
}

/** 真实命令边界以 Effect 包装，保留失败原因并回到 M-Deploy 的 Result 契约。 */
export async function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {}
): Promise<Result<CommandOutput, MDeployDriverError>> {
  const program = Effect.tryPromise({
    try: async () => {
      const subprocess = Bun.spawn([command, ...args], {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        env: { ...process.env, ...options.env },
        stdout: 'pipe',
        stderr: 'pipe'
      })
      const [exitCode, stdout, stderr] = await Promise.all([
        subprocess.exited,
        readText(subprocess.stdout),
        readText(subprocess.stderr)
      ])
      if (exitCode !== 0) throw new Error(stderr.trim() || `exited with status ${exitCode}`)
      return { stdout, stderr }
    },
    catch: cause => commandFailure(command, args, cause)
  }).pipe(
    Effect.map(ok),
    Effect.catchAll(error => Effect.succeed(err(error)))
  )
  return await Effect.runPromise(program)
}

export function expectSuccess<T>(result: Result<T, MDeployDriverError>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`)
  return result.value
}

export function fullHaTopology(): MDeployInfrastructureTopologyV01FromSchema {
  const nodes: Array<MDeployInfrastructureTopologyV01FromSchema['nodes'][number]> = []
  const addNodes = (
    workloadClass: MDeployInfrastructureTopologyV01FromSchema['nodes'][number]['workloadClass'],
    count: number,
    failureDomainPrefix: string,
    resources: MDeployInfrastructureTopologyV01FromSchema['nodes'][number]['resources']
  ) => {
    for (let index = 1; index <= count; index++) {
      nodes.push({
        nodeId: `${workloadClass}-${index}`,
        workloadClass,
        failureDomain: `${failureDomainPrefix}-${index}`,
        resources,
        runtimeDriver: 'podman'
      })
    }
  }
  addNodes('control-state', 3, 'rack', { vcpu: 4, memoryMiB: 8192, diskGiB: 100 })
  addNodes('search', 3, 'rack', { vcpu: 8, memoryMiB: 16384, diskGiB: 500 })
  addNodes('leaf', 2, 'edge', { vcpu: 2, memoryMiB: 4096, diskGiB: 50 })
  return {
    schemaVersion: 'mdeploy.infrastructure-topology@0.1.0',
    topologyId: 'libvirt-full-ha-proof',
    revision: 'full-ha-proof-1',
    network: { networkId: 'meristem-full-ha', cidr: '10.77.0.0/24' },
    nodes
  }
}

export function deploymentState(
  serviceIds: readonly string[],
  digest: MDeployDigestFromSchema
): MDeployDesiredStateDocumentV01FromSchema {
  return {
    schemaVersion: 'mdeploy.desired-state@0.1.0',
    source: {
      repositoryUrl: 'https://git.example/meristem/desired-state.git',
      branch: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'deploy/production',
      digest,
      syncedAt: '2026-07-24T00:00:00.000Z'
    },
    runtime: { driver: 'podman', iacDriver: 'opentofu', targetScope: ['production'] },
    topology: {
      topologyId: 'libvirt-full-ha-proof',
      revision: 'full-ha-proof-1',
      nodes: [
        {
          nodeId: 'control-state-1',
          hostId: 'host-control-state-1',
          role: 'controller',
          runtimeDriver: 'podman'
        }
      ]
    },
    services: serviceIds.map(serviceId => ({
      serviceId,
      image: { image: 'docker.io/library/node', digest },
      config: { MERISTEM_LOG_LEVEL: { kind: 'plain', value: 'info' } },
      secretRefs: []
    })),
    generatedAt: '2026-07-24T00:00:00.000Z'
  }
}

export function signedEnvelope(
  state: MDeployDesiredStateDocumentV01FromSchema
): MDeploySignedEnvelopeV01FromSchema {
  return {
    schemaVersion: 'mdeploy.signed-envelope@0.1.0',
    payload: state,
    signature: {
      algorithm: 'ed25519',
      value: 'libvirt-full-ha-proof-signature',
      payloadDigest: state.source.digest
    },
    signer: { kind: 'mdeploy-controller', identity: 'm-deploy-controller' },
    issuedAt: state.generatedAt,
    expiresAt: '2026-07-24T00:15:00.000Z',
    verification: {
      verified: true,
      verifiedAt: state.generatedAt,
      verifier: 'libvirt-full-ha-proof'
    }
  }
}

export function fixtureAgent(): MDeployAgentRecord {
  const enrollment: MDeployAgentEnrollmentV01FromSchema = {
    schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
    agentId: 'agent-libvirt-full-ha-proof',
    hostId: 'host-control-state-1',
    capabilities: [{ runtimeDriver: 'podman', version: '5.0.0', features: ['quadlet'] }],
    controllerTrust: {
      issuer: 'm-deploy-controller',
      audience: 'mdeploy-agent',
      publicKeyFingerprint: 'sha256:libvirt-full-ha-proof',
      expiresAt: '2026-07-25T00:00:00.000Z'
    },
    enrolledAt: '2026-07-24T00:00:00.000Z'
  }
  return { enrollment }
}

export function parseDigest(output: string): MDeployDigestFromSchema | null {
  const value = output.trim()
  const prefix = 'sha256:'
  if (!value.startsWith(prefix) || value.length !== prefix.length + 64) return null
  return { algorithm: 'sha256', value: value.slice(prefix.length) }
}

/** Quadlet 只生成容器单元；根 target 是普通 user-systemd 单元，必须写入 unit search path。 */
export function createLiveDriverEffects(
  quadletDirectory: string,
  systemdUnitDirectory: string
): MDeployDriverEffects {
  return {
    async writeFiles(root, files) {
      if (root !== rootlessUnitDirectory) {
        return err({ code: 'output_write_failed', message: `unexpected Quadlet root ${root}` })
      }
      try {
        await Promise.all(
          files.map(async file => {
            const destination = file.path.endsWith('.target')
              ? systemdUnitDirectory
              : quadletDirectory
            await mkdir(destination, { recursive: true })
            await writeFile(join(destination, file.path), file.content)
          })
        )
        return ok(undefined)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        return err({
          code: 'output_write_failed',
          message: `write Quadlet files failed: ${message}`
        })
      }
    },
    async run(command, args, options) {
      return await runCommand(command, args, options)
    }
  }
}

export async function startHealthContainer(name: string, image: string): Promise<string> {
  expectSuccess(
    await runCommand('podman', [
      'create',
      '--name',
      name,
      '--publish',
      `127.0.0.1::${healthPort}`,
      '--env',
      `PORT=${healthPort}`,
      image,
      'node',
      '--eval',
      healthServerProgram
    ]),
    `create ${name}`
  )
  await expectContainerState(name, 'created')
  expectSuccess(await runCommand('podman', ['start', name]), `start ${name}`)
  await expectContainerState(name, 'running')

  const port = expectSuccess(
    await runCommand('podman', ['port', name, `${healthPort}/tcp`]),
    `read ${name} published health port`
  ).stdout.trim()
  const separator = port.lastIndexOf(':')
  if (separator < 0 || Number.isNaN(Number(port.slice(separator + 1)))) {
    throw new Error(`Podman returned an invalid published port for ${name}: ${port}`)
  }
  return `http://127.0.0.1:${port.slice(separator + 1)}`
}

async function expectContainerState(name: string, expected: string): Promise<void> {
  const inspected = expectSuccess(
    await runCommand('podman', ['inspect', '--format', '{{.State.Status}}', name]),
    `inspect ${expected} ${name}`
  )
  if (inspected.stdout.trim() !== expected) {
    throw new Error(`expected ${name} to be ${expected}, received ${inspected.stdout.trim()}`)
  }
}

export async function stopAndInspectContainer(name: string): Promise<void> {
  expectSuccess(await runCommand('podman', ['stop', '--time', '3', name]), `stop ${name}`)
  await expectContainerState(name, 'exited')
}

export async function removeContainer(name: string): Promise<void> {
  await runCommand('podman', ['rm', '--force', name])
}

export async function respondsToHealth(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/health`)).ok
  } catch {
    return false
  }
}

async function detectLiveFixture(): Promise<LiveFixture> {
  if (!liveProofEnabled) {
    return {
      available: false,
      reason: 'set MERISTEM_MDEPLOY_FULL_HA_PROOF=1 to run the live Podman/user-systemd proof'
    }
  }
  const runtimeDirectory = process.env.XDG_RUNTIME_DIR
  if (!runtimeDirectory) {
    return { available: false, reason: 'XDG_RUNTIME_DIR is unavailable for temporary Quadlets' }
  }
  const [podman, systemd, image, target] = await Promise.all([
    runCommand('podman', ['info', '--format', '{{.Host.Security.Rootless}}']),
    runCommand('systemctl', ['--user', 'is-system-running']),
    runCommand('podman', [
      'image',
      'inspect',
      'docker.io/library/node:lts-alpine',
      '--format',
      '{{.Digest}}'
    ]),
    runCommand('systemctl', [
      '--user',
      'show',
      'meristem.target',
      '--property=LoadState',
      '--value'
    ])
  ])
  if (!podman.ok || podman.value.stdout.trim() !== 'true') {
    return { available: false, reason: 'rootless Podman is unavailable' }
  }
  if (!systemd.ok || systemd.value.stdout.trim() !== 'running') {
    return { available: false, reason: 'user-systemd is unavailable' }
  }
  const digest = image.ok ? parseDigest(image.value.stdout) : null
  if (!digest) {
    return { available: false, reason: 'the local Node fixture image is unavailable' }
  }
  if (!target.ok || target.value.stdout.trim() !== 'not-found') {
    return {
      available: false,
      reason: 'meristem.target already exists and cannot be safely isolated'
    }
  }
  return {
    available: true,
    image: `docker.io/library/node@sha256:${digest.value}`,
    quadletDirectory: join(runtimeDirectory, 'containers', 'systemd'),
    systemdUnitDirectory: join(runtimeDirectory, 'systemd', 'user')
  }
}

export const liveFixture = await detectLiveFixture()
