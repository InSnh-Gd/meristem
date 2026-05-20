const BFF_URL = 'http://localhost:3200'

type BffErrorEnvelope = {
  error: {
    code?: unknown
    message?: unknown
    correlationId?: unknown
  }
}

function isBffErrorEnvelope(value: unknown): value is BffErrorEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const error = Reflect.get(value, 'error')
  return typeof error === 'object' && error !== null
}

/**
 * TokenInput 接受纯 JWT 或用户从 curl/CLI 里复制出来的 Authorization 头。
 * 这里统一收敛成 token 明文，避免发出 `Bearer Bearer <jwt>` 导致 Core 401。
 */
export function normalizeBearerTokenInput(input: string): string {
  const trimmed = input.trim()
  const bearer = /^Bearer\s+(.+)$/i.exec(trimmed)
  return (bearer?.[1] ?? trimmed).trim()
}

/** 将 Core/BFF error envelope 还原成可读 UI 错误，避免 401 被吞成泛化失败。 */
export function formatBffError(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (!isBffErrorEnvelope(error)) return fallback

  const message = typeof error.error.message === 'string' ? error.error.message : fallback
  const code = typeof error.error.code === 'string' ? error.error.code : null
  return code ? `${message} (${code})` : message
}

async function bffFetch(
  path: string,
  token: string,
  init?: RequestInit
): Promise<unknown> {
  const normalizedToken = normalizeBearerTokenInput(token)
  const response = await fetch(`${BFF_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(normalizedToken ? { authorization: `Bearer ${normalizedToken}` } : {}),
      'content-type': 'application/json'
    }
  })
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({
        error: { code: 'unknown', message: 'request failed' }
      }))
    throw body
  }
  return response.json()
}

export function fetchOverview(token: string) {
  return bffFetch('/api/v0/overview', token)
}

export function fetchCommandState(token: string, leafNodeId: string) {
  return bffFetch('/api/v0/commands/noop', token, {
    method: 'POST',
    body: JSON.stringify({ leafNodeId })
  })
}

export function executeNoop(token: string, leafNodeId: string) {
  return bffFetch('/api/v0/commands/noop/execute', token, {
    method: 'POST',
    body: JSON.stringify({ leafNodeId })
  })
}
