import { describe, expect, it } from 'bun:test'
import { createJoinTlsEnv } from '../helpers/tls.ts'

describe('e2e tls env helper', () => {
  it('builds the join ingress TLS env overrides for later service starts', () => {
    expect(
      createJoinTlsEnv({
        certFile: '.local/certs/join-ingress-cert.pem',
        keyFile: '.local/certs/join-ingress-key.pem'
      })
    ).toEqual({
      MERISTEM_JOIN_INGRESS_PORT: '8443',
      MERISTEM_JOIN_PUBLIC_URL: 'https://localhost:8443',
      MERISTEM_JOIN_TLS_CERT_FILE: '.local/certs/join-ingress-cert.pem',
      MERISTEM_JOIN_TLS_KEY_FILE: '.local/certs/join-ingress-key.pem'
    })
  })
})
