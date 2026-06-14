import { describe, expect, it } from 'bun:test'
import type { CliE2eContext } from '../helpers/e2e-cli.ts'
import { baseEnv, coreFetch, runTextCommand } from './_shared.ts'

export function registerCliConfigLifecycleTests(context: CliE2eContext): void {
  describe('config lifecycle v0.1', () => {
    it('drafts a config through CLI', async () => {
      const out = await runTextCommand(
        [
          'meristem',
          'config',
          'draft',
          '--domain',
          'core',
          '--file',
          'tests/e2e/fixtures/config-draft.json'
        ],
        { MERISTEM_TOKEN: context.securityAdminToken }
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
      expect(body.config.status).toBe('draft')
      expect(typeof body.config.id).toBe('string')
      context.cliConfigId = body.config.id
      context.cliConfigVersion = body.config.configVersion
    })

    it('lists configs through CLI', async () => {
      const out = await runTextCommand(['meristem', 'config', 'list'], {
        MERISTEM_TOKEN: context.securityAdminToken
      })
      const body = JSON.parse(out) as {
        configs: Array<{ id: string; status: string }>
      }
      expect(Array.isArray(body.configs)).toBe(true)
    })

    it('shows a single config through CLI', async () => {
      const out = await runTextCommand(['meristem', 'config', 'show', context.cliConfigId], {
        MERISTEM_TOKEN: context.securityAdminToken
      })
      const body = JSON.parse(out) as {
        config: { id: string; status: string; domain: string }
      }
      expect(body.config.id).toBe(context.cliConfigId)
      expect(typeof body.config.status).toBe('string')
      expect(typeof body.config.domain).toBe('string')
    })

    it('validates a config through CLI', async () => {
      const out = await runTextCommand(['meristem', 'config', 'validate', context.cliConfigId], {
        MERISTEM_TOKEN: context.securityAdminToken
      })
      const body = JSON.parse(out) as {
        config: { id: string; status: string; configHash: string }
      }
      expect(body.config.id).toBe(context.cliConfigId)
      expect(body.config.status).toBe('validated')
    })

    it('publishes a config through CLI with reason', async () => {
      const out = await runTextCommand(
        ['meristem', 'config', 'publish', context.cliConfigId, '--reason', 'E2E CLI smoke publish'],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const body = JSON.parse(out) as {
        config: {
          id: string
          status: string
          publishedBy: string
          publishedAt: string
        }
      }
      expect(body.config.id).toBe(context.cliConfigId)
      expect(body.config.status).toBe('published')
      expect(typeof body.config.publishedBy).toBe('string')
      expect(typeof body.config.publishedAt).toBe('string')

      const ackRes = await coreFetch(
        `/internal/v0/configs/${context.cliConfigId}/apply-ack`,
        undefined,
        {
          method: 'POST',
          headers: { 'x-meristem-internal-token': baseEnv.MERISTEM_INTERNAL_TOKEN },
          body: JSON.stringify({
            configVersion: context.cliConfigVersion,
            targetService: 'm-net',
            status: 'acked'
          })
        }
      )
      expect(ackRes.status).toBe(200)
    })

    it('rolls back a config through CLI', async () => {
      const out = await runTextCommand(
        [
          'meristem',
          'config',
          'rollback',
          context.cliConfigId,
          '--to',
          context.cliConfigVersion,
          '--reason',
          'E2E CLI smoke rollback'
        ],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const body = JSON.parse(out) as {
        config: { id: string; status: string }
      }
      expect(body.config.id).toBe(context.cliConfigId)
      expect(body.config.status).toBe('rolled_back')
    })

    it('full config lifecycle CLI flow: draft → validate → publish → rollback', async () => {
      const draftOut = await runTextCommand(
        [
          'meristem',
          'config',
          'draft',
          '--domain',
          'm-net',
          '--file',
          'tests/e2e/fixtures/config-lifecycle.json'
        ],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const draftBody = JSON.parse(draftOut) as {
        config: { id: string; configVersion: string; status: string }
      }
      expect(draftBody.config.status).toBe('draft')
      const configId = draftBody.config.id
      const configVersion = draftBody.config.configVersion

      const validateOut = await runTextCommand(['meristem', 'config', 'validate', configId], {
        MERISTEM_TOKEN: context.securityAdminToken
      })
      const validateBody = JSON.parse(validateOut) as {
        config: { id: string; status: string }
      }
      expect(validateBody.config.id).toBe(configId)
      expect(validateBody.config.status).toBe('validated')

      const publishOut = await runTextCommand(
        ['meristem', 'config', 'publish', configId, '--reason', 'E2E CLI lifecycle smoke'],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const publishBody = JSON.parse(publishOut) as {
        config: { id: string; status: string; publishedBy: string }
      }
      expect(publishBody.config.id).toBe(configId)
      expect(publishBody.config.status).toBe('published')
      expect(typeof publishBody.config.publishedBy).toBe('string')

      const ackRes = await coreFetch(`/internal/v0/configs/${configId}/apply-ack`, undefined, {
        method: 'POST',
        headers: { 'x-meristem-internal-token': baseEnv.MERISTEM_INTERNAL_TOKEN },
        body: JSON.stringify({ configVersion, targetService: 'm-net', status: 'acked' })
      })
      expect(ackRes.status).toBe(200)

      const rollbackOut = await runTextCommand(
        [
          'meristem',
          'config',
          'rollback',
          configId,
          '--to',
          configVersion,
          '--reason',
          'E2E CLI lifecycle rollback'
        ],
        { MERISTEM_TOKEN: context.securityAdminToken }
      )
      const rollbackBody = JSON.parse(rollbackOut) as {
        config: { id: string; status: string }
      }
      expect(rollbackBody.config.id).toBe(configId)
      expect(rollbackBody.config.status).toBe('rolled_back')
    })
  })
}
