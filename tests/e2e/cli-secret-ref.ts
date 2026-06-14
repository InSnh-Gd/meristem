import { describe, expect, it } from 'bun:test'
import { startProcess } from '../helpers/process.ts'
import { CLI_SECRET_SENTINEL, type CliE2eContext } from '../helpers/e2e-cli.ts'
import { baseEnv, runTextCommand } from './_shared.ts'

export function registerCliSecretRefTests(context: CliE2eContext): void {
  describe('secretRef v0.1', () => {
    let createdSecretId = ''

    it('secret list returns secrets for security-admin', async () => {
      const out = await runTextCommand(['meristem', 'secret', 'list'], {
        MERISTEM_TOKEN: context.securityAdminToken
      })
      const body = JSON.parse(out) as Array<{ id: string; name: string; status: string }>
      expect(Array.isArray(body)).toBe(true)
      expect(out).not.toContain(CLI_SECRET_SENTINEL)
      expect(out).not.toContain('"value"')
      expect(out).not.toContain('"plaintext"')
    })

    it('secret create returns metadata without plaintext', async () => {
      const secretName = `e2e-cli-secret-${Date.now()}`
      const out = await runTextCommand(
        [
          'meristem',
          'secret',
          'create',
          '--name',
          secretName,
          '--scope',
          'service',
          '--value',
          CLI_SECRET_SENTINEL
        ],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const body = JSON.parse(out) as {
        id: string
        name: string
        status: string
        createdAt: string
      }
      expect(body.name).toBe(secretName)
      expect(body.status).toBe('active')
      expect(out).not.toContain(CLI_SECRET_SENTINEL)
      expect(out).not.toContain('"value"')
      expect(out).not.toContain('"plaintext"')
      expect(out).not.toContain('"secret"')
      createdSecretId = body.id
    })

    it('secret show returns a single secret ref for security-admin', async () => {
      let secretId = createdSecretId
      if (!secretId) {
        const createOut = await runTextCommand(
          [
            'meristem',
            'secret',
            'create',
            '--name',
            `e2e-cli-show-${Date.now()}`,
            '--scope',
            'system',
            '--value',
            CLI_SECRET_SENTINEL
          ],
          { MERISTEM_TOKEN: context.securityAdminToken }
        )
        const createBody = JSON.parse(createOut) as { id: string }
        secretId = createBody.id
      }

      const out = await runTextCommand(['meristem', 'secret', 'show', secretId], {
        MERISTEM_TOKEN: context.securityAdminToken
      })
      const body = JSON.parse(out) as { id: string; name: string; status: string }
      expect(body.id).toBe(secretId)
      expect(out).not.toContain(CLI_SECRET_SENTINEL)
      expect(out).not.toContain('"value"')
      expect(out).not.toContain('"plaintext"')
    })

    it('secret rotate updates status to rotated for security-admin', async () => {
      let secretId = createdSecretId
      if (!secretId) {
        const createOut = await runTextCommand(
          [
            'meristem',
            'secret',
            'create',
            '--name',
            `e2e-cli-rotate-${Date.now()}`,
            '--scope',
            'node',
            '--value',
            CLI_SECRET_SENTINEL
          ],
          { MERISTEM_TOKEN: context.securityAdminToken }
        )
        const createBody = JSON.parse(createOut) as { id: string }
        secretId = createBody.id
      }

      const out = await runTextCommand(
        [
          'meristem',
          'secret',
          'rotate',
          secretId,
          '--value',
          CLI_SECRET_SENTINEL,
          '--reason',
          'E2E-CLI-ROTATE smoke test'
        ],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const body = JSON.parse(out) as {
        id: string
        status: string
        rotatedAt: string
        version: string
      }
      expect(body.status).toBe('rotated')
      expect(typeof body.rotatedAt).toBe('string')
      expect(out).not.toContain(CLI_SECRET_SENTINEL)
      expect(out).not.toContain('"value"')
      expect(out).not.toContain('"plaintext"')
    })

    it('secret disable marks the secret as disabled for security-admin', async () => {
      const createOut = await runTextCommand(
        [
          'meristem',
          'secret',
          'create',
          '--name',
          `e2e-cli-disable-${Date.now()}`,
          '--scope',
          'service',
          '--value',
          CLI_SECRET_SENTINEL
        ],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const createBody = JSON.parse(createOut) as { id: string }
      const secretId = createBody.id

      const out = await runTextCommand(
        ['meristem', 'secret', 'disable', secretId, '--reason', 'E2E-CLI-DISABLE smoke test'],
        { MERISTEM_TOKEN: context.securityAdminToken }
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
      const proc = startProcess(['bun', 'run', 'meristem', 'secret', 'list'], {
        env: { ...baseEnv, MERISTEM_TOKEN: context.viewerToken }
      })
      const exitCode = await proc.exited
      expect(exitCode).not.toBe(0)
      expect(proc.stderr).toContain('permission denied')
    })

    it('operator cannot create secrets (lacks secret:create)', async () => {
      const proc = startProcess(
        [
          'bun',
          'run',
          'meristem',
          'secret',
          'create',
          '--name',
          'operator-secret',
          '--scope',
          'service',
          '--value',
          'should-not-create'
        ],
        { env: { ...baseEnv, MERISTEM_TOKEN: context.operatorToken } }
      )
      const exitCode = await proc.exited
      expect(exitCode).not.toBe(0)
      expect(proc.stderr).toContain('permission denied')
    })

    it('operator cannot rotate secrets (lacks secret:rotate)', async () => {
      const proc = startProcess(
        [
          'bun',
          'run',
          'meristem',
          'secret',
          'rotate',
          'E2E-CLI-OP-ROTATE-fake',
          '--value',
          'should-not-rotate',
          '--reason',
          'unauthorized'
        ],
        { env: { ...baseEnv, MERISTEM_TOKEN: context.operatorToken } }
      )
      const exitCode = await proc.exited
      expect(exitCode).not.toBe(0)
      expect(proc.stderr).toContain('permission denied')
    })

    it('viewer cannot disable secrets (lacks secret:disable)', async () => {
      const proc = startProcess(
        [
          'bun',
          'run',
          'meristem',
          'secret',
          'disable',
          'E2E-CLI-VW-DISABLE-fake',
          '--reason',
          'unauthorized'
        ],
        { env: { ...baseEnv, MERISTEM_TOKEN: context.viewerToken } }
      )
      const exitCode = await proc.exited
      expect(exitCode).not.toBe(0)
      expect(proc.stderr).toContain('permission denied')
    })
  })
}
