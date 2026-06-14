import { describe, expect, it } from 'bun:test'
import { startProcess } from '../helpers/process.ts'
import type { CliE2eContext } from '../helpers/e2e-cli.ts'
import { baseEnv } from './_shared.ts'

export function registerCliAuthFailureTests(context: CliE2eContext): void {
  describe('auth failure modes', () => {
    it('viewer audit list fails with 403', async () => {
      const proc = startProcess(['bun', 'run', 'meristem', 'audit', 'list'], {
        env: { ...baseEnv, MERISTEM_TOKEN: context.viewerToken }
      })
      const exitCode = await proc.exited
      expect(exitCode).not.toBe(0)
      expect(proc.stderr).toContain('permission denied')
    })

    it('viewer node register fails with 403', async () => {
      const proc = startProcess(
        ['bun', 'run', 'meristem', 'node', 'register', '--kind', 'leaf', '--name', 'viewer-leaf-2'],
        {
          env: { ...baseEnv, MERISTEM_TOKEN: context.viewerToken }
        }
      )
      const exitCode = await proc.exited
      expect(exitCode).not.toBe(0)
      expect(proc.stderr).toContain('permission denied')
    })
  })
}
