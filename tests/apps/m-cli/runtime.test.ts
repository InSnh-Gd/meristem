import { describe, expect, it } from 'bun:test'
import { createCliRuntime } from '../../../apps/m-cli/src/clients/runtime.ts'
import type { CliConfig } from '../../../apps/m-cli/src/clients/shared.ts'

describe('m-cli runtime', () => {
  const config: CliConfig = {
    coreUrl: 'http://core.local',
    taskUrl: 'http://task.local',
    policyUrl: 'http://policy.local',
    mnetUrl: 'http://mnet.local',
    extensionUrl: 'http://extension.local',
    token: 'token-1'
  }

  it('creates a runtime with shared authorization headers', () => {
    const runtime = createCliRuntime(config)

    expect(runtime.headers).toEqual({ authorization: 'Bearer token-1' })
  })

  it('creates dynamic route adapters for every CLI service boundary', () => {
    const runtime = createCliRuntime(config)

    expect(runtime.coreRoutes).toBeDefined()
    expect(runtime.taskRoutes).toBeDefined()
    expect(runtime.policyRoutes).toBeDefined()
    expect(runtime.mnetRoutes).toBeDefined()
    expect(runtime.extensionRoutes).toBeDefined()
  })

  it('exposes Eden route groups without sending requests', () => {
    const runtime = createCliRuntime(config)

    expect(runtime.client).toBeDefined()
    expect(runtime.networkRoutes).toBeDefined()
    expect(runtime.serviceRoutes).toBeDefined()
    expect(runtime.nodeRoutes).toBeDefined()
  })
})
