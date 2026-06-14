import type { BackfillResult, DLQRecord } from '../../../../packages/contracts/src/index.ts'
import type { CliClient } from '../commands/types.ts'
import type { CliRuntime } from './runtime.ts'
import { unwrap } from './shared.ts'

/**
 * 投影客户端继续混用 Eden 与动态路由，保持现有回放和跳过 DLQ 的调用路径不变。
 */
export function createProjectionClient(
  runtime: CliRuntime
): Pick<CliClient, 'backfill' | 'listDLQ' | 'replayDLQ' | 'skipDLQ'> {
  const { client, headers, coreRoutes } = runtime

  return {
    backfill: async input => {
      const body: Record<string, unknown> = {
        index: input.index,
        batchSize: input.batchSize,
        $headers: headers
      }
      if (input.from !== null && input.from !== undefined) body.from = input.from
      if (input.to !== null && input.to !== undefined) body.to = input.to
      if (input.targetVersion !== undefined) body.targetVersion = input.targetVersion
      return unwrap<BackfillResult>(
        client.api.v0.projection.backfill.post(
          body as {
            index: string
            from?: { factId: string; timestamp: string }
            to?: { factId: string; timestamp: string }
            batchSize: number
            targetVersion?: string
            $headers: Record<string, string>
          }
        )
      )
    },
    listDLQ: async index =>
      unwrap<{ records: DLQRecord[] }>(
        client.api.v0.projection.dlq.get({
          $query: { ...(index ? { index } : {}) },
          $headers: headers
        })
      ),
    replayDLQ: async dlqId => {
      const result = await coreRoutes.postJson('/api/v0/projection/dlq/:id/replay', {
        params: { id: dlqId }
      })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    skipDLQ: async dlqId => {
      const result = await coreRoutes.postJson('/api/v0/projection/dlq/:id/skip', {
        params: { id: dlqId }
      })
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
  }
}
