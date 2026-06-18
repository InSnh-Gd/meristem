import { expect, it } from 'bun:test'
import { createCliRunner } from '../../apps/m-cli/src/cli.ts'
import {
  activeSecret,
  bareSecretClient,
  SECRET_SENTINEL,
  secretClient
} from '../helpers/cli-secrets.ts'

export function registerCliSecretsRotateDisableTests(): void {
  it('rotates a secret through mocked secret client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      secretClient({
        rotateSecret: async (secretId: string, input: { value: string; reason: string }) => {
          calls.push(`secret:rotate:${secretId}:${input?.reason ?? 'no-reason'}`)
          return {
            secretRef: {
              ...activeSecret,
              status: 'rotated' as const,
              rotatedAt: '2026-06-02T12:00:00.000Z'
            },
            version: 2
          }
        }
      })
    )

    const result = await cli.run([
      'secret',
      'rotate',
      'sr-cli-001',
      '--value',
      'new-rotated-value',
      '--reason',
      'periodic rotation'
    ])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['secret:rotate:sr-cli-001:periodic rotation'])
    expect(result.stdout).toContain('"status": "rotated"')
    expect(result.stdout).toContain('"rotatedAt"')
  })

  it('rotate output must not echo the plaintext secret value', async () => {
    const cli = createCliRunner(
      secretClient({
        rotateSecret: async () => {
          return {
            secretRef: {
              ...activeSecret,
              status: 'rotated' as const,
              rotatedAt: '2026-06-02T12:00:00.000Z'
            },
            version: 2
          }
        }
      })
    )

    const result = await cli.run([
      'secret',
      'rotate',
      'sr-cli-001',
      '--value',
      'dummy-rotated-value',
      '--reason',
      'test rotation'
    ])

    // The sentinel must NEVER appear in stdout or stderr.
    expect(result.stdout).not.toContain(SECRET_SENTINEL)
    expect(result.stderr).not.toContain(SECRET_SENTINEL)
    expect(result.stdout).not.toContain('"value"')
    expect(result.stdout).not.toContain('"plaintext"')
  })

  it('fails secret rotate without reason', async () => {
    const cli = createCliRunner(bareSecretClient())

    const result = await cli.run(['secret', 'rotate', 'sr-cli-001'])

    expect(result.exitCode).toBe(1)
  })

  it('fails secret rotate without secret id', async () => {
    const cli = createCliRunner(bareSecretClient())

    const result = await cli.run(['secret', 'rotate', '--reason', 'no target'])

    expect(result.exitCode).toBe(1)
  })

  it('disables a secret through mocked secret client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      secretClient({
        disableSecret: async (secretId: string, input: { reason: string }) => {
          const reason = input?.reason ?? 'no-reason'
          calls.push(`secret:disable:${secretId}:${reason}`)
          return {
            secretRef: {
              ...activeSecret,
              status: 'disabled' as const,
              disabledAt: '2026-06-02T14:00:00.000Z',
              metadata: { ...activeSecret.metadata, disableReason: reason }
            }
          }
        }
      })
    )

    const result = await cli.run([
      'secret',
      'disable',
      'sr-cli-001',
      '--reason',
      'no longer needed'
    ])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['secret:disable:sr-cli-001:no longer needed'])
    expect(result.stdout).toContain('"status": "disabled"')
    expect(result.stdout).toContain('"disabledAt"')
    expect(result.stdout).toContain('"disableReason": "no longer needed"')
  })

  it('fails secret disable without reason', async () => {
    const cli = createCliRunner(bareSecretClient())

    const result = await cli.run(['secret', 'disable', 'sr-cli-001'])

    expect(result.exitCode).toBe(1)
  })

  it('fails secret disable without secret id', async () => {
    const cli = createCliRunner(bareSecretClient())

    const result = await cli.run(['secret', 'disable', '--reason', 'no target'])

    expect(result.exitCode).toBe(1)
  })

  it('fails when secret client method is not provided', async () => {
    const cli = createCliRunner(bareSecretClient())

    const result = await cli.run(['secret', 'list'])

    // Missing client methods should surface as CLI usage failures.
    expect(result.exitCode).toBe(1)
  })

  it('returns unique sentinel values for grep-ability in CLI output', async () => {
    const cli = createCliRunner(
      secretClient({
        createSecret: async (input: { name: string; scope: string; value: string }) => ({
          secretRef: {
            id: 'sr-sentinel-001',
            version: 'secret-ref@0.1.0',
            name: input.name,
            scope: input.scope as 'system' | 'service' | 'node',
            owner: 'core',
            status: 'active',
            createdBy: 'security-admin',
            createdAt: '2026-06-02T10:00:00.000Z',
            metadata: { sentinelTest: 'true' }
          }
        })
      })
    )

    const result = await cli.run([
      'secret',
      'create',
      '--name',
      'sentinel-test',
      '--scope',
      'system',
      '--value',
      'dummy-value'
    ])

    expect(result.exitCode).toBe(0)
    // Sentinel must not appear — this is the core redaction assertion.
    expect(result.stdout).not.toContain(SECRET_SENTINEL)
    expect(result.stderr).not.toContain(SECRET_SENTINEL)

    // But the secretRef id should appear.
    expect(result.stdout).toContain('"id": "sr-sentinel-001"')
    expect(result.stdout).toContain('"sentinelTest": "true"')
  })

  it('top-level usage lists secret commands', async () => {
    const cli = createCliRunner(secretClient({}))

    const result = await cli.run(['--help'])

    // Help output should advertise the wired secret command surface.
    expect(result.stdout).toContain('secret')
    expect(result.exitCode).toBe(0)
  })
}
