import { edenTreaty } from '@elysiajs/eden'
import { Effect } from 'effect'
import { serviceUrl } from '../../../../packages/internal-http/src/index.ts'
import type { EventBusApp } from '../../../../services/m-eventbus/src/app.ts'
import type { CoreDeps } from '../types.ts'
import { createInternalFetcher, requireServiceData, runServiceEffect, tryServiceCall } from '../effect-helpers.ts'

/**
 * EventBus 适配器只负责同步发布确认；事件真正的异步传播仍然留在下游总线处理。
 */
export function createHttpEventPort() {
  const client = edenTreaty<EventBusApp>(serviceUrl('m-eventbus'), { fetcher: createInternalFetcher() })

  return {
    async publish(subject: string, event: Parameters<CoreDeps['events']['publish']>[1]) {
      return runServiceEffect(
        tryServiceCall(() => client.internal.v0.publish.post({ subject, event }), { code: 'eventbus.unavailable', message: 'M-EventBus unavailable' }).pipe(
          Effect.flatMap((response) => requireServiceData(response, { code: 'eventbus.unavailable', message: 'M-EventBus unavailable' })),
          Effect.map((data) => ({ eventId: data.eventId }))
        )
      )
    }
  }
}
