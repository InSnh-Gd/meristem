import { describe, expect, it } from 'bun:test'
import { createOpenSearchAdapter } from '../../services/m-log/src/opensearch.ts'
import { createOpenSearchReadModel } from '../../services/m-log/src/opensearch-read-model.ts'
import { createMLogReadiness } from '../../services/m-log/src/readiness.ts'
import { projectAfterAuthoritativeWrite } from '../../services/m-log/src/write-service.ts'

describe('M-Log OpenSearch read-model failure modes', () => {
  it('uses configured service-account credentials for secure cluster health probes', async () => {
    const observed: { authorization: string | null } = { authorization: null }
    const adapter = createOpenSearchAdapter({
      baseUrl: 'https://opensearch.internal.test:9200',
      username: 'm-log-projection',
      password: 'fixture-password',
      fetch: async (_input, init) => {
        observed.authorization = new Headers(init?.headers).get('authorization')
        return new Response(JSON.stringify({ status: 'green', cluster_name: 'meristem-logs' }), {
          headers: { 'content-type': 'application/json' }
        })
      }
    })

    await expect(adapter.clusterHealth()).resolves.toBe('ready')
    expect(observed.authorization).toBe(
      `Basic ${btoa('m-log-projection:fixture-password')}`
    )
  })

  it('keeps M-Log ready when authoritative dependencies are ready but OpenSearch is unavailable', async () => {
    const readiness = createMLogReadiness({
      checkPostgres: async () => true,
      checkNats: async () => true,
      checkEventBus: async () => true,
      refreshOpenSearch: async () => 'unavailable'
    })

    await expect(readiness()).resolves.toEqual({ ready: true, opensearch: 'unavailable' })
  })

  it('reports a yellow cluster as degraded without disabling the read model', async () => {
    const state = createOpenSearchReadModel({
      clusterHealth: async () => 'degraded',
      ensureAllIndices: async () => true
    })

    await expect(state.refresh()).resolves.toBe('degraded')
    expect(state.isAvailable()).toBe(true)
    expect(state.status()).toBe('degraded')
  })

  it('marks a rejected projection unavailable without propagating a failure to its caller', async () => {
    const failures: unknown[] = []

    await expect(
      projectAfterAuthoritativeWrite({
        kind: 'audit',
        entryId: 'audit-fact-1',
        project: async () => false,
        onFailure: error => failures.push(error)
      })
    ).resolves.toBeUndefined()

    expect(failures).toHaveLength(1)
  })

  it('reinitializes aliases after a transient OpenSearch outage recovers', async () => {
    let clusterStatus: 'ready' | 'degraded' | 'unavailable' = 'unavailable'
    let initializationCount = 0
    const state = createOpenSearchReadModel({
      clusterHealth: async () => clusterStatus,
      ensureAllIndices: async () => {
        initializationCount += 1
        return true
      }
    })

    await expect(state.refresh()).resolves.toBe('unavailable')
    clusterStatus = 'ready'
    await expect(state.refresh()).resolves.toBe('ready')
    expect(initializationCount).toBe(1)

    state.markUnavailable()
    await expect(state.refresh()).resolves.toBe('ready')
    expect(initializationCount).toBe(2)
  })
})
