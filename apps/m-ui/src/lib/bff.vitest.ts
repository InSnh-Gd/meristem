import { describe, expect, it, vi, afterEach } from 'vitest'
import { getBffUrl } from './bff'

describe('getBffUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns default URL when VITE_MERISTEM_MUI_BFF_URL is not set', () => {
    vi.stubEnv('VITE_MERISTEM_MUI_BFF_URL', '')
    expect(getBffUrl()).toBe('http://localhost:3200')
  })

  it('returns override URL when VITE_MERISTEM_MUI_BFF_URL is set', () => {
    vi.stubEnv('VITE_MERISTEM_MUI_BFF_URL', 'http://custom-bff:9999')
    expect(getBffUrl()).toBe('http://custom-bff:9999')
  })
})
