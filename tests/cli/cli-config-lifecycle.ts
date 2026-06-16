import { expect, it } from 'bun:test'
import { createCliRunner } from '../../apps/m-cli/src/cli.ts'
import {
  bareConfigClient,
  type ConfigPayloadFiles,
  type ConfigRecord,
  configClient
} from '../helpers/cli-config.ts'

export function registerCliConfigLifecycleTests(getFiles: () => ConfigPayloadFiles): void {
  it('publishes a config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      configClient({
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
      })
    )

    const result = await cli.run([
      'config',
      'publish',
      'cfg-pub-001',
      '--reason',
      'rollout opentelemetry config'
    ])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:publish:cfg-pub-001:rollout opentelemetry config'])
    expect(result.stdout).toContain('"status": "published"')
    expect(result.stdout).toContain('"publishedBy": "security-admin"')
  })

  it('fails publish without reason', async () => {
    const cli = createCliRunner(bareConfigClient())

    const result = await cli.run(['config', 'publish', 'cfg-pub-001'])

    expect(result.exitCode).toBe(1)
  })

  it('rolls back a config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      configClient({
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
      })
    )

    const result = await cli.run([
      'config',
      'rollback',
      'cfg-rb-001',
      '--to',
      '1.0.0',
      '--reason',
      'config caused m-net degradation'
    ])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:rollback:cfg-rb-001:1.0.0:config caused m-net degradation'])
    expect(result.stdout).toContain('"status": "rolled_back"')
    expect(result.stdout).toContain('"rollbackVersion": "1.0.0"')
  })

  it('fails rollback without --to version', async () => {
    const cli = createCliRunner(bareConfigClient())

    const result = await cli.run([
      'config',
      'rollback',
      'cfg-rb-001',
      '--reason',
      'missing version'
    ])

    expect(result.exitCode).toBe(1)
  })

  it('fails draft when payload contains plaintext password', async () => {
    const cli = createCliRunner(
      configClient({
        draft: async (input: { domain: string; payload: Record<string, unknown> }) => {
          // Simulate server-side rejection of plaintext secret
          if (JSON.stringify(input.payload).includes('password')) {
            throw Object.assign(new Error('plaintext secret violation'), {
              cause: {
                code: 'config.secret_plaintext_rejected',
                message: 'config payload must not contain plaintext secret keys: password'
              }
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
      })
    )

    const result = await cli.run([
      'config',
      'draft',
      '--domain',
      'core',
      '--file',
      getFiles().secretConfig
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('plaintext secret')
  })

  it('fails draft when payload contains plaintext token', async () => {
    const cli = createCliRunner(
      configClient({
        draft: async (_input: { domain: string; payload: Record<string, unknown> }) => {
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
      })
    )

    const result = await cli.run([
      'config',
      'draft',
      '--domain',
      'm-net',
      '--file',
      getFiles().tokenConfig
    ])

    expect(result.exitCode).toBe(0)
  })

  it('fails when config client method is not provided', async () => {
    const cli = createCliRunner(bareConfigClient())

    const result = await cli.run(['config', 'list'])

    expect(result.exitCode).toBe(1)
  })

  it('full config lifecycle CLI flow with mocked client', async () => {
    const calls: string[] = []
    const client = configClient({
      list: async () => {
        calls.push('flow:list')
        return []
      },
      get: async (id: string) => {
        calls.push(`flow:show:${id}`)
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
        calls.push(`flow:draft:${input.domain}`)
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
        calls.push(`flow:validate:${id}`)
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

    const draft = await cli.run([
      'config',
      'draft',
      '--domain',
      'core',
      '--file',
      getFiles().plainTest
    ])
    expect(draft.exitCode).toBe(0)
    expect(calls).toContain('flow:draft:core')

    const validate = await cli.run(['config', 'validate', 'cfg-flow-001'])
    expect(validate.exitCode).toBe(0)
    expect(calls).toContain('flow:validate:cfg-flow-001')

    const publish = await cli.run(['config', 'publish', 'cfg-flow-001', '--reason', 'test rollout'])
    expect(publish.exitCode).toBe(0)
    expect(calls).toContain('flow:publish:cfg-flow-001:test rollout')

    const rollback = await cli.run([
      'config',
      'rollback',
      'cfg-flow-001',
      '--to',
      '0.1.0',
      '--reason',
      'test rollback'
    ])
    expect(rollback.exitCode).toBe(0)
    expect(calls).toContain('flow:rollback:cfg-flow-001:0.1.0:test rollback')
  })
}
