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

  describe('e2e: CLI', () => {
    beforeAll(async () => {
      const stack = await startFullStack()
      devAll = stack.devAll
      bffProcess = stack.bffProcess
      operatorToken = stack.operatorToken
      viewerToken = stack.viewerToken
      securityAdminToken = stack.securityAdminToken
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
        expect(body.nodes.some((n) => n.name === 'e2e-leaf')).toBe(true)
      })

      it('network list returns networks', async () => {
        const out = await runTextCommand(['meristem', 'network', 'list'], { MERISTEM_TOKEN: operatorToken })
        const body = JSON.parse(out) as { networks: Array<{ name: string }> }
        expect(body.networks.some((n) => n.name === 'e2e-net')).toBe(true)
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

    describe('auth failure modes', () => {
      it('viewer audit list fails with 403', async () => {
        const proc = startProcess(['bun', 'run', 'meristem', 'audit', 'list'], {
          env: { ...baseEnv, MERISTEM_TOKEN: viewerToken }
        })
        const exitCode = await proc.exited
        expect(exitCode).not.toBe(0)
        expect(proc.stderr).toContain('403')
      })

      it('viewer node register fails with 403', async () => {
        const proc = startProcess(['bun', 'run', 'meristem', 'node', 'register', '--kind', 'leaf', '--name', 'viewer-leaf-2'], {
          env: { ...baseEnv, MERISTEM_TOKEN: viewerToken }
        })
        const exitCode = await proc.exited
        expect(exitCode).not.toBe(0)
        expect(proc.stderr).toContain('403')
      })
    })
  })
}
