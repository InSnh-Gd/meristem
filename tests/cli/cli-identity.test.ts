import { describe, expect, it } from 'bun:test'
import { type CliClient, createCliRunner } from '../../apps/m-cli/src/cli.ts'
import { createCliStatusMock, createIdentityCliClient } from '@meristem/testing'

// ---------------------------------------------------------------------------
// CLI identity tests exercise a focused mocked client surface.
//
// The helper narrows through `unknown` so the tests can provide just the
// identity methods they need without modeling the full client implementation.
// ---------------------------------------------------------------------------

/** Create a minimal CliClient without identity methods. */
function bareClient(): CliClient {
  return { status: createCliStatusMock }
}

// ---------------------------------------------------------------------------
// Identity CLI Tests
// ---------------------------------------------------------------------------

describe('meristem CLI — identity', () => {
  // ── actor list ────────────────────────────────────────────────────────

  it('lists actors through mocked identity client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      createIdentityCliClient({
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
      })
    )

    const result = await cli.run(['identity', 'actor', 'list'])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['identity:actor:list'])
    expect(result.stdout).toContain('"id": "operator"')
    expect(result.stdout).toContain('"id": "viewer"')
  })

  // ── actor show ────────────────────────────────────────────────────────

  it('shows a single actor through mocked identity client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      createIdentityCliClient({
        getActor: async (actorId: string) => {
          calls.push(`identity:actor:show:${actorId}`)
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
      })
    )

    const result = await cli.run(['identity', 'actor', 'show', 'security-admin'])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['identity:actor:show:security-admin'])
    expect(result.stdout).toContain('"id": "security-admin"')
    expect(result.stdout).toContain('"displayName": "Security Admin"')
  })

  it('fails actor show without actor id', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['identity', 'actor', 'show'])

    // Missing actor id should surface as a usage error.
    expect(result.exitCode).toBe(1)
  })

  // ── token issue ───────────────────────────────────────────────────────

  it('issues an actor token through mocked identity client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      createIdentityCliClient({
        issueIdentityToken: async (input: { actor: string; ttl: string; purpose: string }) => {
          calls.push(`identity:token:issue:${input.actor}:${input.ttl}:${input.purpose}`)
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
      })
    )

    const result = await cli.run([
      'identity',
      'token',
      'issue',
      '--actor',
      'operator',
      '--ttl',
      '8h',
      '--purpose',
      'runtime automation'
    ])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['identity:token:issue:operator:8h:runtime automation'])
    expect(result.stdout).toContain('"jti": "jti-issued-001"')
    expect(result.stdout).toContain('"token"')
    expect(result.stdout).toContain('"status": "active"')
  })

  it('fails token issue without actor arg', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run([
      'identity',
      'token',
      'issue',
      '--ttl',
      '8h',
      '--purpose',
      'missing actor'
    ])

    expect(result.exitCode).toBe(1)
  })

  // ── token inspect ─────────────────────────────────────────────────────

  it('inspects a token by jti through mocked identity client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      createIdentityCliClient({
        inspectIdentityToken: async (jti: string) => {
          calls.push(`identity:token:inspect:${jti}`)
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
      })
    )

    const result = await cli.run(['identity', 'token', 'inspect', 'jti-inspect-001'])

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

    expect(result.exitCode).toBe(1)
  })

  // ── token revoke ──────────────────────────────────────────────────────

  it('revokes a token by jti through mocked identity client', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      createIdentityCliClient({
        revokeIdentityToken: async (jti: string, input: Record<string, string>) => {
          const reason = input?.reason ?? 'no-reason'
          calls.push(`identity:token:revoke:${jti}:${reason}`)
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
      })
    )

    const result = await cli.run([
      'identity',
      'token',
      'revoke',
      'jti-revoke-001',
      '--reason',
      'suspected compromise'
    ])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['identity:token:revoke:jti-revoke-001:suspected compromise'])
    expect(result.stdout).toContain('"jti": "jti-revoke-001"')
    expect(result.stdout).toContain('"status": "revoked"')
    expect(result.stdout).toContain('"revokeReason": "suspected compromise"')
  })

  it('revokes a token without reason (optional)', async () => {
    const calls: string[] = []
    const cli = createCliRunner(
      createIdentityCliClient({
        revokeIdentityToken: async (jti: string, _input?: Record<string, string>) => {
          calls.push(`identity:token:revoke:${jti}`)
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
      })
    )

    const result = await cli.run(['identity', 'token', 'revoke', 'jti-revoke-002'])

    // The revoke command requires a reason in the current CLI contract.
    expect(result.exitCode).toBe(1)
  })

  it('fails token revoke without jti', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['identity', 'token', 'revoke'])

    expect(result.exitCode).toBe(1)
  })

  // ── cross-cutting: sentinel values in mock returns ────────────────────

  it('returns unique sentinel jti values for grep-ability', async () => {
    const cli = createCliRunner(
      createIdentityCliClient({
        issueIdentityToken: async (input: { actor: string }) => {
          return {
            token: `mock-token-for-${input.actor}`,
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
      })
    )

    const result = await cli.run([
      'identity',
      'token',
      'issue',
      '--actor',
      'operator',
      '--ttl',
      '24h',
      '--purpose',
      'sentinel'
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('SENTINEL-CLI-ISSUE-001')
    expect(result.stdout).toContain('mock-token-for-operator')
  })

  // ── CLI error: missing required client method ────────────────────────

  it('fails when identity client method is not provided', async () => {
    const cli = createCliRunner(bareClient())

    const result = await cli.run(['identity', 'actor', 'list'])

    // Missing client methods should surface as CLI usage failures.
    expect(result.exitCode).toBe(1)
  })
})
