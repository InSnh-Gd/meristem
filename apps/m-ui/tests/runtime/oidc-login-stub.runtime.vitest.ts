import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import OidcLoginStub from '../../src/lib/components/ui/OidcLoginStub.svelte'

describe('OIDC login stub', () => {
  it('routes browser login through the BFF without a token entry field', () => {
    vi.stubEnv('VITE_MERISTEM_MUI_BFF_URL', 'https://bff.example.test')
    render(OidcLoginStub, { props: { returnTo: '/control-room' } })

    expect(screen.getByTestId('oidc-login-link').getAttribute('href')).toBe(
      'https://bff.example.test/api/v0/auth/oidc/login?returnTo=%2Fcontrol-room'
    )
    expect(screen.queryByTestId('token-input')).toBeNull()
    expect(screen.getByText(/此浏览器不会接收或保存 OIDC token/)).toBeTruthy()
  })
})
