import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type NodeAgentRuntimeCredentials = {
  readonly nodeId: string
  readonly runtimeToken: string
  readonly savedAt: string
}

export const DEFAULT_NODE_AGENT_RUNTIME_STATE_PATH = '/var/lib/meristem/node-agent/runtime.json'

function isRuntimeCredentialState(value: unknown): value is NodeAgentRuntimeCredentials {
  if (typeof value !== 'object' || value === null) return false
  // 运行时类型守卫：typeof object 之后 TS 仅收窄为 object，需要断言为 Record 才能逐字段校验。
  const record = value as Record<string, unknown>
  return (
    typeof record.nodeId === 'string' &&
    record.nodeId.length > 0 &&
    typeof record.runtimeToken === 'string' &&
    record.runtimeToken.length > 0 &&
    typeof record.savedAt === 'string' &&
    record.savedAt.length > 0
  )
}

export function loadRuntimeCredentials(
  path = DEFAULT_NODE_AGENT_RUNTIME_STATE_PATH
): NodeAgentRuntimeCredentials | null {
  if (!existsSync(path)) return null

  try {
    const decoded = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return isRuntimeCredentialState(decoded) ? decoded : null
  } catch {
    return null
  }
}

export function saveRuntimeCredentials(
  credentials: Omit<NodeAgentRuntimeCredentials, 'savedAt'>,
  path = DEFAULT_NODE_AGENT_RUNTIME_STATE_PATH,
  now = new Date()
): NodeAgentRuntimeCredentials {
  const state = {
    ...credentials,
    savedAt: now.toISOString()
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  return state
}
