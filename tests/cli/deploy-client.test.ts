import { describe, expect, it } from 'bun:test'
import { createCliRunner } from '../../apps/m-cli/src/cli.ts'
import { createCoreClient } from '../../apps/m-cli/src/client.ts'
import { createDeployClient } from '../../apps/m-cli/src/clients/deploy-client.ts'
import { createCliRuntime } from '../../apps/m-cli/src/clients/runtime.ts'

/**
 * 部署客户端错误映射：控制面未运行时，错误必须给出可操作的前置提示，
 * 而不是把底层 fetch 的 "Unable to connect" 原样抛给操作者。
 */
describe('deploy client control-plane error mapping', () => {
  function clientAgainstDeadCore() {
    const runtime = createCliRuntime({
      coreUrl: 'http://127.0.0.1:39999',
      taskUrl: 'http://127.0.0.1:39999',
      policyUrl: 'http://127.0.0.1:39999',
      mnetUrl: 'http://127.0.0.1:39999',
      extensionUrl: 'http://127.0.0.1:39999',
      token: 'test-token'
    })
    return createDeployClient(runtime)
  }

  it('maps a connection failure to an actionable control-plane hint', async () => {
    const client = clientAgainstDeadCore()
    const desiredState = client.desiredState
    if (!desiredState) throw new Error('deploy.desiredState not wired')
    await expect(desiredState()).rejects.toThrow(/M-Deploy 控制面.*RUNBOOK\.md/s)
  })

  it('applies the same hint to propose', async () => {
    const client = clientAgainstDeadCore()
    const propose = client.propose
    if (!propose) throw new Error('deploy.propose not wired')
    await expect(propose({ sourceRef: {}, diffSummary: {} })).rejects.toThrow(
      /M-Deploy 控制面.*RUNBOOK\.md/s
    )
  })

  it('renders actionable expiry recovery from a Core 401 envelope without retrying', async () => {
    let requestCount = 0
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requestCount += 1
        expect(new URL(request.url).pathname).toBe('/api/v0/deploy/desired-state')
        return Response.json(
          { error: { code: 'expired_token', message: 'JWT has expired' } },
          { status: 401 }
        )
      }
    })
    const coreUrl = `http://127.0.0.1:${server.port}`

    try {
      const result = await createCliRunner(
        createCoreClient({
          coreUrl,
          taskUrl: coreUrl,
          policyUrl: coreUrl,
          mnetUrl: coreUrl,
          extensionUrl: coreUrl,
          token: 'test-token'
        })
      ).run(['deploy', 'status'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('认证令牌已过期')
      expect(result.stderr).toContain('已配置的身份提供方')
      expect(result.stderr).toContain('local-dev')
      expect(result.stderr).toContain('bun run token:mint --actor <actor>')
      expect(requestCount).toBe(1)
    } finally {
      server.stop(true)
    }
  })

  it('renders local-dev admin guidance for a Core policy denial without retrying', async () => {
    let requestCount = 0
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requestCount += 1
        expect(new URL(request.url).pathname).toBe('/api/v0/deploy/desired-state')
        return Response.json(
          { error: { code: 'policy.denied', message: 'permission denied' } },
          { status: 403 }
        )
      }
    })
    const coreUrl = `http://127.0.0.1:${server.port}`

    try {
      const result = await createCliRunner(
        createCoreClient({
          coreUrl,
          taskUrl: coreUrl,
          policyUrl: coreUrl,
          mnetUrl: coreUrl,
          extensionUrl: coreUrl,
          token: 'test-token'
        })
      ).run(['deploy', 'status'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('M-Policy')
      expect(result.stderr).toContain('admin 可读取和提交提案')
      expect(result.stderr).toContain('security-admin 可审批、apply 与 rollback')
      expect(result.stderr).toContain('bun run token:mint --actor admin')
      expect(requestCount).toBe(1)
    } finally {
      server.stop(true)
    }
  })
})
