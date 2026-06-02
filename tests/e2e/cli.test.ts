import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { startProcess, type ManagedProcess } from '../helpers/process.ts'
import {
  infrastructureAvailable,
  startFullStack,
  stopFullStack,
  runTextCommand,
  baseEnv
} from './_shared.ts'

const infraOk = await infrastructureAvailable()

if (!infraOk) {
  describe('e2e: CLI', () => {
    it('skipped: PostgreSQL or NATS is not available (run docker compose up -d postgres nats)', () => {
      expect(true).toBe(true)
    })
  })
} else {
  let devAll: ManagedProcess
  let bffProcess: ManagedProcess
  let operatorToken = ''
  let viewerToken = ''
  let securityAdminToken = ''
  let leafName = ''
  let networkName = ''

  describe('e2e: CLI', () => {
    beforeAll(async () => {
      const stack = await startFullStack()
      devAll = stack.devAll
      bffProcess = stack.bffProcess
      operatorToken = stack.operatorToken
      viewerToken = stack.viewerToken
      securityAdminToken = stack.securityAdminToken
      leafName = `e2e-cli-leaf-${Date.now()}`
      networkName = `e2e-cli-net-${Date.now()}`
      const leaf = await runTextCommand([
        'meristem',
        'node',
        'register',
        '--kind',
        'leaf',
        '--name',
        leafName,
        '--mode',
        'simulated'
      ], { MERISTEM_TOKEN: operatorToken })
      expect(JSON.parse(leaf)).toHaveProperty('node')
      const network = await runTextCommand(['meristem', 'network', 'create', '--name', networkName], { MERISTEM_TOKEN: operatorToken })
      expect(JSON.parse(network)).toHaveProperty('network')
    }, 60_000)

    afterAll(async () => {
      await stopFullStack(devAll, bffProcess)
    }, 30_000)

    describe('happy path commands', () => {
      it('status returns core info', async () => {
        const out = await runTextCommand(['meristem', 'status'], { MERISTEM_TOKEN: operatorToken })
        const body = JSON.parse(out) as { core: { id: string } }
        expect(body.core.id).toBe('meristem-core')
      })

      it('node list returns nodes', async () => {
        const out = await runTextCommand(['meristem', 'node', 'list'], { MERISTEM_TOKEN: operatorToken })
        const body = JSON.parse(out) as { nodes: Array<{ name: string }> }
        expect(body.nodes.some((n) => n.name === leafName)).toBe(true)
      })

      it('network list returns networks', async () => {
        const out = await runTextCommand(['meristem', 'network', 'list'], { MERISTEM_TOKEN: operatorToken })
        const body = JSON.parse(out) as { networks: Array<{ name: string }> }
        expect(body.networks.some((n) => n.name === networkName)).toBe(true)
      })

      it('log timeline returns entries', async () => {
        const out = await runTextCommand(['meristem', 'log', 'timeline'], { MERISTEM_TOKEN: operatorToken })
        const body = JSON.parse(out) as { entries: Array<unknown> }
        expect(Array.isArray(body.entries)).toBe(true)
      })

      it('audit list returns entries for security-admin', async () => {
        const out = await runTextCommand(['meristem', 'audit', 'list'], { MERISTEM_TOKEN: securityAdminToken })
        const body = JSON.parse(out) as { entries: Array<unknown> }
        expect(Array.isArray(body.entries)).toBe(true)
        expect(body.entries.length).toBeGreaterThan(0)
      })

      it('service list returns services', async () => {
        const out = await runTextCommand(['meristem', 'service', 'list'], { MERISTEM_TOKEN: operatorToken })
        const body = JSON.parse(out) as { services: Array<{ id: string }> }
        expect(Array.isArray(body.services)).toBe(true)
      })
    })

    describe('identity v0.2', () => {
      it('actor list returns actors for security-admin', async () => {
        // FAILS RED: identity CLI commands not wired yet → usage error
        const out = await runTextCommand(
          ['meristem', 'identity', 'actor', 'list'],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const body = JSON.parse(out) as { actors: Array<{ id: string; displayName: string }> }
        expect(Array.isArray(body.actors)).toBe(true)
        expect(body.actors.some((a) => a.id === 'operator')).toBe(true)
        expect(body.actors.some((a) => a.id === 'security-admin')).toBe(true)
      })

      it('actor show returns a single actor for security-admin', async () => {
        const out = await runTextCommand(
          ['meristem', 'identity', 'actor', 'show', 'operator'],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const body = JSON.parse(out) as { actor: { id: string; displayName: string; status: string } }
        expect(body.actor.id).toBe('operator')
        expect(body.actor.status).toBe('active')
        expect(typeof body.actor.displayName).toBe('string')
      })

      it('token issue returns jti and plaintext token for security-admin', async () => {
        const out = await runTextCommand(
          ['meristem', 'identity', 'token', 'issue', '--actor', 'operator', '--ttl', '1h', '--purpose', 'E2E-CLI-ISSUE smoke'],
          { MERISTEM_TOKEN: securityAdminToken }
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
        // First issue a token to inspect
        const issueOut = await runTextCommand(
          ['meristem', 'identity', 'token', 'issue', '--actor', 'viewer', '--ttl', '1h', '--purpose', 'E2E-CLI-INSPECT test'],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const issueBody = JSON.parse(issueOut) as { jti: string; token: string }

        // Then inspect it
        const out = await runTextCommand(
          ['meristem', 'identity', 'token', 'inspect', issueBody.jti],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const body = JSON.parse(out) as {
          token: { jti: string; actor: string; status: string }
        }
        expect(body.token.jti).toBe(issueBody.jti)
        expect(body.token.status).toBe('active')
        // Token inspect must never return plaintext
        expect(JSON.stringify(body)).not.toContain(issueBody.token)
        expect(JSON.stringify(body)).not.toContain('"token": "ey')
      })

      it('token revoke changes status and prevents further use for security-admin', async () => {
        // Issue
        const issueOut = await runTextCommand(
          ['meristem', 'identity', 'token', 'issue', '--actor', 'operator', '--ttl', '1h', '--purpose', 'E2E-CLI-REVOKE test'],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const issueBody = JSON.parse(issueOut) as { jti: string; token: string }

        // Revoke
        const revokeOut = await runTextCommand(
          ['meristem', 'identity', 'token', 'revoke', issueBody.jti, '--reason', 'E2E CLI revoke test'],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const revokeBody = JSON.parse(revokeOut) as {
          token: { jti: string; status: string; revokeReason: string }
        }
        expect(revokeBody.token.jti).toBe(issueBody.jti)
        expect(revokeBody.token.status).toBe('revoked')
        expect(revokeBody.token.revokeReason).toBe('E2E CLI revoke test')

        // Inspect after revoke
        const inspectOut = await runTextCommand(
          ['meristem', 'identity', 'token', 'inspect', issueBody.jti],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const inspectBody = JSON.parse(inspectOut) as {
          token: { status: string }
        }
        expect(inspectBody.token.status).toBe('revoked')
      })
    })

    describe('auth failure modes', () => {
      it('viewer audit list fails with 403', async () => {
        const proc = startProcess(['bun', 'run', 'meristem', 'audit', 'list'], {
          env: { ...baseEnv, MERISTEM_TOKEN: viewerToken }
        })
        const exitCode = await proc.exited
        expect(exitCode).not.toBe(0)
        expect(proc.stderr).toContain('permission denied')
      })

      it('viewer node register fails with 403', async () => {
        const proc = startProcess(['bun', 'run', 'meristem', 'node', 'register', '--kind', 'leaf', '--name', 'viewer-leaf-2'], {
          env: { ...baseEnv, MERISTEM_TOKEN: viewerToken }
        })
        const exitCode = await proc.exited
        expect(exitCode).not.toBe(0)
        expect(proc.stderr).toContain('permission denied')
      })

      it('operator cannot issue identity tokens (lacks identity:token-issue)', async () => {
        // FAILS RED: identity CLI commands not wired yet → usage error
        const proc = startProcess(
          ['bun', 'run', 'meristem', 'identity', 'token', 'issue', '--actor', 'viewer', '--ttl', '1h', '--purpose', 'E2E-CLI-AUTH fail'],
          { env: { ...baseEnv, MERISTEM_TOKEN: operatorToken } }
        )
        const exitCode = await proc.exited
        expect(exitCode).not.toBe(0)
        expect(proc.stderr).toContain('permission denied')
      })

      it('viewer cannot list actors (lacks identity:read on others)', async () => {
        const proc = startProcess(
          ['bun', 'run', 'meristem', 'identity', 'actor', 'list'],
          { env: { ...baseEnv, MERISTEM_TOKEN: viewerToken } }
        )
        const exitCode = await proc.exited
        expect(exitCode).not.toBe(0)
        expect(proc.stderr).toContain('permission denied')
      })

      it('operator cannot revoke tokens (lacks identity:token-revoke)', async () => {
        const proc = startProcess(
          ['bun', 'run', 'meristem', 'identity', 'token', 'revoke', 'E2E-CLI-REVOKE-fake-jti', '--reason', 'unauthorized'],
          { env: { ...baseEnv, MERISTEM_TOKEN: operatorToken } }
        )
        const exitCode = await proc.exited
        expect(exitCode).not.toBe(0)
        expect(proc.stderr).toContain('permission denied')
      })
    })
  })
}
