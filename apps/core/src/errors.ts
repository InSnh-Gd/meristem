import type { ApiError } from '../../../packages/contracts/src/index.ts'

export type StatusFn = (code: number, body: ApiError) => unknown

export function apiError(status: StatusFn, code: number, errorCode: string, message: string, correlationId?: string) {
  const error: ApiError['error'] = {
    code: errorCode,
    message
  }
  if (correlationId) error.correlationId = correlationId

  return status(code, {
    error
  })
}

export function correlationIdFromHeader(header: string | undefined): string {
  return header && header.length > 0 ? header : crypto.randomUUID()
}
