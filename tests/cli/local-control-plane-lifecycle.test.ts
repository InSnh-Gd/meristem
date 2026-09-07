import { describe, expect, it } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { createInMemoryMDeployDeps } from '../../services/m-deploy/src/testing.ts'
import type { MDeployGitSourceRefV01FromSchema } from '../../packages/contracts/src/index.ts'

const deployCommandsPath = join(import.meta.dir, '../../apps/m-cli/src/commands/deploy-commands.ts')

/** 操作者在本地控制面上真实 pin 的 sourceRef，与 fixture 默认 digest 不同。 */
function operatorSourceRef(): MDeployGitSourceRefV01FromSchema {
  return {
    repositoryUrl: 'https://github.com/InSnh-Gd/meristem.git',
    branch: 'refs/heads/main',
    commit: 'd6101eb72c904a38b4e757dccfb7defe8b63df6a',
    path: '.',
    digest: {
      algorithm: 'sha256',
      value: '4e6c28ea7ecc9f118fb3ac1577932e73be69fde8980302a7a44d62ad1b5ec156'
    },
    syncedAt: '2026-08-20T09:15:31.942Z'
  }
}

describe('local control plane apply prerequisites', () => {
  it('keeps the default git fixture pinned to a single digest', async () => {
    const deps = createInMemoryMDeployDeps({ now: '2026-07-13T00:05:00.000Z' })

    const result = await deps.git.fetchSignedEnvelope(operatorSourceRef())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('git.digest_not_found')
  })

  it('serves an envelope for the requested source when local-dev opts in', async () => {
    const deps = createInMemoryMDeployDeps({
      now: '2026-07-13T00:05:00.000Z',
      gitEnvelopeFromRequestedSource: true
    })
    const source = operatorSourceRef()

    const result = await deps.git.fetchSignedEnvelope(source)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const envelope = result.value as { payload: { source: MDeployGitSourceRefV01FromSchema } }
    expect(envelope.payload.source.digest.value).toBe(source.digest.value)
    expect(envelope.payload.source.commit).toBe(source.commit)
  })

  it('allows controller trust expiry to track a long-running local clock', () => {
    const now = '2026-08-25T17:00:00.000Z'
    const expiresAt = new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString()
    const deps = createInMemoryMDeployDeps({ now, controllerTrustExpiresAt: expiresAt })

    expect(deps.__testing.controllerTrust().expiresAt).toBe(expiresAt)
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.parse(now))
  })

  it('defaults controller trust expiry to the fixed service-test clock', () => {
    const deps = createInMemoryMDeployDeps({ now: '2026-07-13T00:05:00.000Z' })

    expect(deps.__testing.controllerTrust().expiresAt).toBe('2026-07-14T00:00:00.000Z')
  })
})

describe('local stack lifecycle mechanics', () => {
  it('waits on the Core readiness route under the public API prefix', async () => {
    const source = await readFile(deployCommandsPath, 'utf8')

    expect(source).toContain('/api/v0/ready')
    expect(source).not.toMatch(/MERISTEM_CORE_URL[^\n]*\}\/ready`/)
  })

  it('treats a degraded Core readiness payload as not ready', async () => {
    const source = await readFile(deployCommandsPath, 'utf8')

    expect(source).toContain('requireReadyField')
    expect(source).toContain('body.ready === true')
  })

  it('records the detached process group leader instead of the pre-setsid pid', async () => {
    const source = await readFile(deployCommandsPath, 'utf8')

    // $! 是 setsid fork 之前的短命父进程；用它发送信号会漏掉整个服务组。
    expect(source).not.toContain("printf '%s' $! >")
    expect(source).toContain('printf %s "$$"')
  })

  it('reads the pid from a file so grandchildren cannot hold the pipe open', async () => {
    const source = await readFile(deployCommandsPath, 'utf8')

    expect(source).toContain('readGroupLeaderPid')
    expect(source).toContain("stdout: 'ignore'")
  })
})

describe('detached process group start pattern', () => {
  it('produces a child whose pid is its own process group leader', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'meristem-pgid-'))
    const pidFile = join(dir, 'stack.pid')
    try {
      const script = `nohup setsid sh -c 'printf %s "$$" > "$1"; shift; exec "$@"' meristem-pgid-probe '${pidFile}' sleep 5 > /dev/null 2>&1 < /dev/null &`
      const child = Bun.spawn(['sh', '-lc', script], {
        stdout: 'ignore',
        stderr: 'ignore',
        stdin: 'ignore'
      })
      expect(await child.exited).toBe(0)

      let recorded = 0
      for (let attempt = 0; attempt < 50 && recorded <= 0; attempt += 1) {
        recorded = Number((await readFile(pidFile, 'utf8').catch(() => '')).trim())
        if (recorded <= 0) await Bun.sleep(100)
      }
      expect(recorded).toBeGreaterThan(0)

      const stat = await readFile(`/proc/${recorded}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      expect(Number(fields[2])).toBe(recorded)

      process.kill(-recorded, 'SIGTERM')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
