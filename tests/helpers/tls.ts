type JoinTlsEnvInput = {
  readonly certFile?: string
  readonly keyFile?: string
  readonly publicUrl?: string
  readonly port?: number | string
}

export type JoinTlsEnv = Readonly<{
  MERISTEM_JOIN_INGRESS_PORT: string
  MERISTEM_JOIN_PUBLIC_URL: string
  MERISTEM_JOIN_TLS_CERT_FILE: string
  MERISTEM_JOIN_TLS_KEY_FILE: string
}>

/**
 * Builds the join ingress TLS-related environment variables used by later integration and e2e tests.
 */
export function createJoinTlsEnv(input: JoinTlsEnvInput = {}): JoinTlsEnv {
  const port = typeof input.port === 'number' ? String(input.port) : (input.port ?? '8443')
  const publicUrl = input.publicUrl ?? `https://localhost:${port}`

  return {
    MERISTEM_JOIN_INGRESS_PORT: port,
    MERISTEM_JOIN_PUBLIC_URL: publicUrl,
    MERISTEM_JOIN_TLS_CERT_FILE: input.certFile ?? '.local/certs/join-ingress-cert.pem',
    MERISTEM_JOIN_TLS_KEY_FILE: input.keyFile ?? '.local/certs/join-ingress-key.pem'
  }
}
