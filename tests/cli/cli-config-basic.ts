import { expect, it } from 'bun:test'
import { createCliRunner } from '../../apps/m-cli/src/cli.ts'
import {
  bareConfigClient,
  configClient,
  type ConfigPayloadFiles,
  type ConfigRecord
} from '../helpers/cli-config.ts'

export function registerCliConfigBasicTests(getFiles: () => ConfigPayloadFiles): void {
  it('lists configs through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      configClient({
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
      })
    )

    const result = await cli.run(['config', 'list'])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:list'])
    expect(result.stdout).toContain('"id": "cfg-001"')
    expect(result.stdout).toContain('"id": "cfg-002"')
    expect(result.stdout).toContain('"status": "published"')
  })

  it('shows a single config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      configClient({
        get: async (id: string) => {
          calls.push(`config:show:${id}`)
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
      })
    )

    const result = await cli.run(['config', 'show', 'cfg-show-001'])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:show:cfg-show-001'])
    expect(result.stdout).toContain('"id": "cfg-show-001"')
    expect(result.stdout).toContain('"status": "validated"')
  })

  it('fails config show without config id', async () => {
    const cli = createCliRunner(bareConfigClient())

    const result = await cli.run(['config', 'show'])

    expect(result.exitCode).toBe(1)
  })

  it('drafts a config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      configClient({
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
      })
    )

    const result = await cli.run([
      'config',
      'draft',
      '--domain',
      'core',
      '--file',
      getFiles().testConfig
    ])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:draft:core'])
    expect(result.stdout).toContain('"status": "draft"')
    expect(result.stdout).toContain('"domain": "core"')
  })

  it('fails draft without domain arg', async () => {
    const cli = createCliRunner(bareConfigClient())

    const result = await cli.run(['config', 'draft', '--file', getFiles().plainTest])

    expect(result.exitCode).toBe(1)
  })

  it('validates a config through mocked client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      configClient({
        validate: async (id: string) => {
          calls.push(`config:validate:${id}`)
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
      })
    )

    const result = await cli.run(['config', 'validate', 'cfg-val-001'])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['config:validate:cfg-val-001'])
    expect(result.stdout).toContain('"status": "validated"')
    expect(result.stdout).toContain('"configHash"')
  })
}
