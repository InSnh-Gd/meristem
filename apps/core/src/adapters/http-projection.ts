import { edenTreaty } from "@elysiajs/eden"
import type { BackfillParams, BackfillResult, DLQRecord, ProjectionHealth } from "../../../../packages/contracts/src/index.ts"
import { serviceUrl } from "../../../../packages/internal-http/src/index.ts"
import type { LogApp } from "../../../../services/m-log/src/app.ts"
import { createInternalFetcher, requireServiceData, runServiceEffect, tryServiceCall } from "../effect-helpers.ts"
import { Effect } from "effect"

type ProjectionClient = {
  health: { get(params?: Record<string, never>): Promise<{ data: { indices: ProjectionHealth[] } | null; error: { value: unknown; status: number } | null }> }
  backfill: { post(body: BackfillParams): Promise<{ data: BackfillResult | null; error: { value: unknown; status: number } | null }> }
  dlg: {
    get(params: { query?: { index?: string } }): Promise<{ data: { records: DLQRecord[] } | null; error: { value: unknown; status: number } | null }>
  }
}

/**
 * Phase 10.1 Projection HTTP adapter: Core -> M-Log internal projection endpoints.
 * All methods call M-Log internal HTTP, never directly touch PostgreSQL or OpenSearch.
 */
export function createHttpProjectionPort() {
  const client = edenTreaty<LogApp>(serviceUrl("m-log"), { fetcher: createInternalFetcher() })
  const baseUrl = serviceUrl("m-log")
  const fetcher = createInternalFetcher()

  return {
    async getHealth() {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const response = await (client.internal.v0.projection as ProjectionClient).health.get()
            if (response.error || !response.data) throw { code: "projection.unavailable", message: "projection unavailable" }
            return response.data.indices
          },
          { code: "projection.unavailable", message: "projection unavailable" }
        ).pipe(Effect.map((data) => data))
      )
    },

    async executeBackfill(params: BackfillParams) {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const response = await (client.internal.v0.projection as ProjectionClient).backfill.post(params)
            if (response.error || !response.data) throw { code: "backfill.failed", message: "backfill failed" }
            return response.data
          },
          { code: "backfill.failed", message: "backfill failed" }
        ).pipe(Effect.map((data) => data))
      )
    },

    async listDLQ(index?: string) {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const params = index ? { query: { index } } : {}
            const response = await (client.internal.v0.projection as ProjectionClient).dlg.get(params)
            if (response.error || !response.data) throw { code: "projection.unavailable", message: "projection unavailable" }
            return response.data.records
          },
          { code: "projection.unavailable", message: "projection unavailable" }
        ).pipe(Effect.map((data) => data))
      )
    },

    // DLQ replay: use raw fetch for dynamic path param
    async replayDLQ(dlqId: string) {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const url = baseUrl + "/internal/v0/projection/dlg/" + encodeURIComponent(dlqId) + "/replay"
            const response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" } })
            if (!response.ok) throw { code: "dlq.replay_failed", message: "DLQ replay failed" }
            const body = await response.json() as { replayed: boolean }
            return body.replayed
          },
          { code: "dlq.replay_failed", message: "DLQ replay failed" }
        ).pipe(Effect.map((data) => data))
      )
    },

    // DLQ skip: use raw fetch for dynamic path param
    async skipDLQ(dlqId: string) {
      return runServiceEffect(
        tryServiceCall(
          async () => {
            const url = baseUrl + "/internal/v0/projection/dlg/" + encodeURIComponent(dlqId) + "/skip"
            const response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" } })
            if (!response.ok) throw { code: "dlq.skip_failed", message: "DLQ skip failed" }
            const body = await response.json() as { skipped: boolean }
            return body.skipped
          },
          { code: "dlq.skip_failed", message: "DLQ skip failed" }
        ).pipe(Effect.map((data) => data))
      )
    }
  }
}

export type HttpProjectionPort = ReturnType<typeof createHttpProjectionPort>
