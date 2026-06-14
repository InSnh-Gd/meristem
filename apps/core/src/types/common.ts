/**
 * Core 只依赖统一的服务错误形状，不把各子服务的内部异常类型泄漏到边界层。
 */
export type ServiceError = {
  code: string
  message: string
}
