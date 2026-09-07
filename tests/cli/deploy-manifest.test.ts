import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isLegacyGeneratedMDeployInstallerPlaceholderV01 } from '../../packages/contracts/src/index.ts'
import { initManifest, readValidManifest } from '../../apps/m-cli/src/commands/deploy-manifest.ts'

type GitFixture = {
  readonly checkout: string
  readonly manifestPath: string
  readonly root: string
}

const legacyPlaceholder = {
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
}

async function runGit(args: readonly string[], cwd: string) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    child.stdout.text(),
    child.stderr.text()
  ])
  return { exitCode, stdout, stderr }
}

async function gitText(args: readonly string[], cwd: string): Promise<string> {
  const result = await runGit(args, cwd)
  expect(result.exitCode).toBe(0)
  return result.stdout.trim()
}

async function archiveDigest(commit: string, cwd: string): Promise<string> {
  const child = Bun.spawn(['git', 'archive', '--format=tar', commit, '--', '.'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [exitCode, archive] = await Promise.all([
    child.exited,
    new Response(child.stdout).arrayBuffer()
  ])
  expect(exitCode).toBe(0)
  return new Bun.CryptoHasher('sha256').update(new Uint8Array(archive)).digest('hex').toLowerCase()
}

async function createGitFixture(): Promise<GitFixture> {
  const root = await mkdtemp(join(tmpdir(), 'meristem-deploy-manifest-'))
  const remote = join(root, 'origin.git')
  const seed = join(root, 'seed')
  const checkout = join(root, 'checkout')
  await gitText(['init', '--bare', '--initial-branch=main', remote], root)
  await gitText(['init', '--initial-branch=main', seed], root)
  await gitText(['config', 'user.email', 'operator@example.com'], seed)
  await gitText(['config', 'user.name', 'Meristem Operator'], seed)
  await Bun.write(join(seed, 'desired-state.yaml'), 'version: committed\n')
  await gitText(['add', 'desired-state.yaml'], seed)
  await gitText(['commit', '-m', 'initial desired state'], seed)
  await gitText(['remote', 'add', 'origin', remote], seed)
  await gitText(['push', 'origin', 'main'], seed)
  await gitText(['clone', remote, checkout], root)
  return { checkout, manifestPath: join(checkout, 'meristem.deploy.json'), root }
}

async function withGitFixture(run: (fixture: GitFixture) => Promise<void>): Promise<void> {
  const fixture = await createGitFixture()
  try {
    await run(fixture)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
}

describe('deploy manifest provenance boundary', () => {
  it('derives production provenance from committed archive bytes', async () => {
    await withGitFixture(async fixture => {
      // Given a checkout whose worktree has local changes outside the committed tree.
      await Bun.write(join(fixture.checkout, 'desired-state.yaml'), 'version: dirty\n')
      await Bun.write(join(fixture.checkout, 'untracked.txt'), 'untracked\n')
      const commit = await gitText(['rev-parse', '--verify', 'HEAD^{commit}'], fixture.checkout)
      const initializedAfter = Date.now()

      // When production init writes a new manifest.
      const result = await initManifest({
        manifestPath: fixture.manifestPath,
        profile: 'production-podman',
        cwd: fixture.checkout
      })

      // Then sourceRef contains only the immutable checkout provenance.
      expect(result.exitCode).toBe(0)
      const manifest = await readValidManifest(fixture.manifestPath)
      expect(manifest.profile).toBe('production-podman')
      if (manifest.profile !== 'production-podman') return
      expect(manifest.proposal.sourceRef).toMatchObject({
        repositoryUrl: await gitText(['remote', 'get-url', 'origin'], fixture.checkout),
        branch: await gitText(['symbolic-ref', 'HEAD'], fixture.checkout),
        commit,
        path: '.',
        digest: { algorithm: 'sha256', value: await archiveDigest(commit, fixture.checkout) }
      })
      expect(Date.parse(manifest.proposal.sourceRef.syncedAt)).toBeGreaterThanOrEqual(
        initializedAfter
      )
    })
  })

  it('upgrades only the exact legacy generated placeholder', async () => {
    await withGitFixture(async fixture => {
      // Given the complete historical generated tuple.
      await Bun.write(fixture.manifestPath, `${JSON.stringify(legacyPlaceholder, null, 2)}\n`)

      // When production init runs from the attached checkout.
      const result = await initManifest({
        manifestPath: fixture.manifestPath,
        profile: 'production-podman',
        cwd: fixture.checkout
      })

      // Then it atomically replaces the placeholder with valid provenance.
      expect(result.stdout).toContain('"upgraded": true')
      const manifest = await readValidManifest(fixture.manifestPath)
      expect(isLegacyGeneratedMDeployInstallerPlaceholderV01(manifest)).toBe(false)
      expect(manifest.profile).toBe('production-podman')
      if (manifest.profile !== 'production-podman') return
      expect(manifest.proposal.sourceRef.path).toBe('.')
    })
  })

  it('reuses an existing real production manifest byte-for-byte', async () => {
    await withGitFixture(async fixture => {
      // Given a valid operator-authored production manifest with nonstandard trailing whitespace.
      const original = `${JSON.stringify(
        {
          schemaVersion: 'mdeploy.install-manifest@0.1.0',
          profile: 'production-podman',
          proposal: {
            sourceRef: {
              repositoryUrl: 'https://git.example.com/org/real.git',
              branch: 'refs/heads/release',
              commit: 'cd'.repeat(20),
              path: '.',
              digest: { algorithm: 'sha256', value: 'ef'.repeat(32) },
              syncedAt: '2026-08-19T00:00:00.000Z'
            },
            diffSummary: { added: 1, changed: 0, removed: 0, summary: 'operator authored' }
          }
        },
        null,
        2
      )}\n\n`
      await Bun.write(fixture.manifestPath, original)

      // When production init sees the same profile.
      const result = await initManifest({
        manifestPath: fixture.manifestPath,
        profile: 'production-podman',
        cwd: fixture.checkout
      })

      // Then it reuses the user data without reformatting or overwriting it.
      expect(result.stdout).toContain('"reused": true')
      expect(await Bun.file(fixture.manifestPath).text()).toBe(original)
    })
  })

  it('fails before writing when production provenance has no Git checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'meristem-deploy-no-git-'))
    const manifestPath = join(root, 'meristem.deploy.json')
    try {
      // Given a directory that is not a Git checkout.
      const init = initManifest({ manifestPath, profile: 'production-podman', cwd: root })

      // When production init cannot collect provenance.
      await expect(init).rejects.toThrow('requires a Git checkout')

      // Then no manifest was created.
      expect(await Bun.file(manifestPath).exists()).toBe(false)

      const placeholderPath = join(root, 'legacy-placeholder.json')
      const placeholderText = `${JSON.stringify(legacyPlaceholder, null, 2)}\n`
      await Bun.write(placeholderPath, placeholderText)
      await expect(
        initManifest({ manifestPath: placeholderPath, profile: 'production-podman', cwd: root })
      ).rejects.toThrow('requires a Git checkout')
      expect(await Bun.file(placeholderPath).text()).toBe(placeholderText)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
