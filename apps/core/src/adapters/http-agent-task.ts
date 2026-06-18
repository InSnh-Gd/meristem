import { edenTreaty } from '@elysiajs/eden'
import { Effect } from 'effect'
import { serviceUrl } from '../../../../packages/internal-http/src/index.ts'
import type { MNetApp } from '../../../../services/m-net/src/public-types.ts'
import {
  createInternalFetcher,
  runServiceEffect,
  serviceErrorFromHttpResponse,
  tryServiceCall
} from '../effect-helpers.ts'
import { decodeMNetNoopTaskResponse } from './mnet-response-decode.ts'

/**
 * agent noop 下发改走 M-Net internal HTTP，由 M-Net 负责把 task.execute 投递给活动 session 并等待结果。
 */
export function createHttpAgentTaskPort() {
  const client = edenTreaty<MNetApp>(serviceUrl('m-net'), { fetcher: createInternalFetcher() })

  return {
    async executeNoop(input: { nodeId: string; taskId: string; correlationId: string }) {
      return runServiceEffect(
        tryServiceCall(() => client.internal.v0.tasks.noop.post(input), {
          code: 'nodeagent.unavailable',
          message: 'node agent unavailable'
        }).pipe(
          Effect.flatMap(response =>
            response.error || !response.data
              ? Effect.fail(
                  serviceErrorFromHttpResponse(
                    response.error?.value,
                    'nodeagent.unavailable',
                    'node agent unavailable'
                  )
                )
              : decodeMNetNoopTaskResponse(response.data)
          ),
          Effect.map(response => response.result)
        )
      )
    }
  }
}
