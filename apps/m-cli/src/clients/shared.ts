export type CliConfig = {
  coreUrl: string
  taskUrl: string
  policyUrl: string
  mnetUrl: string
  extensionUrl: string
  token: string | undefined
}

export type FetchInput = Parameters<typeof fetch>[0]
export type FetchInit = Parameters<typeof fetch>[1]

/**
 * CLI 只负责透传 Bearer Token，不在本地推导角色或权限，避免把授权边界复制到命令行进程里。
 */
export function authHeaders(token: string | undefined): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {}
}

export type EdenResponse<T> = {
  data: T | null
  error: { value: unknown; status: number } | null
  status: number
}

/**
 * CLI 统一从 Eden 错误体中提炼可读消息，保持脚本调用和人工调用看到同一套错误语义。
 */
export function errorMessage(response: EdenResponse<unknown>): string {
  if (!response.error) return `request failed: ${response.status}`
  const value = response.error.value
  if (typeof value === 'object' && value !== null) {
    const error = Reflect.get(value, 'error')
    if (typeof error === 'object' && error !== null) {
      const message = Reflect.get(error, 'message')
      if (typeof message === 'string') return message
    }
  }
  return `request failed: ${response.status}`
}

/**
 * CLI 层只暴露解包后的契约结果；一旦服务返回错误或空数据，这里统一抛出异常给命令解析层处理。
 */
export async function unwrap<T>(request: Promise<EdenResponse<unknown>>): Promise<T> {
  const response = (await request) as EdenResponse<T>
  if (response.error || response.data === null) throw new Error(errorMessage(response))
  return response.data
}
