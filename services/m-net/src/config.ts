/**
 * M-Net 运行时阈值统一从环境变量读取，避免 session、task 与 join ingress 配置分散在多处。
 */
export function heartbeatTimeoutMs(): number {
  const value = Number(process.env.MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS ?? '15000')
  return Number.isFinite(value) && value > 0 ? value : 15000
}

/**
 * task execute 超时保持集中配置，确保 Core 等待 agent 结果的窗口可预测且可审计。
 */
export function taskTimeoutMs(): number {
  const value = Number(process.env.MERISTEM_AGENT_TASK_TIMEOUT_MS ?? '5000')
  return Number.isFinite(value) && value > 0 ? value : 5000
}

/**
 * Join ingress 端口属于公网接入边界，必须从统一配置导出。
 */
export function joinIngressPort(): number {
  const value = Number(process.env.MERISTEM_JOIN_INGRESS_PORT ?? '8443')
  return Number.isFinite(value) && value > 0 ? value : 8443
}

export function joinTlsCertFile(): string {
  return process.env.MERISTEM_JOIN_TLS_CERT_FILE ?? '.local/certs/join-ingress-cert.pem'
}

export function joinTlsKeyFile(): string {
  return process.env.MERISTEM_JOIN_TLS_KEY_FILE ?? '.local/certs/join-ingress-key.pem'
}

/**
 * Join ingress 自己终止 TLS，因此证书与私钥必须在启动时一起读取并失败早显式暴露。
 */
export async function joinTlsConfig(): Promise<{ cert: string; key: string }> {
  const [cert, key] = await Promise.all([
    Bun.file(joinTlsCertFile()).text(),
    Bun.file(joinTlsKeyFile()).text()
  ])
  return { cert, key }
}
