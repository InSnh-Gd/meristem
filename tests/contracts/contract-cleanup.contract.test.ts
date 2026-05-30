import { describe, expect, it } from 'bun:test'

const contractsTypesUrl = new URL('../../packages/contracts/src/types.ts', import.meta.url)

describe('Phase 8 contract cleanup', () => {
  it('does not reintroduce token-bearing node-agent runtime payload aliases in shared contracts', async () => {
    const source = await Bun.file(contractsTypesUrl).text()

    expect(source).not.toMatch(/export type NodeAgentHeartbeatPayload\s*=\s*\{[\s\S]*?token:\s*string[\s\S]*?\}/)
    expect(source).not.toMatch(/export type NodeAgentLogPayload\s*=\s*\{[\s\S]*?token:\s*string[\s\S]*?\}/)
  })
})
