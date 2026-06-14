import { expect, it } from 'bun:test'
import { createCliRunner } from '../../apps/m-cli/src/cli.ts'
import {
  activeSecret,
  bareSecretClient,
  disabledSecret,
  rotatedSecret,
  SECRET_SENTINEL,
  secretClient
} from '../helpers/cli-secrets.ts'

export function registerCliSecretsListCreateTests(): void {
  it('lists secrets through mocked secret client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      secretClient({
        listSecrets: async () => {
          calls.push('secret:list')
          return { secrets: [activeSecret, rotatedSecret, disabledSecret] }
        }
      })
    )

    const result = await cli.run(['secret', 'list'])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['secret:list'])
    expect(result.stdout).toContain('"id": "sr-cli-001"')
    expect(result.stdout).toContain('"id": "sr-cli-002"')
    expect(result.stdout).toContain('"id": "sr-cli-003"')
    expect(result.stdout).toContain('"status": "active"')
    expect(result.stdout).toContain('"status": "rotated"')
    expect(result.stdout).toContain('"status": "disabled"')
  })

  it('shows a single secret through mocked secret client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      secretClient({
        getSecret: async (id: string) => {
          calls.push(`secret:show:${id}`)
          return { secretRef: activeSecret }
        }
      })
    )

    const result = await cli.run(['secret', 'show', 'sr-cli-001'])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['secret:show:sr-cli-001'])
    expect(result.stdout).toContain('"id": "sr-cli-001"')
    expect(result.stdout).toContain('"name": "api-key-staging"')
    expect(result.stdout).toContain('"scope": "service"')
    expect(result.stdout).toContain('"owner": "core"')
  })

  it('fails secret show without secret id', async () => {
    const cli = createCliRunner(bareSecretClient())

    const result = await cli.run(['secret', 'show'])

    // Missing id should surface as a usage error.
    expect(result.exitCode).toBe(1)
  })

  it('creates a secret through mocked secret client', async () => {
    const calls: Array<{ method: string; name?: string; scope?: string; hasValue: boolean }> = []
    const cli = createCliRunner(
      secretClient({
        createSecret: async (input: { name: string; scope: string; value: string }) => {
          calls.push({
            method: 'create',
            name: input.name,
            scope: input.scope,
            hasValue: input.value.length > 0
          })
          return {
            secretRef: {
              id: 'sr-new-001',
              version: 'secret-ref@0.1.0',
              name: input.name,
              scope: input.scope as 'system' | 'service' | 'node',
              owner: 'core',
              status: 'active',
              createdBy: 'security-admin',
              createdAt: '2026-06-02T10:00:00.000Z',
              metadata: {}
            }
          }
        }
      })
    )

    // Simulate stdin value: CLI should read from stdin when --value-stdin is set.
    // In real CLI, Bun.stdin would be used. Here we test that the command
    // dispatches correctly; the actual stdin reading is tested in e2e.
    const result = await cli.run([
      'secret',
      'create',
      '--name',
      'my-api-key',
      '--scope',
      'service',
      '--value',
      'test-value-001'
    ])

    expect(result.exitCode).toBe(0)
    expect(calls.length).toBe(1)
    expect(calls[0]?.name).toBe('my-api-key')
    expect(calls[0]?.scope).toBe('service')

    // Output must contain the secretRef metadata but never the plaintext value.
    expect(result.stdout).toContain('"id": "sr-new-001"')
    expect(result.stdout).toContain('"name": "my-api-key"')
    expect(result.stdout).not.toContain(SECRET_SENTINEL)
    expect(result.stdout).not.toContain('"value"')
    expect(result.stdout).not.toContain('"plaintext"')
  })

  it('fails secret create without --name', async () => {
    const cli = createCliRunner(bareSecretClient())

    const result = await cli.run(['secret', 'create', '--scope', 'service'])

    expect(result.exitCode).toBe(1)
  })

  it('fails secret create without --scope', async () => {
    const cli = createCliRunner(bareSecretClient())

    const result = await cli.run(['secret', 'create', '--name', 'my-key'])

    expect(result.exitCode).toBe(1)
  })

  it('fails secret create with invalid scope', async () => {
    const cli = createCliRunner(
      secretClient({
        createSecret: async () => {
          throw new Error('invalid scope')
        }
      })
    )

    const result = await cli.run([
      'secret',
      'create',
      '--name',
      'my-key',
      '--scope',
      'cluster',
      '--value',
      'test-val'
    ])

    // Invalid scope should be rejected by the CLI validation path.
    expect(result.exitCode).toBe(1)
  })

  it('create output must not echo the plaintext secret value', async () => {
    const cli = createCliRunner(
      secretClient({
        createSecret: async (input: { name: string; scope: string; value: string }) => {
          // Even if the implementation accidentally includes the value in
          // the response, the CLI must never print it.
          return {
            secretRef: {
              id: 'sr-redact-001',
              version: 'secret-ref@0.1.0',
              name: input.name,
              scope: input.scope as 'system' | 'service' | 'node',
              owner: 'core',
              status: 'active',
              createdBy: 'security-admin',
              createdAt: '2026-06-02T10:00:00.000Z',
              metadata: {}
            }
          }
        }
      })
    )

    const result = await cli.run([
      'secret',
      'create',
      '--name',
      'redact-test',
      '--scope',
      'system',
      '--value',
      SECRET_SENTINEL
    ])

    // The sentinel must NEVER appear in stdout or stderr.
    expect(result.stdout).not.toContain(SECRET_SENTINEL)
    expect(result.stderr).not.toContain(SECRET_SENTINEL)
    expect(result.stdout).not.toContain('"value"')
    expect(result.stderr).not.toContain('"value"')
  })
}
