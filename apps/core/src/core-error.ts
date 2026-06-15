/**
 * Core 路由层统一抛出的类型安全错误。
 * 配合 Elysia .error() / .onError() 收敛为统一 envelope，
 * 逐步替代 apiError(status, ...) 手动拼装模式。
 * 来源：MERISTEM-DEV.md 中的 API / error envelope 约束与
 * `docs/adr/ADR-F01-foundational-technology-stack.md` 中的错误边界约束。
 */
export class CoreError extends Error {
  readonly status: number
  readonly code: string
  readonly correlationId: string | undefined

  constructor(status: number, code: string, message: string, correlationId?: string) {
    super(message)
    this.status = status
    this.code = code
    this.correlationId = correlationId
    this.name = 'CoreError'
  }
}
