import { existsSync } from 'node:fs'

const relayPort = Number(process.env.MERISTEM_MNET_HARNESS_RELAY_PORT ?? '18443')
const relayBind = process.env.MERISTEM_MNET_HARNESS_RELAY_BIND ?? '0.0.0.0'
const relayPathPrefix =
  process.env.MERISTEM_MNET_HARNESS_RELAY_PATH_PREFIX ?? 'meristem-fallback-relay'
const relayHealthPort = Number(process.env.MERISTEM_MNET_HARNESS_RELAY_HEALTH_PORT ?? '19090')
const relayWgTargetHost = process.env.MERISTEM_MNET_HARNESS_WG_TARGET_HOST ?? '127.0.0.1'
const relayWgTargetPort = Number(process.env.MERISTEM_MNET_HARNESS_WG_TARGET_PORT ?? '51820')
const certFile =
  process.env.MERISTEM_MNET_HARNESS_RELAY_CERT_FILE ?? '.local/certs/join-ingress-cert.pem'
const keyFile =
  process.env.MERISTEM_MNET_HARNESS_RELAY_KEY_FILE ?? '.local/certs/join-ingress-key.pem'
const wstunnelBinary = process.env.MERISTEM_WSTUNNEL_BINARY_PATH ?? 'wstunnel'

if (!existsSync(certFile) || !existsSync(keyFile)) {
  throw new Error('mnet multihost relay requires readable TLS certificate files')
}

const healthServer = Bun.serve({
  hostname: '127.0.0.1',
  port: relayHealthPort,
  fetch() {
    return Response.json({ ok: true, relayPort, relayPathPrefix })
  }
})

const relay = Bun.spawn(
  [
    wstunnelBinary,
    'server',
    `wss://${relayBind}:${relayPort}`,
    '--restrict-to',
    `${relayWgTargetHost}:${relayWgTargetPort}`,
    '--restrict-http-upgrade-path-prefix',
    relayPathPrefix,
    '--tls-certificate',
    certFile,
    '--tls-private-key',
    keyFile,
    '--log-lvl',
    'INFO'
  ],
  {
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'ignore'
  }
)

const shutdown = async (code: number) => {
  healthServer.stop(true)
  try {
    relay.kill('SIGINT')
  } catch {
    // 这里允许 relay 已经退出，关闭流程仍然继续。
  }
  await relay.exited.catch(() => 0)
  process.exit(code)
}

process.on('SIGINT', () => {
  void shutdown(0)
})

process.on('SIGTERM', () => {
  void shutdown(0)
})

const exitCode = await relay.exited
await shutdown(exitCode)
