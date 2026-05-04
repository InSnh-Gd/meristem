import { describe, expect, it } from 'bun:test'
import { createRpcMNetPort } from '../../apps/core/src/adapters.ts'
import type { RpcClient } from '../../packages/nats-rpc/src/index.ts'

describe('M-Net RPC port', () => {
  it('maps a successful create-network response from the m-net service', async () => {
    const rpc: RpcClient = {
      async request<TRequest, TResponse>(_subject: string, _payload: TRequest): Promise<TResponse> {
        return {
          ok: true,
          value: {
            id: 'network-1',
            name: 'lab-mesh',
            profileVersion: 'm-net-default@0.1.0',
            status: 'active',
            createdAt: new Date().toISOString()
          }
        } as TResponse
      },
      publish() {},
      async close() {}
    }

    const port = createRpcMNetPort(rpc)
    const result = await port.createNetwork({ name: 'lab-mesh' })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.name).toBe('lab-mesh')
  })
})
