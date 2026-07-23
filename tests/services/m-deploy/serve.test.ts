import { describe, expect, it } from 'bun:test'
import { loadMDeployProductionHost } from '../../../services/m-deploy/src/serve.ts'

describe('M-Deploy OCI serving entrypoint', () => {
  it('fails closed when production host adapters are not supplied', async () => {
    await expect(loadMDeployProductionHost({})).rejects.toThrow(
      'mdeploy.host_adapter_module_missing'
    )
  })
})
