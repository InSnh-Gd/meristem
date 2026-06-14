/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createCliE2eContext } from '../helpers/e2e-cli.ts'
import {
  runTextCommand,
  infrastructureAvailable,
  startFullStack,
  stopFullStack
} from './_shared.ts'
import { registerCliAuthFailureTests } from './cli-auth-failures.ts'
import { registerCliConfigLifecycleTests } from './cli-config-lifecycle.ts'
import { registerCliHappyPathTests } from './cli-happy-path.ts'
import { registerCliIdentityTests } from './cli-identity.ts'
import { registerCliSecretRefTests } from './cli-secret-ref.ts'

const infraOk = await infrastructureAvailable()

if (!infraOk) {
  describe('e2e: CLI', () => {
    it('skipped: PostgreSQL or NATS is not available (run docker compose up -d postgres nats)', () => {
      expect(true).toBe(true)
    })
  })
} else {
  const context = createCliE2eContext()

  describe('e2e: CLI', () => {
    beforeAll(async () => {
      const stack = await startFullStack()
      context.devAll = stack.devAll
      context.bffProcess = stack.bffProcess
      context.operatorToken = stack.operatorToken
      context.viewerToken = stack.viewerToken
      context.securityAdminToken = stack.securityAdminToken
      context.leafName = `e2e-cli-leaf-${Date.now()}`
      context.networkName = `e2e-cli-net-${Date.now()}`

      const leaf = await runTextCommand(
        [
          'meristem',
          'node',
          'register',
          '--kind',
          'leaf',
          '--name',
          context.leafName,
          '--mode',
          'simulated'
        ],
        { MERISTEM_TOKEN: context.operatorToken }
      )
      expect(JSON.parse(leaf)).toHaveProperty('node')

      const network = await runTextCommand(
        ['meristem', 'network', 'create', '--name', context.networkName],
        { MERISTEM_TOKEN: context.operatorToken }
      )
      expect(JSON.parse(network)).toHaveProperty('network')
    }, 60_000)

    afterAll(async () => {
      if (context.devAll && context.bffProcess) {
        await stopFullStack(context.devAll, context.bffProcess)
      }
    }, 30_000)

    registerCliHappyPathTests(context)
    registerCliIdentityTests(context)
    registerCliConfigLifecycleTests(context)
    registerCliAuthFailureTests(context)
    registerCliSecretRefTests(context)
  })
}
