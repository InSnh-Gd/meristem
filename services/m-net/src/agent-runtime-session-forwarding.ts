import type { SessionLogForwardMessage } from '../../../packages/contracts/src/index.ts'
import type { AgentRuntimeContext } from './agent-runtime-types.ts'

/** 为 Agent 通过 session.forward 送来的日志补充节点身份与通道来源。 */
export async function forwardLog(
  context: Pick<AgentRuntimeContext, 'writeFull'>,
  nodeId: string,
  message: SessionLogForwardMessage
): Promise<void> {
  try {
    await context.writeFull(
      message.level,
      message.message,
      message.correlationId,
      message.traceId,
      {
        nodeId,
        channel: 'session.log.forward',
        timestamp: message.timestamp,
        ...(message.payload === undefined ? {} : { payload: message.payload })
      }
    )
  } catch {
    // m-log 不可用时日志转发失败不应导致 M-Net 崩溃，特别是启动阶段竞态。
  }
}
