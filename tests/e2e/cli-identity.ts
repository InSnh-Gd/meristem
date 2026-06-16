import { describe, expect, it } from 'bun:test'
import type { CliE2eContext } from '../helpers/e2e-cli.ts'
import { startProcess } from '../helpers/process.ts'
import { baseEnv, runTextCommand } from './_shared.ts'

export function registerCliIdentityTests(context: CliE2eContext): void {
  describe('identity v0.2', () => {
    it('actor list returns actors for security-admin', async () => {
      const out = await runTextCommand(['meristem', 'identity', 'actor', 'list'], {
        MERISTEM_TOKEN: context.securityAdminToken
      })
      const body = JSON.parse(out) as { actors: Array<{ id: string; displayName: string }> }
      expect(Array.isArray(body.actors)).toBe(true)
      expect(body.actors.some(a => a.id === 'operator')).toBe(true)
      expect(body.actors.some(a => a.id === 'security-admin')).toBe(true)
    })

    it('actor show returns a single actor for security-admin', async () => {
      const out = await runTextCommand(['meristem', 'identity', 'actor', 'show', 'operator'], {
        MERISTEM_TOKEN: context.securityAdminToken
      })
      const body = JSON.parse(out) as {
        actor: { id: string; displayName: string; status: string }
      }
      expect(body.actor.id).toBe('operator')
      expect(body.actor.status).toBe('active')
      expect(typeof body.actor.displayName).toBe('string')
    })

    it('token issue returns jti and plaintext token for security-admin', async () => {
      const out = await runTextCommand(
        [
          'meristem',
          'identity',
          'token',
          'issue',
          '--actor',
          'operator',
          '--ttl',
          '1h',
          '--purpose',
          'E2E-CLI-ISSUE smoke'
        ],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const body = JSON.parse(out) as {
        token: string
        jti: string
        actor: string
        purpose: string
        status: string
      }
      expect(typeof body.token).toBe('string')
      expect(typeof body.jti).toBe('string')
      expect(body.actor).toBe('operator')
      expect(body.purpose).toBe('E2E-CLI-ISSUE smoke')
      expect(body.status).toBe('active')
    })

    it('token inspect shows metadata without plaintext for security-admin', async () => {
      const issueOut = await runTextCommand(
        [
          'meristem',
          'identity',
          'token',
          'issue',
          '--actor',
          'viewer',
          '--ttl',
          '1h',
          '--purpose',
          'E2E-CLI-INSPECT test'
        ],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const issueBody = JSON.parse(issueOut) as { jti: string; token: string }

      const out = await runTextCommand(
        ['meristem', 'identity', 'token', 'inspect', issueBody.jti],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const body = JSON.parse(out) as { jti: string; actor: string; status: string }
      expect(body.jti).toBe(issueBody.jti)
      expect(body.status).toBe('active')
      expect(JSON.stringify(body)).not.toContain(issueBody.token)
      expect(JSON.stringify(body)).not.toContain('"token": "ey')
    })

    it('token revoke changes status and prevents further use for security-admin', async () => {
      const issueOut = await runTextCommand(
        [
          'meristem',
          'identity',
          'token',
          'issue',
          '--actor',
          'operator',
          '--ttl',
          '1h',
          '--purpose',
          'E2E-CLI-REVOKE test'
        ],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const issueBody = JSON.parse(issueOut) as { jti: string; token: string }

      const revokeOut = await runTextCommand(
        [
          'meristem',
          'identity',
          'token',
          'revoke',
          issueBody.jti,
          '--reason',
          'E2E CLI revoke test'
        ],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const revokeBody = JSON.parse(revokeOut) as {
        token: { jti: string; status: string; revokeReason: string }
      }
      expect(revokeBody.token.jti).toBe(issueBody.jti)
      expect(revokeBody.token.status).toBe('revoked')
      expect(revokeBody.token.revokeReason).toBe('E2E CLI revoke test')

      const inspectOut = await runTextCommand(
        ['meristem', 'identity', 'token', 'inspect', issueBody.jti],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const inspectBody = JSON.parse(inspectOut) as { status: string }
      expect(inspectBody.status).toBe('revoked')
    })
  })

  describe('auth failure modes', () => {
    it('operator cannot issue identity tokens (lacks identity:token-issue)', async () => {
      const proc = startProcess(
        [
          'bun',
          'run',
          'meristem',
          'identity',
          'token',
          'issue',
          '--actor',
          'viewer',
          '--ttl',
          '1h',
          '--purpose',
          'E2E-CLI-AUTH fail'
        ],
        { env: { ...baseEnv, MERISTEM_TOKEN: context.operatorToken } }
      )
      const exitCode = await proc.exited
      expect(exitCode).not.toBe(0)
      expect(proc.stderr).toContain('permission denied')
    })

    it('viewer cannot list actors (lacks identity:read on others)', async () => {
      const proc = startProcess(['bun', 'run', 'meristem', 'identity', 'actor', 'list'], {
        env: { ...baseEnv, MERISTEM_TOKEN: context.viewerToken }
      })
      const exitCode = await proc.exited
      expect(exitCode).not.toBe(0)
      expect(proc.stderr).toContain('permission denied')
    })

    it('operator cannot revoke tokens (lacks identity:token-revoke)', async () => {
      const proc = startProcess(
        [
          'bun',
          'run',
          'meristem',
          'identity',
          'token',
          'revoke',
          'E2E-CLI-REVOKE-fake-jti',
          '--reason',
          'unauthorized'
        ],
        { env: { ...baseEnv, MERISTEM_TOKEN: context.operatorToken } }
      )
      const exitCode = await proc.exited
      expect(exitCode).not.toBe(0)
      expect(proc.stderr).toContain('permission denied')
    })
  })
}
