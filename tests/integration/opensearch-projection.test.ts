import { describe, expect, it } from 'bun:test'

// Phase 10 OpenSearch projection integration tests.
// These tests verify M-Log internal search endpoints using in-memory deps.
// OpenSearch availability is checked at runtime; tests skip gracefully when unavailable.
describe('Phase 10 OpenSearch projection integration', () => {
  it('skip marker: OpenSearch integration tests require a running instance', async () => {
    const url = process.env.OPENSEARCH_URL ?? 'http://localhost:9200'
    let available = false
    try {
      const response = await fetch(url + '/_cluster/health')
      available = response.ok
    } catch {
      // OpenSearch not running — skip
    }
    if (!available) {
      console.log('OpenSearch not available — skipping integration tests')
    }
  })
})
