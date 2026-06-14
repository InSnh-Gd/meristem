import type { MNetSessionServerMessage } from '../../../packages/contracts/src/index.ts'

export type AgentEnvironment = Record<string, string | undefined>

/**
 * 节点 agent 的环境变量读取必须保持“多候选键按顺序兜底”，避免恢复路径和首连路径分散各自实现。
 */
export function requiredOneOf(
  names: readonly string[],
  env: AgentEnvironment = process.env
): string | undefined {
  for (const name of names) {
    const value = env[name]
    if (value) return value
  }
  return undefined
}

/**
 * 节点心跳间隔必须收敛成正整数，避免错误配置让 agent 静默停发心跳或过度轰炸 join ingress。
 */
export function heartbeatIntervalMs(env: AgentEnvironment = process.env): number {
  const value = Number(env.MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS ?? '5000')
  return Number.isFinite(value) && value > 0 ? value : 5000
}

/**
 * Join ingress 回来的 WebSocket 帧统一先解成文本，再进入版本化 session 消息解析。
 */
export function decodeMessage(data: string | ArrayBuffer | Blob): Promise<string> | string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data))
  return data.text()
}

function isServerMessage(value: unknown): value is MNetSessionServerMessage {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

/**
 * 只接受带 `type` 的 M-Net session server 消息，避免 agent 在不明消息形状下继续执行。
 */
export function parseServerMessage(raw: string): MNetSessionServerMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isServerMessage(parsed) ? parsed : null
  } catch {
    return null
  }
}
