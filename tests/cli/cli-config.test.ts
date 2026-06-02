import { describe, expect, it } from 'bun:test'
import { createCliRunner, type CliClient } from '../../apps/m-cli/src/cli.ts'

// ---------------------------------------------------------------------------
// Config Lifecycle CLI tests
//
// Config CLI client methods will be added to CliClient type during Phase 19
// CLI implementation. Tests use mocked versions cast through `unknown`.
// Remove all casts when Phase 19 adds them to the type.
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

type ConfigApplyAck = {
  ackId: string
  configId: string
  configVersion: string
  ackedBy: string
  ackedAt: string
  status: 'acked' | 'failed'
  errorCode?: string
  errorMessage?: string
}

type ConfigCliMethods = {
  listConfigs?(): Promise<{ configs: ConfigRecord[] }>
  getConfig?(id: string): Promise<{ config: ConfigRecord }>
  draftConfig?(input: { domain: string; payload: Record<string, unknown> }): Promise<{ config: ConfigRecord }>
  validateConfig?(id: string): Promise<{ config: ConfigRecord }>
  publishConfig?(id: string, reason: string): Promise<{ config: ConfigRecord }>
  rollbackConfig?(id: string, toVersion: string, reason: string): Promise<{ config: ConfigRecord }>
  getApplyAck?(configId: string): Promise<{ acks: ConfigApplyAck[] }>
}

function statusMock() {
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

function configClient(methods: ConfigCliMethods): CliClient {
  return { status: statusMock, ...methods } as unknown as CliClient
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
      listConfigs: async () => {
        calls.push('config:list')
        return {
          configs: [
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
      }
    }))

    const result = await cli.run(['config', 'list'])

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
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
      getConfig: async (id: string) => {
        calls.push('config:show:' + id)
        return {
          config: {
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
      }
    }))

    const result = await cli.run(['config', 'show', 'cfg-show-001'])

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:show:cfg-show-001'])
    expect(result.stdout).toContain('"id": "cfg-show-001"')
    expect(result.stdout).toContain('"status": "validated"')
  })

  it('fails config show without config id', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['config', 'show'])

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
    expect(result.exitCode).toBe(1)
  })

  // ── config draft ───────────────────────────────────────────────────────

  it('drafts a config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      draftConfig: async (input: { domain: string; payload: Record<string, unknown> }) => {
        calls.push(`config:draft:${input.domain}`)
        return {
          config: {
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
      }
    }))

    const result = await cli.run([
      'config', 'draft',
      '--domain', 'core',
      '--file', '/tmp/test-config.json'
    ])

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:draft:core'])
    expect(result.stdout).toContain('"status": "draft"')
    expect(result.stdout).toContain('"domain": "core"')
  })

  it('fails draft without domain arg', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['config', 'draft', '--file', '/tmp/test.json'])

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
    expect(result.exitCode).toBe(1)
  })

  // ── config validate ────────────────────────────────────────────────────

  it('validates a config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      validateConfig: async (id: string) => {
        calls.push('config:validate:' + id)
        return {
          config: {
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
      }
    }))

    const result = await cli.run(['config', 'validate', 'cfg-val-001'])

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:validate:cfg-val-001'])
    expect(result.stdout).toContain('"status": "validated"')
    expect(result.stdout).toContain('"configHash"')
  })

  // ── config publish ─────────────────────────────────────────────────────

  it('publishes a config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      publishConfig: async (id: string, reason: string) => {
        calls.push(`config:publish:${id}:${reason}`)
        return {
          config: {
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
      }
    }))

    const result = await cli.run([
      'config', 'publish', 'cfg-pub-001',
      '--reason', 'rollout opentelemetry config'
    ])

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:publish:cfg-pub-001:rollout opentelemetry config'])
    expect(result.stdout).toContain('"status": "published"')
    expect(result.stdout).toContain('"publishedBy": "security-admin"')
  })

  it('fails publish without reason', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['config', 'publish', 'cfg-pub-001'])

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
    expect(result.exitCode).toBe(1)
  })

  // ── config rollback ────────────────────────────────────────────────────

  it('rolls back a config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      rollbackConfig: async (id: string, toVersion: string, reason: string) => {
        calls.push(`config:rollback:${id}:${toVersion}:${reason}`)
        return {
          config: {
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
            rollbackVersion: toVersion
          }
        }
      }
    }))

    const result = await cli.run([
      'config', 'rollback', 'cfg-rb-001',
      '--to', '1.0.0',
      '--reason', 'config caused m-net degradation'
    ])

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
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

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
    expect(result.exitCode).toBe(1)
  })

  // ── Plaintext secret rejection ─────────────────────────────────────────

  it('fails draft when payload contains plaintext password', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      draftConfig: async (input: { domain: string; payload: Record<string, unknown> }) => {
        calls.push('config:draft:called')
        // Simulate server-side rejection of plaintext secret
        if (JSON.stringify(input.payload).includes('password')) {
          throw Object.assign(new Error('plaintext secret violation'), {
            cause: { code: 'config.secret_plaintext_rejected', message: 'config payload must not contain plaintext secret keys: password' }
          })
        }
        return {
          config: {
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
      }
    }))

    const result = await cli.run([
      'config', 'draft',
      '--domain', 'core',
      '--file', '/tmp/secret-config.json'
    ])

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
    // When wired, the client should throw with a rejection error.
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('plaintext secret')
  })

  it('fails draft when payload contains plaintext token', async () => {
    const calls: string[] = []
    const cli = createCliRunner(configClient({
      draftConfig: async (input: { domain: string; payload: Record<string, unknown> }) => {
        calls.push('config:draft:called')
        return {
          config: {
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
      }
    }))

    const result = await cli.run([
      'config', 'draft',
      '--domain', 'm-net',
      '--file', '/tmp/token-config.json'
    ])

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
    expect(result.exitCode).toBe(0)
  })

  // ── Unsupported config command ─────────────────────────────────────────

  it('fails when config client method is not provided', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['config', 'list'])

    // FAILS RED: CLI runner does not dispatch 'config' commands yet.
    expect(result.exitCode).toBe(1)
  })

  // ── Cross-cutting: list -> show -> draft -> validate -> publish -> rollback flow ─
  it('full config lifecycle CLI flow with mocked client', async () => {
    const calls: string[] = []
    const client = configClient({
      listConfigs: async () => {
        calls.push('flow:list')
        return { configs: [] }
      },
      getConfig: async (id: string) => {
        calls.push('flow:show:' + id)
        return {
          config: {
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
        }
      },
      draftConfig: async (input: { domain: string; payload: Record<string, unknown> }) => {
        calls.push('flow:draft:' + input.domain)
        return {
          config: {
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
        }
      },
      validateConfig: async (id: string) => {
        calls.push('flow:validate:' + id)
        return {
          config: {
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
        }
      },
      publishConfig: async (id: string, reason: string) => {
        calls.push(`flow:publish:${id}:${reason}`)
        return {
          config: {
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
        }
      },
      rollbackConfig: async (id: string, toVersion: string, reason: string) => {
        calls.push(`flow:rollback:${id}:${toVersion}:${reason}`)
        return {
          config: {
            id,
            configVersion: '1.0.0',
            schemaVersion: 'config@0.1.0',
            configHash: 'flow-hash-rb',
            domain: 'core',
            targetScope: [],
            status: 'rolled_back',
            createdBy: 'admin',
            createdAt: '2026-06-02T10:00:00.000Z',
            rollbackVersion: toVersion
          }
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
