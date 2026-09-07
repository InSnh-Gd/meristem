import { describe, expect, it } from 'bun:test'
import { ensureLocalRuntimeDeploymentConfig, rootDir } from '../../scripts/local-stack-runtime.ts'

describe('local stack runtime deployment configuration', () => {
  it('defaults local runners to the checked-in development deployment config', () => {
    const environment: NodeJS.ProcessEnv = {}

    ensureLocalRuntimeDeploymentConfig(environment)

    expect(environment.MERISTEM_V02_DEPLOYMENT_CONFIG).toBe(`${rootDir}/config/dev-deployment.json`)
  })

  it('preserves an explicitly configured deployment config', () => {
    const environment: NodeJS.ProcessEnv = {
      MERISTEM_V02_DEPLOYMENT_CONFIG: '/run/meristem/deployment.json'
    }

    ensureLocalRuntimeDeploymentConfig(environment)

    expect(environment.MERISTEM_V02_DEPLOYMENT_CONFIG).toBe('/run/meristem/deployment.json')
  })
})
