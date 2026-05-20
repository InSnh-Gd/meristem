import { describe, expect, it } from 'bun:test'

const natsRpcSourceUrl = new URL('../../packages/nats-rpc/src/index.ts', import.meta.url)

describe('NATS subject cleanup', () => {
  it('does not expose legacy node-agent runtime subjects in the shared NATS RPC map', async () => {
    const source = await Bun.file(natsRpcSourceUrl).text()

    expect(source).not.toContain('nodeHeartbeatReported')
    expect(source).not.toContain('nodeLogForwarded')
    expect(source).not.toContain('nodeTaskExecute(')
    expect(source).not.toContain('nodeagent.heartbeat.reported.v0')
    expect(source).not.toContain('nodeagent.log.forwarded.v0')
  })
})
