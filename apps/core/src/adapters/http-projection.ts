import { edenTreaty } from '@elysiajs/eden'
import { Effect } from 'effect'
import type {
  BackfillParams,
  BackfillResult,
  DLQRecord,
  ProjectionHealth
} from '../../../../packages/contracts/src/index.ts'
import { createDynamicRouteAdapter } from '../../../../packages/internal-http/src/dynamic-routes.ts'
import { internalRequestHeaders, serviceUrl } from '../../../../packages/internal-http/src/index.ts'
import type { LogApp } from '../../../../services/m-log/src/public-types.ts'
import { createInternalFetcher, runServiceEffect, tryServiceCall } from '../effect-helpers.ts'

type ProjectionClient = {
  health: {
    get(params?: Record<string, never>): Promise<{
      data: { indices: ProjectionHealth[] } | null
      error: { value: unknown; status: number } | null
    }>
  }
  backfill: {
    post(
      body: BackfillParams
    ): Promise<{ data: BackfillResult | null; error: { value: unknown; status: number } | null }>
  }
  dlq: {
    get(params: { query?: { index?: string } }): Promise<{
      data: { records: DLQRecord[] } | null
      error: { value: unknown; status: number } | null
    }>
  }
}

/**
 * Projection HTTP adapter: Core -> M-Log internal projection endpoints.
 * All methods call M-Log internal HTTP, never directly touch PostgreSQL or OpenSearch.
 */
export function createHttpProjectionPort() {
  const client = edenTreaty<LogApp>(serviceUrl('m-log'), { fetcher: createInternalFetcher() })
  const baseUrl = serviceUrl('m-log')
  const dynamicRoutes = createDynamicRouteAdapter({
    baseUrl,
    defaultHeaders: internalRequestHeaders()
  })

  return {
    async getHealth() {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const response = await (client.internal.v0.projection as ProjectionClient).health.get()
            if (response.error || !response.data)
              throw { code: 'projection.unavailable', message: 'projection unavailable' }
            return response.data.indices
          },
          { code: 'projection.unavailable', message: 'projection unavailable' }
        ).pipe(Effect.map(data => data))
      )
    },

    async executeBackfill(params: BackfillParams) {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const response = await (
              client.internal.v0.projection as ProjectionClient
            ).backfill.post(params)
            if (response.error || !response.data)
              throw { code: 'backfill.failed', message: 'backfill failed' }
            return response.data
          },
          { code: 'backfill.failed', message: 'backfill failed' }
        ).pipe(Effect.map(data => data))
      )
    },

    async listDLQ(index?: string) {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const params = index ? { query: { index } } : {}
            const response = await (client.internal.v0.projection as ProjectionClient).dlq.get(
              params
            )
            if (response.error || !response.data)
              throw { code: 'projection.unavailable', message: 'projection unavailable' }
            return response.data.records
          },
          { code: 'projection.unavailable', message: 'projection unavailable' }
        ).pipe(Effect.map(data => data))
      )
    },

    async replayDLQ(dlqId: string) {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const result = await dynamicRoutes.postJson<{ replayed: boolean }>(
              '/internal/v0/projection/dlq/:id/replay',
              { params: { id: dlqId } }
            )
            if (!result.ok) throw result.error
            return result.value.replayed
          },
          { code: 'dlq.replay_failed', message: 'DLQ replay failed' }
        ).pipe(Effect.map(data => data))
      )
    },

    async skipDLQ(dlqId: string) {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const result = await dynamicRoutes.postJson<{ skipped: boolean }>(
              '/internal/v0/projection/dlq/:id/skip',
              { params: { id: dlqId } }
            )
            if (!result.ok) throw result.error
            return result.value.skipped
          },
          { code: 'dlq.skip_failed', message: 'DLQ skip failed' }
        ).pipe(Effect.map(data => data))
      )
    }
  }
}

export type HttpProjectionPort = ReturnType<typeof createHttpProjectionPort>
