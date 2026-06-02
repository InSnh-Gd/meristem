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

    describe('config lifecycle v0.1', () => {
      it('drafts a config through CLI', async () => {
        // FAILS RED: config CLI commands not wired yet → usage error
        const out = await runTextCommand(
          [
            'meristem', 'config', 'draft',
            '--domain', 'core',
            '--file', '/tmp/e2e-config.json'
          ],
          { MERISTEM_TOKEN: operatorToken }
        )
        const body = JSON.parse(out) as {
          config: {
            id: string
            configVersion: string
            configHash: string
            domain: string
            status: string
          }
        }
        expect(body.config.domain).toBe('core')
        expect(body.config.status).toBe('draft')
        expect(typeof body.config.id).toBe('string')
        expect(typeof body.config.configHash).toBe('string')
      })

      it('lists configs through CLI', async () => {
        const out = await runTextCommand(
          ['meristem', 'config', 'list'],
          { MERISTEM_TOKEN: operatorToken }
        )
        const body = JSON.parse(out) as {
          configs: Array<{ id: string; status: string }>
        }
        expect(Array.isArray(body.configs)).toBe(true)
      })

      it('shows a single config through CLI', async () => {
        const out = await runTextCommand(
          ['meristem', 'config', 'show', 'E2E-CLI-CFG-001'],
          { MERISTEM_TOKEN: operatorToken }
        )
        const body = JSON.parse(out) as {
          config: { id: string; status: string; domain: string }
        }
        expect(body.config.id).toBe('E2E-CLI-CFG-001')
        expect(typeof body.config.status).toBe('string')
        expect(typeof body.config.domain).toBe('string')
      })

      it('validates a config through CLI', async () => {
        const out = await runTextCommand(
          ['meristem', 'config', 'validate', 'E2E-CLI-CFG-001'],
          { MERISTEM_TOKEN: operatorToken }
        )
        const body = JSON.parse(out) as {
          config: { id: string; status: string; configHash: string }
        }
        expect(body.config.id).toBe('E2E-CLI-CFG-001')
        expect(body.config.status).toBe('validated')
        expect(typeof body.config.configHash).toBe('string')
      })

      it('publishes a config through CLI with reason', async () => {
        const out = await runTextCommand(
          [
            'meristem', 'config', 'publish',
            'E2E-CLI-CFG-001',
            '--reason', 'E2E CLI smoke publish'
          ],
          { MERISTEM_TOKEN: operatorToken }
        )
        const body = JSON.parse(out) as {
          config: {
            id: string
            status: string
            publishedBy: string
            publishedAt: string
          }
        }
        expect(body.config.id).toBe('E2E-CLI-CFG-001')
        expect(body.config.status).toBe('published')
        expect(typeof body.config.publishedBy).toBe('string')
        expect(typeof body.config.publishedAt).toBe('string')
      })

      it('rolls back a config through CLI', async () => {
        const out = await runTextCommand(
          [
            'meristem', 'config', 'rollback',
            'E2E-CLI-CFG-001',
            '--to', '1.0.0',
            '--reason', 'E2E CLI smoke rollback'
          ],
          { MERISTEM_TOKEN: operatorToken }
        )
        const body = JSON.parse(out) as {
          config: { id: string; status: string; rollbackVersion: string }
        }
        expect(body.config.id).toBe('E2E-CLI-CFG-001')
        expect(body.config.status).toBe('rolled_back')
        expect(body.config.rollbackVersion).toBe('1.0.0')
      })

      it('full config lifecycle CLI flow: draft → validate → publish → rollback', async () => {
        // ── draft ──
        const draftOut = await runTextCommand(
          [
            'meristem', 'config', 'draft',
            '--domain', 'm-net',
            '--file', '/tmp/e2e-lifecycle-config.json'
          ],
          { MERISTEM_TOKEN: operatorToken }
        )
        const draftBody = JSON.parse(draftOut) as {
          config: { id: string; configVersion: string; status: string }
        }
        expect(draftBody.config.status).toBe('draft')
        const configId = draftBody.config.id
        const configVersion = draftBody.config.configVersion

        // ── validate ──
        const validateOut = await runTextCommand(
          ['meristem', 'config', 'validate', configId],
          { MERISTEM_TOKEN: operatorToken }
        )
        const validateBody = JSON.parse(validateOut) as {
          config: { id: string; status: string }
        }
        expect(validateBody.config.id).toBe(configId)
        expect(validateBody.config.status).toBe('validated')

        // ── publish ──
        const publishOut = await runTextCommand(
          [
            'meristem', 'config', 'publish',
            configId,
            '--reason', 'E2E CLI lifecycle smoke'
          ],
          { MERISTEM_TOKEN: operatorToken }
        )
        const publishBody = JSON.parse(publishOut) as {
          config: { id: string; status: string; publishedBy: string }
        }
        expect(publishBody.config.id).toBe(configId)
        expect(publishBody.config.status).toBe('published')
        expect(typeof publishBody.config.publishedBy).toBe('string')

        // ── rollback ──
        const rollbackOut = await runTextCommand(
          [
            'meristem', 'config', 'rollback',
            configId,
            '--to', configVersion,
            '--reason', 'E2E CLI lifecycle rollback'
          ],
          { MERISTEM_TOKEN: operatorToken }
        )
        const rollbackBody = JSON.parse(rollbackOut) as {
          config: { id: string; status: string; rollbackVersion: string }
        }
        expect(rollbackBody.config.id).toBe(configId)
        expect(rollbackBody.config.status).toBe('rolled_back')
        expect(rollbackBody.config.rollbackVersion).toBe(configVersion)
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

    describe('secretRef v0.1', () => {
      const SENTINEL = 'MERISTEM_TEST_SECRET_DO_NOT_LOG'
      let createdSecretId = ''

      it('secret list returns secrets for security-admin', async () => {
        // FAILS RED: CLI secret commands not wired yet → usage error
        const out = await runTextCommand(
          ['meristem', 'secret', 'list'],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const body = JSON.parse(out) as { secrets: Array<{ id: string; name: string; status: string }> }
        expect(Array.isArray(body.secrets)).toBe(true)
        // No value leaks in list output.
        expect(out).not.toContain(SENTINEL)
        expect(out).not.toContain('"value"')
        expect(out).not.toContain('"plaintext"')
      })

      it('secret create returns metadata without plaintext', async () => {
        const secretName = `e2e-cli-secret-${Date.now()}`
        const out = await runTextCommand(
          ['meristem', 'secret', 'create', '--name', secretName, '--scope', 'service'],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const body = JSON.parse(out) as {
          id: string
          name: string
          scope: string
          status: string
          owner: string
          version: string
        }
        expect(body.name).toBe(secretName)
        expect(body.scope).toBe('service')
        expect(body.status).toBe('active')
        expect(body.owner).toBe('core')
        expect(body.version).toBe('secret-ref@0.1.0')
        // Redaction: output must not contain sentinel or plaintext fields.
        expect(out).not.toContain(SENTINEL)
        expect(out).not.toContain('"value"')
        expect(out).not.toContain('"plaintext"')
        expect(out).not.toContain('"secret"')
        createdSecretId = body.id
      })

      it('secret show returns a single secret ref for security-admin', async () => {
        let secretId = createdSecretId
        if (!secretId) {
          // Create one first if not set.
          const createOut = await runTextCommand(
            ['meristem', 'secret', 'create', '--name', `e2e-cli-show-${Date.now()}`, '--scope', 'system'],
            { MERISTEM_TOKEN: securityAdminToken }
          )
          const createBody = JSON.parse(createOut) as { id: string }
          secretId = createBody.id
        }

        const out = await runTextCommand(
          ['meristem', 'secret', 'show', secretId],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const body = JSON.parse(out) as { id: string; name: string; status: string }
        expect(body.id).toBe(secretId)
        expect(out).not.toContain(SENTINEL)
        expect(out).not.toContain('"value"')
        expect(out).not.toContain('"plaintext"')
      })

      it('secret rotate updates status to rotated for security-admin', async () => {
        let secretId = createdSecretId
        if (!secretId) {
          const createOut = await runTextCommand(
            ['meristem', 'secret', 'create', '--name', `e2e-cli-rotate-${Date.now()}`, '--scope', 'node'],
            { MERISTEM_TOKEN: securityAdminToken }
          )
          const createBody = JSON.parse(createOut) as { id: string }
          secretId = createBody.id
        }

        const out = await runTextCommand(
          ['meristem', 'secret', 'rotate', secretId, '--reason', 'E2E-CLI-ROTATE smoke test'],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const body = JSON.parse(out) as {
          id: string
          status: string
          rotatedAt: string
          version: number
        }
        expect(body.status).toBe('rotated')
        expect(typeof body.rotatedAt).toBe('string')
        // Redaction: no plaintext in rotate output.
        expect(out).not.toContain(SENTINEL)
        expect(out).not.toContain('"value"')
        expect(out).not.toContain('"plaintext"')
      })

      it('secret disable marks the secret as disabled for security-admin', async () => {
        // Create a fresh secret to disable.
        const createOut = await runTextCommand(
          ['meristem', 'secret', 'create', '--name', `e2e-cli-disable-${Date.now()}`, '--scope', 'service'],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const createBody = JSON.parse(createOut) as { id: string }
        const secretId = createBody.id

        const out = await runTextCommand(
          ['meristem', 'secret', 'disable', secretId, '--reason', 'E2E-CLI-DISABLE smoke test'],
          { MERISTEM_TOKEN: securityAdminToken }
        )
        const body = JSON.parse(out) as {
          id: string
          status: string
          disabledAt: string
        }
        expect(body.status).toBe('disabled')
        expect(typeof body.disabledAt).toBe('string')
      })
    })

    describe('secretRef auth failure modes', () => {
      it('viewer secret list fails with permission denied', async () => {
        // FAILS RED: CLI secret commands not wired yet → usage error
        const proc = startProcess(
          ['bun', 'run', 'meristem', 'secret', 'list'],
          { env: { ...baseEnv, MERISTEM_TOKEN: viewerToken } }
        )
        const exitCode = await proc.exited
        expect(exitCode).not.toBe(0)
        expect(proc.stderr).toContain('permission denied')
      })

      it('operator cannot create secrets (lacks secret:create)', async () => {
        const proc = startProcess(
          ['bun', 'run', 'meristem', 'secret', 'create', '--name', 'operator-secret', '--scope', 'service'],
          { env: { ...baseEnv, MERISTEM_TOKEN: operatorToken } }
        )
        const exitCode = await proc.exited
        expect(exitCode).not.toBe(0)
        expect(proc.stderr).toContain('permission denied')
      })

      it('operator cannot rotate secrets (lacks secret:rotate)', async () => {
        const proc = startProcess(
          ['bun', 'run', 'meristem', 'secret', 'rotate', 'E2E-CLI-OP-ROTATE-fake', '--reason', 'unauthorized'],
          { env: { ...baseEnv, MERISTEM_TOKEN: operatorToken } }
        )
        const exitCode = await proc.exited
        expect(exitCode).not.toBe(0)
        expect(proc.stderr).toContain('permission denied')
      })

      it('viewer cannot disable secrets (lacks secret:disable)', async () => {
        const proc = startProcess(
          ['bun', 'run', 'meristem', 'secret', 'disable', 'E2E-CLI-VW-DISABLE-fake', '--reason', 'unauthorized'],
          { env: { ...baseEnv, MERISTEM_TOKEN: viewerToken } }
        )
        const exitCode = await proc.exited
        expect(exitCode).not.toBe(0)
        expect(proc.stderr).toContain('permission denied')
      })
    })
  })
}
