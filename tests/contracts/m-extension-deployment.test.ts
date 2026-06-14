import { describe, expect, it } from 'bun:test'

describe('M-Extension deployment examples', () => {
  it('requires operator-provided secrets instead of hardcoded shared secret defaults', async () => {
    const compose = await Bun.file('ops/compose/full-stack.example.yml').text()

    expect(compose).not.toContain('change-me-internal-shared-token')
    expect(compose).not.toContain('change-me-local-jwt-secret')
    expect(compose).toContain('$' + '{MERISTEM_INTERNAL_TOKEN:?set MERISTEM_INTERNAL_TOKEN}')
    expect(compose).toContain('$' + '{MERISTEM_JWT_SECRET:?set MERISTEM_JWT_SECRET}')
  })

  it('does not leave M-Net on the known development JWT secret', async () => {
    const service = await Bun.file('services/m-net/src/app.ts').text()
    const compose = await Bun.file('ops/compose/full-stack.example.yml').text()

    expect(service).not.toContain("MERISTEM_JWT_SECRET ?? 'dev-secret'")
    expect(compose).toContain('m-net:')
    expect(compose).toContain('$' + '{MERISTEM_JWT_SECRET:?set MERISTEM_JWT_SECRET}')
  })
})
