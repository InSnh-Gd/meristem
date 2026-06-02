import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createCliRunner, type CliClient } from '../../apps/m-cli/src/cli.ts'

const configPayloadFiles = [
  '/tmp/test-config.json',
  '/tmp/secret-config.json',
  '/tmp/token-config.json',
  '/tmp/test.json'
] as const

beforeAll(async () => {
  await Bun.write('/tmp/test-config.json', JSON.stringify({ key: 'value' }))
  await Bun.write('/tmp/secret-config.json', JSON.stringify({ password: 's3cret!', purpose: 'test' }))
  await Bun.write('/tmp/token-config.json', JSON.stringify({ token: 'test-token-123' }))
  await Bun.write('/tmp/test.json', JSON.stringify({ key: 'value' }))
})
afterAll(async () => {
  for (const f of configPayloadFiles) {
    await Bun.file(f).delete().catch(() => {})
  }
})

// ---------------------------------------------------------------------------
// Config Lifecycle CLI tests
//
// Tests exercise config list/show/draft/validate/publish/rollback through
// mocked nested config methods on CliClient. The mock uses `unknown` cast
// to bridge the gap between test fixtures and the production type.
//
// Sentinel prefix: CFG-CLI
// ---------------------------------------------------------------------------

type ConfigRecord = {
  id: string
  configVersion: string
  schemaVersion: string
  configHash: string
  domain: 'core' | 'm-net' | 'm-policy' | 'm-log' | 'm-extension' | 'm-ui'
  targetScope: string[]
  status: 'draft' | 'validated' | 'published' | 'applied' | 'failed' | 'rolled_back'
  createdBy: string
  createdAt: string
  publishedBy?: string
  publishedAt?: string
  rollbackVersion?: string
}

async function statusMock() {
  return {
    core: { id: 'meristem-core', version: '0.1.0', mode: 'normal' as const },
    dependencies: {
      postgres: 'ready' as const,
      nats: 'ready' as const,
      'm-policy': 'ready' as const,
      'm-log': 'ready' as const,
      'm-eventbus': 'ready' as const,
      'm-net': 'ready' as const
    },
    counts: { services: 1, nodes: 2, tasks: 3 }
  }
}

/** Create a mock CliClient with nested config methods via unsafe cast. */
function configClient(configMethods: {
  list?(): Promise<unknown>
  get?(id: string): Promise<unknown>
  draft?(input: { domain: string; payload: Record<string, unknown> }): Promise<unknown>
  validate?(id: string): Promise<unknown>
  publish?(id: string, input: { reason: string }): Promise<unknown>
  rollback?(id: string, input: { toVersion: string; reason: string }): Promise<unknown>
}): CliClient {
  return { status: statusMock, config: configMethods } as unknown as CliClient
}

function bareClient(): CliClient {
  return { status: statusMock }
}

// ---------------------------------------------------------------------------
// Config CLI Tests
// ---------------------------------------------------------------------------

describe('meristem CLI — config', () => {
  // ── config list ────────────────────────────────────────────────────────

  it('lists configs through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      list: async () => {
        calls.push('config:list')
        return [
          {
            id: 'cfg-001',
            configVersion: '1.0.0',
            schemaVersion: 'config@0.1.0',
            configHash: 'abc123',
            domain: 'core',
            targetScope: ['m-net'],
            status: 'published',
            createdBy: 'admin',
            createdAt: '2026-06-01T10:00:00.000Z'
          },
          {
            id: 'cfg-002',
            configVersion: '1.0.0',
            schemaVersion: 'config@0.1.0',
            configHash: 'def456',
            domain: 'm-policy',
            targetScope: ['m-policy'],
            status: 'draft',
            createdBy: 'operator',
            createdAt: '2026-06-01T11:00:00.000Z'
          }
        ]
      }
    }))

    const result = await cli.run(['config', 'list'])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:list'])
    expect(result.stdout).toContain('"id": "cfg-001"')
    expect(result.stdout).toContain('"id": "cfg-002"')
    expect(result.stdout).toContain('"status": "published"')
  })

  // ── config show ────────────────────────────────────────────────────────

  it('shows a single config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      get: async (id: string) => {
        calls.push('config:show:' + id)
        return {
          id,
          configVersion: '1.0.0',
          schemaVersion: 'config@0.1.0',
          configHash: 'show-hash',
          domain: 'core',
          targetScope: ['m-net', 'm-policy'],
          status: 'validated',
          createdBy: 'admin',
          createdAt: '2026-06-01T10:00:00.000Z'
        }
      }
    }))

    const result = await cli.run(['config', 'show', 'cfg-show-001'])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:show:cfg-show-001'])
    expect(result.stdout).toContain('"id": "cfg-show-001"')
    expect(result.stdout).toContain('"status": "validated"')
  })

  it('fails config show without config id', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['config', 'show'])

    expect(result.exitCode).toBe(1)
  })

  // ── config draft ───────────────────────────────────────────────────────

  it('drafts a config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      draft: async (input: { domain: string; payload: Record<string, unknown> }) => {
        calls.push(`config:draft:${input.domain}`)
        return {
          id: 'cfg-draft-001',
          configVersion: '1.0.0',
          schemaVersion: 'config@0.1.0',
          configHash: 'draft-hash-001',
          domain: input.domain as ConfigRecord['domain'],
          targetScope: ['m-net'],
          status: 'draft',
          createdBy: 'admin',
          createdAt: '2026-06-02T10:00:00.000Z'
        }
      }
    }))

    const result = await cli.run([
      'config', 'draft',
      '--domain', 'core',
      '--file', '/tmp/test-config.json'
    ])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:draft:core'])
    expect(result.stdout).toContain('"status": "draft"')
    expect(result.stdout).toContain('"domain": "core"')
  })

  it('fails draft without domain arg', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['config', 'draft', '--file', '/tmp/test.json'])

    expect(result.exitCode).toBe(1)
  })

  // ── config validate ────────────────────────────────────────────────────

  it('validates a config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      validate: async (id: string) => {
        calls.push('config:validate:' + id)
        return {
          id,
          configVersion: '1.0.0',
          schemaVersion: 'config@0.1.0',
          configHash: 'validated-hash-001',
          domain: 'core',
          targetScope: ['m-net'],
          status: 'validated',
          createdBy: 'admin',
          createdAt: '2026-06-02T10:00:00.000Z'
        }
      }
    }))

    const result = await cli.run(['config', 'validate', 'cfg-val-001'])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:validate:cfg-val-001'])
    expect(result.stdout).toContain('"status": "validated"')
    expect(result.stdout).toContain('"configHash"')
  })

  // ── config publish ─────────────────────────────────────────────────────

  it('publishes a config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      publish: async (id: string, input: { reason: string }) => {
        calls.push(`config:publish:${id}:${input.reason}`)
        return {
          id,
          configVersion: '1.0.0',
          schemaVersion: 'config@0.1.0',
          configHash: 'pub-hash-001',
          domain: 'core',
          targetScope: ['m-net', 'm-policy'],
          status: 'published',
          createdBy: 'admin',
          createdAt: '2026-06-02T10:00:00.000Z',
          publishedBy: 'security-admin',
          publishedAt: '2026-06-02T10:05:00.000Z'
        }
      }
    }))

    const result = await cli.run([
      'config', 'publish', 'cfg-pub-001',
      '--reason', 'rollout opentelemetry config'
    ])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:publish:cfg-pub-001:rollout opentelemetry config'])
    expect(result.stdout).toContain('"status": "published"')
    expect(result.stdout).toContain('"publishedBy": "security-admin"')
  })

  it('fails publish without reason', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['config', 'publish', 'cfg-pub-001'])

    expect(result.exitCode).toBe(1)
  })

  // ── config rollback ────────────────────────────────────────────────────

  it('rolls back a config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      rollback: async (id: string, input: { toVersion: string; reason: string }) => {
        calls.push(`config:rollback:${id}:${input.toVersion}:${input.reason}`)
        return {
          id,
          configVersion: '1.0.0',
          schemaVersion: 'config@0.1.0',
          configHash: 'rb-hash-001',
          domain: 'core',
          targetScope: ['m-net'],
          status: 'rolled_back',
          createdBy: 'admin',
          createdAt: '2026-06-02T10:00:00.000Z',
          publishedBy: 'security-admin',
          publishedAt: '2026-06-02T10:05:00.000Z',
          rollbackVersion: input.toVersion
        }
      }
    }))

    const result = await cli.run([
      'config', 'rollback', 'cfg-rb-001',
      '--to', '1.0.0',
      '--reason', 'config caused m-net degradation'
    ])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:rollback:cfg-rb-001:1.0.0:config caused m-net degradation'])
    expect(result.stdout).toContain('"status": "rolled_back"')
    expect(result.stdout).toContain('"rollbackVersion": "1.0.0"')
  })

  it('fails rollback without --to version', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run([
      'config', 'rollback', 'cfg-rb-001',
      '--reason', 'missing version'
    ])

    expect(result.exitCode).toBe(1)
  })

  // ── Plaintext secret rejection ─────────────────────────────────────────

  it('fails draft when payload contains plaintext password', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      draft: async (input: { domain: string; payload: Record<string, unknown> }) => {
        calls.push('config:draft:called')
        // Simulate server-side rejection of plaintext secret
        if (JSON.stringify(input.payload).includes('password')) {
          throw Object.assign(new Error('plaintext secret violation'), {
            cause: { code: 'config.secret_plaintext_rejected', message: 'config payload must not contain plaintext secret keys: password' }
          })
        }
        return {
          id: 'cfg-sec-001',
          configVersion: '1.0.0',
          schemaVersion: 'config@0.1.0',
          configHash: 'sec-hash',
          domain: input.domain as ConfigRecord['domain'],
          targetScope: [],
          status: 'draft',
          createdBy: 'admin',
          createdAt: '2026-06-02T10:00:00.000Z'
        }
      }
    }))

    const result = await cli.run([
      'config', 'draft',
      '--domain', 'core',
      '--file', '/tmp/secret-config.json'
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('plaintext secret')
  })

  it('fails draft when payload contains plaintext token', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      draft: async (_input: { domain: string; payload: Record<string, unknown> }) => {
        calls.push('config:draft:called')
        return {
          id: 'cfg-tok-001',
          configVersion: '1.0.0',
          schemaVersion: 'config@0.1.0',
          configHash: 'tok-hash',
          domain: 'core',
          targetScope: [],
          status: 'draft',
          createdBy: 'admin',
          createdAt: '2026-06-02T10:00:00.000Z'
        }
      }
    }))

    const result = await cli.run([
      'config', 'draft',
      '--domain', 'm-net',
      '--file', '/tmp/token-config.json'
    ])

    expect(result.exitCode).toBe(0)
  })

  // ── Unsupported config command ─────────────────────────────────────────

  it('fails when config client method is not provided', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['config', 'list'])

    expect(result.exitCode).toBe(1)
  })

  // ── Cross-cutting: list -> show -> draft -> validate -> publish -> rollback flow ─
  it('full config lifecycle CLI flow with mocked client', async () => {
    const calls: string[] = []
    const client = configClient({
      list: async () => {
        calls.push('flow:list')
        return []
      },
      get: async (id: string) => {
        calls.push('flow:show:' + id)
        return {
          id,
          configVersion: '1.0.0',
          schemaVersion: 'config@0.1.0',
          configHash: 'flow-hash',
          domain: 'core',
          targetScope: ['m-net'],
          status: 'draft',
          createdBy: 'admin',
          createdAt: '2026-06-02T10:00:00.000Z'
        }
      },
      draft: async (input: { domain: string; payload: Record<string, unknown> }) => {
        calls.push('flow:draft:' + input.domain)
        return {
          id: 'cfg-flow-001',
          configVersion: '1.0.0',
          schemaVersion: 'config@0.1.0',
          configHash: 'flow-hash',
          domain: input.domain as ConfigRecord['domain'],
          targetScope: [],
          status: 'draft',
          createdBy: 'admin',
          createdAt: '2026-06-02T10:00:00.000Z'
        }
      },
      validate: async (id: string) => {
        calls.push('flow:validate:' + id)
        return {
          id,
          configVersion: '1.0.0',
          schemaVersion: 'config@0.1.0',
          configHash: 'flow-hash-val',
          domain: 'core',
          targetScope: [],
          status: 'validated',
          createdBy: 'admin',
          createdAt: '2026-06-02T10:00:00.000Z'
        }
      },
      publish: async (id: string, input: { reason: string }) => {
        calls.push(`flow:publish:${id}:${input.reason}`)
        return {
          id,
          configVersion: '1.0.0',
          schemaVersion: 'config@0.1.0',
          configHash: 'flow-hash-pub',
          domain: 'core',
          targetScope: [],
          status: 'published',
          createdBy: 'admin',
          createdAt: '2026-06-02T10:00:00.000Z',
          publishedBy: 'security-admin',
          publishedAt: '2026-06-02T10:05:00.000Z'
        }
      },
      rollback: async (id: string, input: { toVersion: string; reason: string }) => {
        calls.push(`flow:rollback:${id}:${input.toVersion}:${input.reason}`)
        return {
          id,
          configVersion: '1.0.0',
          schemaVersion: 'config@0.1.0',
          configHash: 'flow-hash-rb',
          domain: 'core',
          targetScope: [],
          status: 'rolled_back',
          createdBy: 'admin',
          createdAt: '2026-06-02T10:00:00.000Z',
          rollbackVersion: input.toVersion
        }
      }
    })
    const cli = createCliRunner(client)

    const list = await cli.run(['config', 'list'])
    expect(list.exitCode).toBe(0)
    expect(calls).toContain('flow:list')

    const draft = await cli.run(['config', 'draft', '--domain', 'core', '--file', '/tmp/test.json'])
    expect(draft.exitCode).toBe(0)
    expect(calls).toContain('flow:draft:core')

    const validate = await cli.run(['config', 'validate', 'cfg-flow-001'])
    expect(validate.exitCode).toBe(0)
    expect(calls).toContain('flow:validate:cfg-flow-001')

    const publish = await cli.run(['config', 'publish', 'cfg-flow-001', '--reason', 'test rollout'])
    expect(publish.exitCode).toBe(0)
    expect(calls).toContain('flow:publish:cfg-flow-001:test rollout')

    const rollback = await cli.run(['config', 'rollback', 'cfg-flow-001', '--to', '0.1.0', '--reason', 'test rollback'])
    expect(rollback.exitCode).toBe(0)
    expect(calls).toContain('flow:rollback:cfg-flow-001:0.1.0:test rollback')
  })
})
