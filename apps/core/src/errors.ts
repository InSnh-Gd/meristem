// correlationId 补值语义由 internal-http 统一承载，Core 入口保持同一导出路径，
// 避免 Core 与 M-Net 对同一 header 出现两份实现。
export { correlationIdFromHeader } from '../../../packages/internal-http/src/index.ts'
