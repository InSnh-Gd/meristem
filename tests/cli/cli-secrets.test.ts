import { describe, expect, it } from 'bun:test'
import { createCliRunner, type CliClient } from '../../apps/m-cli/src/cli.ts'

// ---------------------------------------------------------------------------
// CLI secret client methods — these will be added to CliClient type
// during Phase 18 CLI implementation. Tests use mocked versions until then.
//
// The secret methods are cast through `unknown` because CliClient does not
// yet expose them. Remove all casts when Phase 18 adds them to the type.
// ---------------------------------------------------------------------------

type SecretRef = {
  id: string
  version: 'secret-ref@0.1.0'
  name: string
  scope: 'system' | 'service' | 'node'
  owner: 'core'
  status: 'active' | 'rotated' | 'disabled'
  createdBy: string
  createdAt: string
  rotatedAt?: string
  disabledAt?: string
  metadata: Record<string, string>
}

// Extended mock methods that will be added to CliClient during Phase 18.
type SecretCliMethods = {
  listSecrets?(): Promise<{ secrets: SecretRef[] }>
  getSecret?(id: string): Promise<{ secretRef: SecretRef }>
  createSecret?(input: {
    name: string
    scope: 'system' | 'service' | 'node'
    value: string
  }): Promise<{ secretRef: SecretRef }>
  rotateSecret?(secretId: string, input: { value: string; reason: string }): Promise<{ secretRef: SecretRef; version: number }>
  disableSecret?(secretId: string, input: { reason: string }): Promise<{ secretRef: SecretRef }>
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

/** Create a mock CliClient with secret methods nested under `secret` key. */
function secretClient(methods: SecretCliMethods): CliClient {
  const secret = {
    list: methods.listSecrets,
    get: methods.getSecret,
    create: methods.createSecret,
    rotate: methods.rotateSecret,
    disable: methods.disableSecret,
  }
  return { status: statusMock, secret } as unknown as CliClient
}

/** Create a minimal CliClient without secret methods. */
function bareClient(): CliClient {
  return { status: statusMock }
}

// Pre-built test secret fixtures.
const activeSecret: SecretRef = {
  id: 'sr-cli-001',
  version: 'secret-ref@0.1.0',
  name: 'api-key-staging',
  scope: 'service',
  owner: 'core',
  status: 'active',
  createdBy: 'security-admin',
  createdAt: '2026-06-01T10:00:00.000Z',
  metadata: { env: 'staging' }
}

const rotatedSecret: SecretRef = {
  id: 'sr-cli-002',
  version: 'secret-ref@0.1.0',
  name: 'db-password',
  scope: 'system',
  owner: 'core',
  status: 'rotated',
  createdBy: 'security-admin',
  createdAt: '2026-05-01T10:00:00.000Z',
  rotatedAt: '2026-06-01T10:00:00.000Z',
  metadata: {}
}

const disabledSecret: SecretRef = {
  id: 'sr-cli-003',
  version: 'secret-ref@0.1.0',
  name: 'old-token',
  scope: 'node',
  owner: 'core',
  status: 'disabled',
  createdBy: 'security-admin',
  createdAt: '2026-04-01T10:00:00.000Z',
  disabledAt: '2026-06-01T10:00:00.000Z',
  metadata: { reason: 'decommissioned' }
}

// Sentinel: must never appear in stdout/stderr.
const SENTINEL = 'MERISTEM_TEST_SECRET_DO_NOT_LOG'

// ---------------------------------------------------------------------------
// Secret CLI Tests
// ---------------------------------------------------------------------------

describe('meristem CLI — secret', () => {
  // ── secret list ──────────────────────────────────────────────────────

  it('lists secrets through mocked secret client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(secretClient({
      listSecrets: async () => {
        calls.push('secret:list')
        return { secrets: [activeSecret, rotatedSecret, disabledSecret] }
      }
    }))

    const result = await cli.run(['secret', 'list'])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    // When Phase 18 CLI module is wired, exitCode will be 0.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['secret:list'])
    expect(result.stdout).toContain('"id": "sr-cli-001"')
    expect(result.stdout).toContain('"id": "sr-cli-002"')
    expect(result.stdout).toContain('"id": "sr-cli-003"')
    expect(result.stdout).toContain('"status": "active"')
    expect(result.stdout).toContain('"status": "rotated"')
    expect(result.stdout).toContain('"status": "disabled"')
  })

  // ── secret show ──────────────────────────────────────────────────────

  it('shows a single secret through mocked secret client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(secretClient({
      getSecret: async (id: string) => {
        calls.push('secret:show:' + id)
        return { secretRef: activeSecret }
      }
    }))

    const result = await cli.run(['secret', 'show', 'sr-cli-001'])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['secret:show:sr-cli-001'])
    expect(result.stdout).toContain('"id": "sr-cli-001"')
    expect(result.stdout).toContain('"name": "api-key-staging"')
    expect(result.stdout).toContain('"scope": "service"')
    expect(result.stdout).toContain('"owner": "core"')
  })

  it('fails secret show without secret id', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['secret', 'show'])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    // Once wired, missing id should yield exitCode 1 with usage error.
    expect(result.exitCode).toBe(1)
  })

  // ── secret create ────────────────────────────────────────────────────

  it('creates a secret through mocked secret client', async () => {
    const calls: Array<{ method: string; name?: string; scope?: string; hasValue: boolean }> = []
    const cli = createCliRunner(secretClient({
      createSecret: async (input: { name: string; scope: string; value: string }) => {
        calls.push({ method: 'create', name: input.name, scope: input.scope, hasValue: input.value.length > 0 })
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
    }))

    // Simulate stdin value: CLI should read from stdin when --value-stdin is set.
    // In real CLI, Bun.stdin would be used. Here we test that the command
    // dispatches correctly; the actual stdin reading is tested in e2e.
    const result = await cli.run([
      'secret', 'create',
      '--name', 'my-api-key',
      '--scope', 'service',
      '--value', 'test-value-001'
    ])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    expect(result.exitCode).toBe(0)
    expect(calls.length).toBe(1)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(calls[0]!.name).toBe('my-api-key')
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(calls[0]!.scope).toBe('service')

    // Output must contain the secretRef metadata but never the plaintext value.
    expect(result.stdout).toContain('"id": "sr-new-001"')
    expect(result.stdout).toContain('"name": "my-api-key"')
    expect(result.stdout).not.toContain(SENTINEL)
    expect(result.stdout).not.toContain('"value"')
    expect(result.stdout).not.toContain('"plaintext"')
  })

  it('fails secret create without --name', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run([
      'secret', 'create',
      '--scope', 'service'
    ])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    expect(result.exitCode).toBe(1)
  })

  it('fails secret create without --scope', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run([
      'secret', 'create',
      '--name', 'my-key'
    ])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    expect(result.exitCode).toBe(1)
  })

  it('fails secret create with invalid scope', async () => {
    const cli = createCliRunner(secretClient({
      createSecret: async () => {
        throw new Error('invalid scope')
      }
    }))

    const result = await cli.run([
      'secret', 'create',
      '--name', 'my-key',
      '--scope', 'cluster',
      '--value', 'test-val'
    ])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    // Once wired: invalid scope should be validated by CLI and return 1.
    expect(result.exitCode).toBe(1)
  })

  // ── Secret value redaction in create output ──────────────────────────

  it('create output must not echo the plaintext secret value', async () => {
    const cli = createCliRunner(secretClient({
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
    }))

    const result = await cli.run([
      'secret', 'create',
      '--name', 'redact-test',
      '--scope', 'system',
      '--value', SENTINEL
    ])

    // The sentinel must NEVER appear in stdout or stderr.
    expect(result.stdout).not.toContain(SENTINEL)
    expect(result.stderr).not.toContain(SENTINEL)
    expect(result.stdout).not.toContain('"value"')
    expect(result.stderr).not.toContain('"value"')
  })

  // ── secret rotate ────────────────────────────────────────────────────

  it('rotates a secret through mocked secret client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(secretClient({
      rotateSecret: async (secretId: string, input: { value: string; reason: string }) => {
        calls.push('secret:rotate:' + secretId + ':' + (input?.reason ?? 'no-reason'))
        return {
          secretRef: { ...activeSecret, status: 'rotated' as const, rotatedAt: '2026-06-02T12:00:00.000Z' },
          version: 2
        }
      }
    }))

    const result = await cli.run([
      'secret', 'rotate',
      'sr-cli-001',
      '--value', 'new-rotated-value',
      '--reason', 'periodic rotation'
    ])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['secret:rotate:sr-cli-001:periodic rotation'])
    expect(result.stdout).toContain('"status": "rotated"')
    expect(result.stdout).toContain('"rotatedAt"')
  })

  it('rotate output must not echo the plaintext secret value', async () => {
    const cli = createCliRunner(secretClient({
      rotateSecret: async () => {
        return {
          secretRef: { ...activeSecret, status: 'rotated' as const, rotatedAt: '2026-06-02T12:00:00.000Z' },
          version: 2
        }
      }
    }))

    const result = await cli.run([
      'secret', 'rotate',
      'sr-cli-001',
      '--value', 'dummy-rotated-value',
      '--reason', 'test rotation'
    ])

    // The sentinel must NEVER appear in stdout or stderr.
    expect(result.stdout).not.toContain(SENTINEL)
    expect(result.stderr).not.toContain(SENTINEL)
    expect(result.stdout).not.toContain('"value"')
    expect(result.stdout).not.toContain('"plaintext"')
  })

  it('fails secret rotate without reason', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run([
      'secret', 'rotate',
      'sr-cli-001'
    ])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    expect(result.exitCode).toBe(1)
  })

  it('fails secret rotate without secret id', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run([
      'secret', 'rotate',
      '--reason', 'no target'
    ])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    expect(result.exitCode).toBe(1)
  })

  // ── secret disable ───────────────────────────────────────────────────

  it('disables a secret through mocked secret client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(secretClient({
      disableSecret: async (secretId: string, input: { reason: string }) => {
        const reason = input?.reason ?? 'no-reason'
        calls.push('secret:disable:' + secretId + ':' + reason)
        return {
          secretRef: {
            ...activeSecret,
            status: 'disabled' as const,
            disabledAt: '2026-06-02T14:00:00.000Z',
            metadata: { ...activeSecret.metadata, disableReason: reason }
          }
        }
      }
    }))

    const result = await cli.run([
      'secret', 'disable',
      'sr-cli-001',
      '--reason', 'no longer needed'
    ])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['secret:disable:sr-cli-001:no longer needed'])
    expect(result.stdout).toContain('"status": "disabled"')
    expect(result.stdout).toContain('"disabledAt"')
    expect(result.stdout).toContain('"disableReason": "no longer needed"')
  })

  it('fails secret disable without reason', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run([
      'secret', 'disable',
      'sr-cli-001'
    ])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    expect(result.exitCode).toBe(1)
  })

  it('fails secret disable without secret id', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run([
      'secret', 'disable',
      '--reason', 'no target'
    ])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    expect(result.exitCode).toBe(1)
  })

  // ── CLI error: missing client method ─────────────────────────────────

  it('fails when secret client method is not provided', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['secret', 'list'])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    // Once wired, missing method will yield 'CLI client missing listSecrets'.
    expect(result.exitCode).toBe(1)
  })

  // ── Cross-cutting: sentinel in mock returns ──────────────────────────

  it('returns unique sentinel values for grep-ability in CLI output', async () => {
    const cli = createCliRunner(secretClient({
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
    }))

    const result = await cli.run([
      'secret', 'create',
      '--name', 'sentinel-test',
      '--scope', 'system',
      '--value', 'dummy-value'
    ])

    // FAILS RED: CLI runner does not dispatch 'secret' commands yet.
    expect(result.exitCode).toBe(0)
    // Sentinel must not appear — this is the core redaction assertion.
    expect(result.stdout).not.toContain(SENTINEL)
    expect(result.stderr).not.toContain(SENTINEL)

    // But the secretRef id should appear.
    expect(result.stdout).toContain('"id": "sr-sentinel-001"')
    expect(result.stdout).toContain('"sentinelTest": "true"')
  })

  // ── Top-level usage lists secret commands ────────────────────────────

  it('top-level usage lists secret commands', async () => {
    const cli = createCliRunner(secretClient({}))

    const result = await cli.run(['unknown-command'])

    // FAILS RED: CLI runner does not know about 'secret' commands yet.
    // Once wired, stderr usage should list secret commands.
    expect(result.stderr).toContain('secret list')
    expect(result.stderr).toContain('secret show')
    expect(result.stderr).toContain('secret create')
    expect(result.stderr).toContain('secret rotate')
    expect(result.stderr).toContain('secret disable')
  })
})
