import { describe, expect, it } from 'bun:test'
import type { CliE2eContext } from '../helpers/e2e-cli.ts'
import { runTextCommand } from './_shared.ts'

export function registerCliHappyPathTests(context: CliE2eContext): void {
  describe('happy path commands', () => {
    it('status returns core info', async () => {
      const out = await runTextCommand(['meristem', 'status'], {
        MERISTEM_TOKEN: context.operatorToken
      })
      const body = JSON.parse(out) as { core: { id: string } }
      expect(body.core.id).toBe('meristem-core')
    })

    it('node list returns nodes', async () => {
      const out = await runTextCommand(['meristem', 'node', 'list'], {
        MERISTEM_TOKEN: context.operatorToken
      })
      const body = JSON.parse(out) as { nodes: Array<{ name: string }> }
      expect(body.nodes.some(n => n.name === context.leafName)).toBe(true)
    })

    it('network list returns networks', async () => {
      const out = await runTextCommand(['meristem', 'network', 'list'], {
        MERISTEM_TOKEN: context.operatorToken
      })
      const body = JSON.parse(out) as { networks: Array<{ name: string }> }
      expect(body.networks.some(n => n.name === context.networkName)).toBe(true)
    })

    it('log timeline returns entries', async () => {
      const out = await runTextCommand(['meristem', 'log', 'timeline'], {
        MERISTEM_TOKEN: context.operatorToken
      })
      const body = JSON.parse(out) as { entries: Array<unknown> }
      expect(Array.isArray(body.entries)).toBe(true)
    })

    it('audit list returns entries for security-admin', async () => {
      const out = await runTextCommand(['meristem', 'audit', 'list'], {
        MERISTEM_TOKEN: context.securityAdminToken
      })
      const body = JSON.parse(out) as { entries: Array<unknown> }
      expect(Array.isArray(body.entries)).toBe(true)
      expect(body.entries.length).toBeGreaterThan(0)
    })

    it('service list returns services', async () => {
      const out = await runTextCommand(['meristem', 'service', 'list'], {
        MERISTEM_TOKEN: context.operatorToken
      })
      const body = JSON.parse(out) as { services: Array<{ id: string }> }
      expect(Array.isArray(body.services)).toBe(true)
    })
  })
}
