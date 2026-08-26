import type { HarnessCheckResult } from './mnet-multihost-harness-contract.ts'
import { harnessRuntime } from './mnet-multihost-harness-runtime.ts'

const { dockerImage, hasCapNetAdmin, probeDockerGateway, resolveBinary, run } = harnessRuntime

/** 检查 WireGuard、wstunnel、Docker 与宿主机网关是否可安全启动多主机 Harness。 */
export async function runPreflightChecks(): Promise<HarnessCheckResult> {
  const wgBinaryPath = process.env.MERISTEM_WG_BINARY_PATH ?? 'wg'
  const wstunnelBinaryPath = process.env.MERISTEM_WSTUNNEL_BINARY_PATH ?? 'wstunnel'

  if (!resolveBinary(wgBinaryPath)) {
    return {
      ok: false,
      code: 'host.wireguard_missing',
      message: `missing WireGuard binary at ${wgBinaryPath}`,
      hint: 'Install wireguard-tools or point MERISTEM_WG_BINARY_PATH at a valid wg binary.'
    }
  }
  if (!hasCapNetAdmin()) {
    return {
      ok: false,
      code: 'host.cap_net_admin_missing',
      message: 'CAP_NET_ADMIN is missing for the current host process',
      hint: 'Run the harness from a shell that carries CAP_NET_ADMIN, or use a wrapper such as sudo setcap/capsh before retrying.'
    }
  }
  if (run(['sh', '-lc', '[ -d /sys/module/wireguard ]']).exitCode !== 0) {
    return {
      ok: false,
      code: 'host.wireguard_module_missing',
      message: 'WireGuard kernel module is not visible at /sys/module/wireguard',
      hint: 'Load the wireguard kernel module before starting the multi-host harness.'
    }
  }
  if (!resolveBinary(wstunnelBinaryPath)) {
    return {
      ok: false,
      code: 'host.wstunnel_missing',
      message: `missing wstunnel binary at ${wstunnelBinaryPath}`,
      hint: 'Install wstunnel locally or point MERISTEM_WSTUNNEL_BINARY_PATH at a readable binary.'
    }
  }
  if (run(['docker', '--version']).exitCode !== 0) {
    return {
      ok: false,
      code: 'docker.unavailable',
      message: 'docker CLI is unavailable for leaf host isolation',
      hint: 'Install Docker and ensure the daemon is reachable before using the multi-host harness.'
    }
  }
  if (run(['docker', 'image', 'inspect', dockerImage]).exitCode !== 0) {
    return {
      ok: false,
      code: 'docker.image_missing',
      message: `${dockerImage} is not present locally for leaf host containers`,
      hint: `Run \`docker pull ${dockerImage}\` once, then rerun the harness preflight.`
    }
  }

  const gatewayReachable = await probeDockerGateway()
  return {
    ok: true,
    code: 'ok',
    message: gatewayReachable
      ? 'host capability, relay binary, and docker bridge checks passed'
      : 'host capability and binaries passed; gateway probe was inconclusive, so rely on harness start result',
    mode: 'docker-bridge',
    details: { dockerImage, wgBinaryPath, wstunnelBinaryPath }
  }
}
