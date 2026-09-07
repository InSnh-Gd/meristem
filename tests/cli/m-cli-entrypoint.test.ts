import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateMDeployInstallerManifestV01 } from '../../packages/contracts/src/index.ts'

const repoRoot = resolve(import.meta.dir, '../..')
const cliEntrypoint = resolve(repoRoot, 'apps/m-cli/src/index.ts')

type ProcessResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const legacyGeneratedProductionPlaceholder = {
  schemaVersion: 'mdeploy.install-manifest@0.1.0',
  profile: 'production-podman',
  proposal: {
    sourceRef: {
      repositoryUrl: 'https://git.example.com/org/meristem.git',
      branch: 'refs/heads/main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'deploy/production',
      digest: { algorithm: 'sha256', value: 'ab'.repeat(32) },
      syncedAt: '1970-01-01T00:00:00.000Z'
    },
    diffSummary: { added: 0, changed: 0, removed: 0, summary: 'initial desired state' }
  }
} as const

async function runCli(args: readonly string[], cwd = repoRoot): Promise<ProcessResult> {
  const child = Bun.spawn(['bun', cliEntrypoint, ...args], {
    cwd,
    env: { ...process.env, MERISTEM_OTEL_EXPORTER: 'console' },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    child.stdout.text(),
    child.stderr.text()
  ])
  return { exitCode, stdout, stderr }
}

async function runGit(args: readonly string[], cwd: string): Promise<ProcessResult> {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    child.stdout.text(),
    child.stderr.text()
  ])
  return { exitCode, stdout, stderr }
}

async function gitArchiveDigest(commit: string, cwd: string) {
  const child = Bun.spawn(['git', 'archive', '--format=tar', commit, '--', '.'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [exitCode, archiveBytes] = await Promise.all([
    child.exited,
    new Response(child.stdout).arrayBuffer(),
    child.stderr.text()
  ])
  return {
    exitCode,
    digest: new Bun.CryptoHasher('sha256').update(new Uint8Array(archiveBytes)).digest('hex')
  }
}

describe('M-CLI process telemetry', () => {
  it('marks a successful command span as OpenTelemetry OK', async () => {
    const result = await runCli(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stderr).toContain('"status"')
    expect(result.stderr).toContain('"code": 1')
    expect(result.stderr).not.toContain('"exception.message"')
  })

  it('marks a failed command span as OpenTelemetry ERROR while preserving CLI output', async () => {
    const result = await runCli(['unknown-command'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown command: unknown-command')
    expect(result.stderr).toContain('"code": 2')
    expect(result.stderr).toContain('"exception.message"')
  })
})

describe('M-CLI deployment provenance', () => {
  it(
    'initializes and validates production provenance from an attached Git checkout',
    async () => {
      const fixtureRoot = await mkdtemp(join(tmpdir(), 'meristem-cli-deploy-provenance-'))
      try {
        // Given an attached checkout backed by an isolated local bare remote.
        const bareRemotePath = join(fixtureRoot, 'desired-state.git')
        const seedRepositoryPath = join(fixtureRoot, 'seed')
        const checkoutPath = join(fixtureRoot, 'checkout')
        const fixtureRemoteUrl = pathToFileURL(bareRemotePath).href

        const bareInit = await runGit(['init', '--bare', bareRemotePath], fixtureRoot)
        expect(bareInit.exitCode).toBe(0)

        const seedInit = await runGit(
          ['init', '--initial-branch=main', seedRepositoryPath],
          fixtureRoot
        )
        expect(seedInit.exitCode).toBe(0)

        const configureName = await runGit(
          ['config', 'user.name', 'Meristem Regression Test'],
          seedRepositoryPath
        )
        expect(configureName.exitCode).toBe(0)

        const configureEmail = await runGit(
          ['config', 'user.email', 'regression@example.test'],
          seedRepositoryPath
        )
        expect(configureEmail.exitCode).toBe(0)

        await Bun.write(join(seedRepositoryPath, 'desired-state.yaml'), 'version: committed\n')
        const addCommittedState = await runGit(['add', 'desired-state.yaml'], seedRepositoryPath)
        expect(addCommittedState.exitCode).toBe(0)

        const commitState = await runGit(
          ['commit', '-m', 'Add committed desired state'],
          seedRepositoryPath
        )
        expect(commitState.exitCode).toBe(0)

        const addRemote = await runGit(
          ['remote', 'add', 'origin', fixtureRemoteUrl],
          seedRepositoryPath
        )
        expect(addRemote.exitCode).toBe(0)

        const pushMain = await runGit(['push', '--set-upstream', 'origin', 'main'], seedRepositoryPath)
        expect(pushMain.exitCode).toBe(0)

        const cloneCheckout = await runGit(
          ['clone', '--branch', 'main', fixtureRemoteUrl, checkoutPath],
          fixtureRoot
        )
        expect(cloneCheckout.exitCode).toBe(0)

        const remoteUrl = await runGit(['remote', 'get-url', 'origin'], checkoutPath)
        expect(remoteUrl.exitCode).toBe(0)
        expect(remoteUrl.stdout.trim()).toBe(fixtureRemoteUrl)

        const branchRef = await runGit(['symbolic-ref', 'HEAD'], checkoutPath)
        expect(branchRef.exitCode).toBe(0)
        expect(branchRef.stdout.trim()).toBe('refs/heads/main')

        const headCommit = await runGit(['rev-parse', 'HEAD'], checkoutPath)
        expect(headCommit.exitCode).toBe(0)
        expect(headCommit.stdout.trim()).toMatch(/^[0-9a-f]{40}$/)

        const cleanArchive = await gitArchiveDigest(headCommit.stdout.trim(), checkoutPath)
        expect(cleanArchive.exitCode).toBe(0)
        expect(cleanArchive.digest).toMatch(/^[0-9a-f]{64}$/)

        const manifestPath = join(checkoutPath, 'meristem.deploy.json')
        await Bun.write(
          manifestPath,
          `${JSON.stringify(legacyGeneratedProductionPlaceholder, null, 2)}\n`
        )
        await Bun.write(join(checkoutPath, 'desired-state.yaml'), 'version: dirty\n')
        await Bun.write(join(checkoutPath, 'worktree-only.txt'), 'untracked\n')

        const expectedArchive = await gitArchiveDigest(headCommit.stdout.trim(), checkoutPath)
        expect(expectedArchive.exitCode).toBe(0)
        expect(expectedArchive.digest).toBe(cleanArchive.digest)

        // When the production initializer runs from that checkout.
        const init = await runCli(['deploy', 'init', '--profile', 'production-podman'], checkoutPath)
        expect(init.exitCode).toBe(0)

        const validate = await runCli(['deploy', 'validate'], checkoutPath)
        if (validate.exitCode !== 0) {
          expect(validate.stderr).toContain('production sourceRef still contains deploy init placeholders')
        }
        expect(validate.exitCode).toBe(0)

        // Then the placeholder is upgraded to immutable provenance from committed archive bytes.
        const parsedManifest = validateMDeployInstallerManifestV01(
          JSON.parse(await Bun.file(manifestPath).text())
        )
        expect(parsedManifest.ok).toBe(true)
        if (!parsedManifest.ok) return

        expect(parsedManifest.value.profile).toBe('production-podman')
        if (parsedManifest.value.profile !== 'production-podman') return

        expect(init.stdout).not.toContain('"reused": true')
        const { sourceRef } = parsedManifest.value.proposal
        expect(sourceRef.repositoryUrl).toBe(remoteUrl.stdout.trim())
        expect(sourceRef.branch).toBe(branchRef.stdout.trim())
        expect(sourceRef.commit).toBe(headCommit.stdout.trim())
        expect(sourceRef.path).toBe('.')
        expect(sourceRef.digest.algorithm).toBe('sha256')
        expect(sourceRef.digest.value).toBe(expectedArchive.digest)
        expect(sourceRef.digest.value).toMatch(/^[0-9a-f]{64}$/)
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true })
      }
    },
    30_000
  )
})
