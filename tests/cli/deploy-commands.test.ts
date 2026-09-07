import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCliRunner } from '../../apps/m-cli/src/cli.ts'
import { repoRoot } from '../../apps/m-cli/src/commands/deploy-commands.ts'
import type { CliClient } from '../../apps/m-cli/src/commands/types.ts'

const productionManifest = {
  schemaVersion: 'mdeploy.install-manifest@0.1.0',
  profile: 'production-podman',
  proposal: {
    sourceRef: {
      repositoryUrl: 'https://git.example.com/org/meristem.git',
      branch: 'refs/heads/main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'deploy/production',
      digest: { algorithm: 'sha256', value: 'ab'.repeat(32) },
      syncedAt: '2026-07-01T00:00:00.000Z'
    },
    diffSummary: { added: 1, changed: 0, removed: 0, summary: 'bump core' }
  }
}

const localManifest = {
  schemaVersion: 'mdeploy.install-manifest@0.1.0',
  profile: 'local-compose',
  local: { profiles: ['opensearch', 'redis', 'apisix'] }
}

async function withManifest(manifest: unknown, run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'meristem-deploy-cli-'))
  const path = join(dir, 'meristem.deploy.json')
  await Bun.write(path, JSON.stringify(manifest))
  try {
    await run(path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function deployClient(): CliClient {
  const calls: string[] = []
  return {
    async status() {
      throw new Error('should not be called')
    },
    deploy: {
      async desiredState() {
        calls.push('desiredState')
        return { stale: false, controllerAvailable: true }
      },
      async propose(input) {
        calls.push(`propose:${JSON.stringify(input)}`)
        return { proposal: { proposalId: 'prop-1', approvalStatus: 'pending' } }
      },
      async getProposal(proposalId) {
        calls.push(`getProposal:${proposalId}`)
        return { proposal: { proposalId, approvalStatus: 'pending' } }
      },
      async approve(proposalId, result) {
        calls.push(`approve:${proposalId}:${result}`)
        return { approval: { proposalId, result } }
      },
      async apply(input) {
        calls.push(`apply:${JSON.stringify(input)}`)
        return { operation: { operationId: 'op-apply-1' } }
      },
      async rollback(input) {
        calls.push(`rollback:${JSON.stringify(input)}`)
        return { operation: { operationId: 'op-rollback-1' } }
      },
      async drift() {
        calls.push('drift')
        return { reports: [] }
      },
      async driftCheck() {
        calls.push('driftCheck')
        return { requested: true }
      },
      async evidence() {
        calls.push('evidence')
        return { evidence: [] }
      },
      async agents() {
        calls.push('agents')
        return { agents: [] }
      }
    }
  }
}

describe('meristem deploy CLI', () => {
  it('resolves the installer repoRoot to the repository root (spawn cwd)', async () => {
    // install 子进程的 cwd 必须是仓库根目录，否则 bun run deploy:local / dev:full 无法解析。
    expect(await Bun.file(join(repoRoot, 'package.json')).exists()).toBe(true)
    expect(await Bun.file(join(repoRoot, 'apps/m-cli/package.json')).exists()).toBe(true)
  })

  it('reads desired state through deploy status', async () => {
    const client = deployClient()
    const result = await createCliRunner(client).run(['deploy', 'status'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"controllerAvailable": true')
  })

  it('routes drift, evidence and agents to their facade methods', async () => {
    const client = deployClient()
    const cli = createCliRunner(client)
    expect((await cli.run(['deploy', 'drift'])).exitCode).toBe(0)
    expect((await cli.run(['deploy', 'drift', '--check'])).exitCode).toBe(0)
    expect((await cli.run(['deploy', 'evidence'])).exitCode).toBe(0)
    expect((await cli.run(['deploy', 'agents'])).exitCode).toBe(0)
  })

  it('proposes from a validated production manifest', async () => {
    await withManifest(productionManifest, async path => {
      const result = await createCliRunner(deployClient()).run(['deploy', 'propose', '--config', path])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('"proposalId": "prop-1"')
    })
  })

  it('rejects propose for a local-compose manifest', async () => {
    await withManifest(localManifest, async path => {
      const result = await createCliRunner(deployClient()).run(['deploy', 'propose', '--config', path])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('requires a production-podman manifest')
    })
  })

  it('validates a production manifest and fails on mutable git pointers', async () => {
    await withManifest(productionManifest, async path => {
      const ok = await createCliRunner(deployClient()).run(['deploy', 'validate', '--config', path])
      expect(ok.exitCode).toBe(0)
      expect(ok.stdout).toContain('"valid": true')
    })
    await withManifest(
      { ...productionManifest, proposal: { ...productionManifest.proposal, sourceRef: { ...productionManifest.proposal.sourceRef, commit: 'main' } } },
      async path => {
        const result = await createCliRunner(deployClient()).run(['deploy', 'validate', '--config', path])
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('immutable Git commit')
      }
    )
  })

  it('reuses an existing valid manifest when init requests the same profile', async () => {
    await withManifest(productionManifest, async path => {
      const before = await Bun.file(path).text()

      const result = await createCliRunner(deployClient()).run([
        'deploy',
        'init',
        '--profile',
        'production-podman',
        '--config',
        path
      ])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('"reused": true')
      expect(await Bun.file(path).text()).toBe(before)
    })
  })

  it('rejects init when an existing manifest has a different profile', async () => {
    await withManifest(localManifest, async path => {
      const result = await createCliRunner(deployClient()).run([
        'deploy',
        'init',
        '--profile',
        'production-podman',
        '--config',
        path
      ])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(
        'existing deploy manifest profile is local-compose; requested profile is production-podman'
      )
    })
  })

  it('approve forwards approve/reject to the facade', async () => {
    const cli = createCliRunner(deployClient())
    const approved = await cli.run(['deploy', 'approve', 'prop-1'])
    expect(approved.exitCode).toBe(0)
    expect(approved.stdout).toContain('"result": "approve"')
    const rejected = await cli.run(['deploy', 'approve', 'prop-1', '--reject'])
    expect(rejected.exitCode).toBe(0)
    expect(rejected.stdout).toContain('"result": "reject"')
  })

  it('apply requires --confirm and forwards the body', async () => {
    const cli = createCliRunner(deployClient())
    const missing = await cli.run(['deploy', 'apply', '--proposal', 'prop-1', '--agent', 'agent-1'])
    expect(missing.exitCode).toBe(1)
    expect(missing.stderr).toContain('--confirm')

    const result = await cli.run([
      'deploy',
      'apply',
      '--proposal',
      'prop-1',
      '--agent',
      'agent-1',
      '--confirm'
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"operationId": "op-apply-1"')
  })

  it('rollback requires --confirm and forwards the digest', async () => {
    const cli = createCliRunner(deployClient())
    const missing = await cli.run([
      'deploy',
      'rollback',
      '--agent',
      'agent-1',
      '--digest-value',
      'ab'.repeat(32)
    ])
    expect(missing.exitCode).toBe(1)
    expect(missing.stderr).toContain('--confirm')

    const result = await cli.run([
      'deploy',
      'rollback',
      '--agent',
      'agent-1',
      '--digest-value',
      'ab'.repeat(32),
      '--confirm'
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"operationId": "op-rollback-1"')
  })

  it('install refuses production manifests and empty local profiles', async () => {
    await withManifest(productionManifest, async path => {
      const result = await createCliRunner(deployClient()).run(['deploy', 'install', '--config', path])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('local-compose')
    })
    await withManifest({ ...localManifest, local: { profiles: [] } }, async path => {
      const result = await createCliRunner(deployClient()).run([
        'deploy',
        'install',
        '--config',
        path,
        '--prepare-only'
      ])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('at least one local profile')
    })
  })

  it('install rejects profile overrides outside the local allowlist', async () => {
    await withManifest(localManifest, async path => {
      const result = await createCliRunner(deployClient()).run([
        'deploy',
        'install',
        '--config',
        path,
        '--profiles',
        'opensearch,--evil-flag',
        '--prepare-only'
      ])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('unsupported local profile "--evil-flag"')
    })
  })
})
