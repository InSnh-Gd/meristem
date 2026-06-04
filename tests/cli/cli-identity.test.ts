import { describe, expect, it } from 'bun:test'
import { createCliRunner, type CliClient } from '../../apps/m-cli/src/cli.ts'

// ---------------------------------------------------------------------------
// CLI identity client methods — these will be added to CliClient type
// during Phase 17 CLI implementation. Tests use mocked versions until then.
//
// The identity methods are cast through `unknown` because CliClient does not
// yet expose them. Remove all casts when Phase 17 adds them to the type.
// ---------------------------------------------------------------------------

type IdentityActor = {
  id: 'viewer' | 'operator' | 'admin' | 'security-admin'
  displayName: string
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

type ActorToken = {
  jti: string
  actor: IdentityActor['id']
  issuer: 'meristem-local'
  audience: 'meristem-core' | 'meristem-service'
  issuedAt: string
  expiresAt: string
  issuedBy: IdentityActor['id']
  purpose: string
  status: 'active' | 'revoked' | 'expired'
  revokedAt?: string
  revokedBy?: IdentityActor['id']
  revokeReason?: string
}

// Extended mock methods that will be added to CliClient during Phase 17.
type IdentityCliMethods = {
  listActors?(): Promise<{ actors: IdentityActor[] }>
  getActor?(actorId: string): Promise<{ actor: IdentityActor }>
  issueIdentityToken?(input: {
    actor: string
    ttl: string
    purpose: string
  }): Promise<{ token: string; jti: string; actor: string; audience: string; issuedAt: string; expiresAt: string; issuedBy: string; purpose: string; status: string }>
  inspectIdentityToken?(jti: string): Promise<{ token: ActorToken }>
  revokeIdentityToken?(jti: string, input: { reason: string }): Promise<{ token: ActorToken }>
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

/** Create a mock CliClient with identity methods nested under `identity` key. */
function identityClient(methods: IdentityCliMethods): CliClient {
  const identity = {
    listActors: methods.listActors,
    getActor: methods.getActor,
    issueToken: methods.issueIdentityToken,
    inspectToken: methods.inspectIdentityToken,
    revokeToken: methods.revokeIdentityToken,
  }
  return { status: statusMock, identity } as unknown as CliClient
}

/** Create a minimal CliClient without identity methods. */
function bareClient(): CliClient {
  return { status: statusMock }
}

// ---------------------------------------------------------------------------
// Identity CLI Tests
// ---------------------------------------------------------------------------

describe('meristem CLI — identity', () => {
  // ── actor list ────────────────────────────────────────────────────────

  it('lists actors through mocked identity client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(identityClient({
      listActors: async () => {
        calls.push('identity:actor:list')
        return {
          actors: [
            {
              id: 'operator',
              displayName: 'Default Operator',
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z'
            },
            {
              id: 'viewer',
              displayName: 'Read-Only Viewer',
              status: 'active',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z'
            }
          ]
        }
      }
    }))

    const result = await cli.run(['identity', 'actor', 'list'])

    // FAILS RED: CLI runner does not dispatch 'identity' commands yet.
    // When Phase 17 CLI module is wired, exitCode will be 0.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['identity:actor:list'])
    expect(result.stdout).toContain('"id": "operator"')
    expect(result.stdout).toContain('"id": "viewer"')
  })

  // ── actor show ────────────────────────────────────────────────────────

  it('shows a single actor through mocked identity client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(identityClient({
      getActor: async (actorId: string) => {
        calls.push('identity:actor:show:' + actorId)
        return {
          actor: {
            id: 'security-admin',
            displayName: 'Security Admin',
            status: 'active',
            createdAt: '2026-03-15T00:00:00.000Z',
            updatedAt: '2026-03-15T00:00:00.000Z'
          }
        }
      }
    }))

    const result = await cli.run(['identity', 'actor', 'show', 'security-admin'])

    // FAILS RED: CLI runner does not dispatch 'identity' commands yet.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['identity:actor:show:security-admin'])
    expect(result.stdout).toContain('"id": "security-admin"')
    expect(result.stdout).toContain('"displayName": "Security Admin"')
  })

  it('fails actor show without actor id', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['identity', 'actor', 'show'])

    // FAILS RED: CLI runner does not dispatch 'identity' commands yet.
    // Once wired, missing actor id should yield exitCode 1 with usage error.
    expect(result.exitCode).toBe(1)
  })

  // ── token issue ───────────────────────────────────────────────────────

  it('issues an actor token through mocked identity client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(identityClient({
      issueIdentityToken: async (input: { actor: string; ttl: string; purpose: string }) => {
        calls.push('identity:token:issue:' + input.actor + ':' + input.ttl + ':' + input.purpose)
        return {
          token: 'eyJhbGciOiJIUzI1NiJ9.mock-token-body.signature',
          jti: 'jti-issued-001',
          actor: input.actor,
          issuer: 'meristem-local',
          audience: 'meristem-core',
          issuedAt: '2026-06-01T10:00:00.000Z',
          expiresAt: '2026-06-01T18:00:00.000Z',
          issuedBy: 'security-admin',
          purpose: input.purpose,
          status: 'active'
        }
      }
    }))

    const result = await cli.run([
      'identity', 'token', 'issue',
      '--actor', 'operator',
      '--ttl', '8h',
      '--purpose', 'runtime automation'
    ])

    // FAILS RED: CLI runner does not dispatch 'identity' commands yet.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['identity:token:issue:operator:8h:runtime automation'])
    expect(result.stdout).toContain('"jti": "jti-issued-001"')
    expect(result.stdout).toContain('"token"')
    expect(result.stdout).toContain('"status": "active"')
  })

  it('fails token issue without actor arg', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run([
      'identity', 'token', 'issue',
      '--ttl', '8h',
      '--purpose', 'missing actor'
    ])

    // FAILS RED: CLI runner does not dispatch 'identity' commands yet.
    expect(result.exitCode).toBe(1)
  })

  // ── token inspect ─────────────────────────────────────────────────────

  it('inspects a token by jti through mocked identity client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(identityClient({
      inspectIdentityToken: async (jti: string) => {
        calls.push('identity:token:inspect:' + jti)
        return {
          token: {
            jti,
            actor: 'operator',
            issuer: 'meristem-local',
            audience: 'meristem-core',
            issuedAt: '2026-06-01T10:00:00.000Z',
            expiresAt: '2026-06-01T18:00:00.000Z',
            issuedBy: 'security-admin',
            purpose: 'CLI access',
            status: 'active'
          }
        }
      }
    }))

    const result = await cli.run(['identity', 'token', 'inspect', 'jti-inspect-001'])

    // FAILS RED: CLI runner does not dispatch 'identity' commands yet.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['identity:token:inspect:jti-inspect-001'])
    expect(result.stdout).toContain('"jti": "jti-inspect-001"')
    expect(result.stdout).toContain('"status": "active"')
    // Token inspect must never return plaintext.
    expect(result.stdout).not.toContain('"token": "eyJ')
  })

  it('fails token inspect without jti', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['identity', 'token', 'inspect'])

    // FAILS RED: CLI runner does not dispatch 'identity' commands yet.
    expect(result.exitCode).toBe(1)
  })

  // ── token revoke ──────────────────────────────────────────────────────

  it('revokes a token by jti through mocked identity client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(identityClient({
      revokeIdentityToken: async (jti: string, input: Record<string, string>) => {
        const reason = input?.reason ?? 'no-reason'
        calls.push('identity:token:revoke:' + jti + ':' + reason)
        return {
          token: {
            jti,
            actor: 'operator',
            issuer: 'meristem-local',
            audience: 'meristem-core',
            issuedAt: '2026-06-01T10:00:00.000Z',
            expiresAt: '2026-06-01T18:00:00.000Z',
            issuedBy: 'security-admin',
            purpose: 'CLI access',
            status: 'revoked',
            revokedAt: '2026-06-01T14:00:00.000Z',
            revokedBy: 'security-admin',
            revokeReason: reason ?? 'manual revocation'
          }
        }
      }
    }))

    const result = await cli.run([
      'identity', 'token', 'revoke',
      'jti-revoke-001',
      '--reason', 'suspected compromise'
    ])

    // FAILS RED: CLI runner does not dispatch 'identity' commands yet.
    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['identity:token:revoke:jti-revoke-001:suspected compromise'])
    expect(result.stdout).toContain('"jti": "jti-revoke-001"')
    expect(result.stdout).toContain('"status": "revoked"')
    expect(result.stdout).toContain('"revokeReason": "suspected compromise"')
  })

  it('revokes a token without reason (optional)', async () => {
    const calls: string[] = []
    const cli = createCliRunner(identityClient({
      revokeIdentityToken: async (jti: string, _input?: Record<string, string>) => {
        calls.push('identity:token:revoke:' + jti)
        return {
          token: {
            jti,
            actor: 'viewer',
            issuer: 'meristem-local',
            audience: 'meristem-core',
            issuedAt: '2026-06-01T10:00:00.000Z',
            expiresAt: '2026-06-01T18:00:00.000Z',
            issuedBy: 'security-admin',
            purpose: 'read-only access',
            status: 'revoked',
            revokedAt: '2026-06-01T14:00:00.000Z',
            revokedBy: 'security-admin'
          }
        }
      }
    }))

    const result = await cli.run(['identity', 'token', 'revoke', 'jti-revoke-002'])

    // FAILS RED: CLI runner does not dispatch 'identity' commands yet.
    // Once wired, missing reason should yield exitCode 1 with usage error.
    expect(result.exitCode).toBe(1)
  })

  it('fails token revoke without jti', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['identity', 'token', 'revoke'])

    // FAILS RED: CLI runner does not dispatch 'identity' commands yet.
    expect(result.exitCode).toBe(1)
  })

  // ── cross-cutting: sentinel values in mock returns ────────────────────

  it('returns unique sentinel jti values for grep-ability', async () => {
    const cli = createCliRunner(identityClient({
      issueIdentityToken: async (input: { actor: string }) => {
        return {
          token: 'mock-token-for-' + input.actor,
          jti: 'SENTINEL-CLI-ISSUE-001',
          actor: input.actor,
          issuer: 'meristem-local',
          audience: 'meristem-core',
          issuedAt: '2026-06-02T00:00:00.000Z',
          expiresAt: '2026-06-03T00:00:00.000Z',
          issuedBy: 'security-admin',
          purpose: 'sentinel test',
          status: 'active'
        }
      }
    }))

    const result = await cli.run([
      'identity', 'token', 'issue',
      '--actor', 'operator',
      '--ttl', '24h',
      '--purpose', 'sentinel'
    ])

    // FAILS RED: CLI runner does not dispatch 'identity' commands yet.
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('SENTINEL-CLI-ISSUE-001')
    expect(result.stdout).toContain('mock-token-for-operator')
  })

  // ── CLI error: missing required client method ────────────────────────

  it('fails when identity client method is not provided', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['identity', 'actor', 'list'])

    // FAILS RED: CLI runner does not dispatch 'identity' commands yet.
    // Once wired, missing method will yield 'CLI client missing listActors'.
    expect(result.exitCode).toBe(1)
  })
})
