import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBffUrl, getOidcLoginUrl, isDevelopmentBearerMode } from './bff'

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

  it('enables bearer handling only under explicit local-dev mode', () => {
    vi.stubEnv('VITE_MERISTEM_AUTH_MODE', 'local-dev')
    expect(isDevelopmentBearerMode()).toBe(true)

    vi.stubEnv('VITE_MERISTEM_AUTH_MODE', 'oidc')
    expect(isDevelopmentBearerMode()).toBe(false)
  })

  it('builds a BFF-owned OIDC login URL without exposing a token', () => {
    vi.stubEnv('VITE_MERISTEM_MUI_BFF_URL', 'https://bff.example.test')
    expect(getOidcLoginUrl('/control-room')).toBe(
      'https://bff.example.test/api/v0/auth/oidc/login?returnTo=%2Fcontrol-room'
    )
  })
})
