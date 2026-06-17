/**
 * 相关链路没有显式传入 correlationId 时，在入口层补一个随机值，保证日志与事件可串联。
 */
export function correlationIdFromHeader(header: string | undefined): string {
  return header && header.length > 0 ? header : crypto.randomUUID()
}
