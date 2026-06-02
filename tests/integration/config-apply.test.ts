import { beforeEach, describe, expect, it, test } from 'bun:test'
import { createSqlClient } from '../../packages/db/src/client.ts'

// ---------------------------------------------------------------------------
// Config Apply Ack Integration Tests
//
// These tests verify the apply-ack handoff between Core's config lifecycle
// and domain services (M-Extension, M-Net). The internal route
// POST /internal/v0/configs/:id/apply-ack persists ack records that
// track per-service apply status.
//
// Currently RED because config tables and routes are not yet implemented.
//
// Sentinel prefixes: CFG-INT-ACK, CFG-INT-DUP, CFG-INT-TIMEOUT
// ---------------------------------------------------------------------------

const pgAvailable = await (async () => {
  try {
    const client = createSqlClient()
    await client`select 1`
    await client.end()
    return true
  } catch {
    return false
  }
})()

// ── Internal HTTP 请求辅助 ─────────────────────────────────────────────────

function internalHeaders(): Record<string, string> {
  return {
    'x-meristem-internal-token': 'CFG-INT-internal-token',
    'content-type': 'application/json'
  }
}

async function applyAckFetch(
  configId: string,
  body: {
    ackedBy: string
    status: 'acked' | 'failed'
    configVersion?: string
    errorCode?: string
    errorMessage?: string
  }
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(
    `http://localhost:3000/internal/v0/configs/${configId}/apply-ack`,
    {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify(body)
    }
  )
  const data = res.status !== 204 ? await res.json().catch(() => ({})) : {}
  return { status: res.status, data }
}

// ── 内存集成测试（不依赖 PostgreSQL）───────────────────────────────────────

describe('integration: config apply ack (in-memory)', () => {
  // ── Happy Path: single service acks ─────────────────────────────────────

  it('records a happy-path ack from a target service', async () => {
    // Phase 19: POST /internal/v0/configs/:id/apply-ack with status:acked
    // persists the ack record in config_apply_acks and transitions the
    // config to 'applied' when all target services have acked.
    const res = await applyAckFetch('CFG-INT-ACK-happy-001', {
      ackedBy: 'm-net',
      status: 'acked',
      configVersion: '1.0.0'
    })

    // FAILS RED: internal config route not mounted → 404 (or connection refused).
    // Once Phase 19 wires the apply-ack route: ack accepted → 200.
    expect(res.status).toBe(200)

    const body = res.data as {
      ack: {
        ackId: string
        configId: string
        ackedBy: string
        status: string
        ackedAt: string
      }
    }
    expect(body.ack.configId).toBe('CFG-INT-ACK-happy-001')
    expect(body.ack.ackedBy).toBe('m-net')
    expect(body.ack.status).toBe('acked')
    expect(typeof body.ack.ackId).toBe('string')
    expect(typeof body.ack.ackedAt).toBe('string')
  })

  it('records acks from multiple target services', async () => {
    // M-Extension acks
    const extAck = await applyAckFetch('CFG-INT-ACK-multi-001', {
      ackedBy: 'm-extension',
      status: 'acked',
      configVersion: '1.0.0'
    })

    // FAILS RED: internal config route not mounted → 404.
    expect(extAck.status).toBe(200)

    // M-Net acks
    const netAck = await applyAckFetch('CFG-INT-ACK-multi-001', {
      ackedBy: 'm-net',
      status: 'acked',
      configVersion: '1.0.0'
    })

    expect(netAck.status).toBe(200)

    // Both services acked → config transitions to applied
    // (verified by querying config status after all acks received)
  })

  // ── Duplicate Ack: idempotent for same service/same status ──────────

  it('returns 200 for idempotent duplicate ack (same service, same status)', async () => {
    const first = await applyAckFetch('CFG-INT-DUP-idem-001', {
      ackedBy: 'm-net',
      status: 'acked',
      configVersion: '1.0.0'
    })

    // FAILS RED: internal config route not mounted → 404.
    expect(first.status).toBe(200)

    const second = await applyAckFetch('CFG-INT-DUP-idem-001', {
      ackedBy: 'm-net',
      status: 'acked',
      configVersion: '1.0.0'
    })

    // Idempotent replay → 200, not 409
    expect(second.status).toBe(200)

    const body = second.data as {
      ack: { ackId: string; status: string }
    }
    expect(body.ack.status).toBe('acked')
  })

  it('returns 409 for conflicting duplicate ack (same service, different status)', async () => {
    const first = await applyAckFetch('CFG-INT-DUP-conflict-001', {
      ackedBy: 'm-extension',
      status: 'acked',
      configVersion: '1.0.0'
    })

    // FAILS RED: internal config route not mounted → 404.
    expect(first.status).toBe(200)

    // Same service tries to change ack status → conflict
    const second = await applyAckFetch('CFG-INT-DUP-conflict-001', {
      ackedBy: 'm-extension',
      status: 'failed',
      configVersion: '1.0.0',
      errorCode: 'EXT.apply.error'
    })

    expect(second.status).toBe(409)

    const body = second.data as { error: { code: string } }
    expect(body.error.code).toBe('config.duplicate_ack')
  })

  // ── Failed Ack: records failure detail ───────────────────────────────

  it('records a failed ack with error detail', async () => {
    const res = await applyAckFetch('CFG-INT-ACK-fail-001', {
      ackedBy: 'm-net',
      status: 'failed',
      configVersion: '1.0.0',
      errorCode: 'm-net.apply.config_invalid',
      errorMessage: 'M-Net rejected the config: unsupported profile version'
    })

    // FAILS RED: internal config route not mounted → 404.
    expect(res.status).toBe(200)

    const body = res.data as {
      ack: {
        ackId: string
        configId: string
        ackedBy: string
        status: string
        errorCode: string
        errorMessage: string
      }
    }
    expect(body.ack.configId).toBe('CFG-INT-ACK-fail-001')
    expect(body.ack.ackedBy).toBe('m-net')
    expect(body.ack.status).toBe('failed')
    expect(body.ack.errorCode).toBe('m-net.apply.config_invalid')
    expect(body.ack.errorMessage).toBe('M-Net rejected the config: unsupported profile version')
  })

  it('transitions config to failed when any target service reports failure', async () => {
    // Phase 19: when any target service acks with status:failed,
    // the config transitions published → failed.
    // This prevents partial application.
    const res = await applyAckFetch('CFG-INT-ACK-fail-transition', {
      ackedBy: 'm-extension',
      status: 'failed',
      configVersion: '1.0.0',
      errorCode: 'EXT.apply.timeout'
    })

    // FAILS RED: internal config route not mounted → 404.
    expect(res.status).toBe(200)

    // Verify config status is now 'failed'
    const statusRes = await fetch(
      'http://localhost:3000/api/v0/configs/CFG-INT-ACK-fail-transition',
      { headers: { authorization: 'Bearer admin-token' } }
    )
    // FAILS RED: config GET route not mounted → 404.
    // Once wired: config status → 'failed'.
    expect(statusRes.status).toBe(200)
    const statusBody = await statusRes.json().catch(() => ({})) as {
      config: { id: string; status: string }
    }
    expect(statusBody.config.status).toBe('failed')
  })

  // ── Ack Timeout: config transitions to failed without corrupting version ─

  it('preserves latest published version when ack timeout transitions to failed', async () => {
    // When no ack is received within the timeout window, the config
    // transitions published → failed. The latest published version
    // must be preserved for auditing and rollback reference.
    const publishedVersion = '2.0.0'

    const statusRes = await fetch(
      `http://localhost:3000/api/v0/configs/CFG-INT-TIMEOUT-001`,
      { headers: { authorization: 'Bearer admin-token' } }
    )

    // FAILS RED: config routes not mounted → 404.
    expect(statusRes.status).toBe(200)

    const statusBody = await statusRes.json().catch(() => ({})) as {
      config: { id: string; status: string; configVersion: string }
    }

    // After timeout with no ack: status is 'failed'
    expect(statusBody.config.status).toBe('failed')
    // The config version must match the last published version
    expect(statusBody.config.configVersion).toBe(publishedVersion)
  })

  // ── M-Extension metadata handoff ack ─────────────────────────────────

  it('M-Extension acks with extension metadata handoff payload', async () => {
    // Phase 19: when Core publishes a config targeting m-extension,
    // m-extension receives the config and acks through the internal route.
    // The ack payload must include the configVersion it applied.
    const res = await applyAckFetch('CFG-INT-ACK-ext-001', {
      ackedBy: 'm-extension',
      status: 'acked',
      configVersion: '2.1.0'
    })

    // FAILS RED: internal config route not mounted → 404.
    expect(res.status).toBe(200)

    const body = res.data as {
      ack: {
        configId: string
        ackedBy: string
        status: string
        ackedAt: string
      }
    }
    expect(body.ack.ackedBy).toBe('m-extension')
    expect(body.ack.status).toBe('acked')
  })

  // ── M-Net profile metadata handoff ack ───────────────────────────────

  it('M-Net acks with profile metadata handoff payload', async () => {
    // Phase 19: when Core publishes a config targeting m-net,
    // m-net receives the config and acks through the internal route.
    const res = await applyAckFetch('CFG-INT-ACK-net-001', {
      ackedBy: 'm-net',
      status: 'acked',
      configVersion: '1.3.0'
    })

    // FAILS RED: internal config route not mounted → 404.
    expect(res.status).toBe(200)

    const body = res.data as {
      ack: {
        ackedBy: string
        status: string
      }
    }
    expect(body.ack.ackedBy).toBe('m-net')
    expect(body.ack.status).toBe('acked')
  })

  // ── Invalid Ack Payload ──────────────────────────────────────────────

  it('returns 400 for apply ack with unknown status value', async () => {
    const res = await applyAckFetch('CFG-INT-ACK-bad-001', {
      ackedBy: 'm-net',
      status: 'pending' as 'acked' // invalid status
    })

    // FAILS RED: internal config route not mounted → 404.
    // Once wired: invalid status → 400.
    expect(res.status).toBe(400)
  })

  it('returns 400 for apply ack missing ackedBy field', async () => {
    const res = await fetch(
      'http://localhost:3000/internal/v0/configs/CFG-INT-ACK-missing-field/apply-ack',
      {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({ status: 'acked' })
      }
    )

    // FAILS RED: internal config route not mounted → 404.
    expect(res.status).toBe(400)
  })

  // ── Missing internal token ───────────────────────────────────────────

  it('returns 401 for apply ack without internal token', async () => {
    const res = await fetch(
      'http://localhost:3000/internal/v0/configs/CFG-INT-ACK-no-auth/apply-ack',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ackedBy: 'm-net', status: 'acked' })
      }
    )

    // FAILS RED: internal config route not mounted → 404.
    // Once wired: missing internal token → 401.
    expect(res.status).toBe(401)
  })
})

// ── PostgreSQL 持久化烟雾测试 ──────────────────────────────────────────────

describe('integration: config apply ack PostgreSQL persistence smoke', () => {
  test.skipIf(!pgAvailable)(
    'persists config apply ack records through internal route into PostgreSQL',
    async () => {
      // Phase 19 must create config_apply_acks table in PostgreSQL.
      // This test verifies that an ack submitted through the internal
      // apply-ack route is persisted and readable.
      //
      // Tables expected (from Phase 19 spec):
      // - config_records (id, config_version, schema_version, config_hash, ...)
      // - config_versions (id, config_id, version, hash, ...)
      // - config_apply_acks (id, ack_id, config_id, config_version, acked_by, ...)
      // - config_transitions (id, config_id, from_status, to_status, ...)

      await import('../../packages/db/src/migrate.ts')

      const { db, client } = await (async () => {
        const mod = await import('../../packages/db/src/client.ts')
        return mod.createDb()
      })()

      try {
        // ── Phase 19 will create the config_apply_acks table ──
        // For now, verify that we can connect to PostgreSQL and that
        // the table will be queryable once created.
        //
        // When Phase 19 creates config tables, uncomment the insert/select:
        //
        // const now = new Date()
        // await db.insert(configApplyAcks).values({
        //   id: crypto.randomUUID(),
        //   ackId: 'CFG-INT-DB-ack-001',
        //   configId: 'CFG-INT-DB-cfg-001',
        //   configVersion: '1.0.0',
        //   ackedBy: 'm-net',
        //   status: 'acked',
        //   ackedAt: now
        // })
        //
        // const [persisted] = await db
        //   .select()
        //   .from(configApplyAcks)
        //   .where(eq(configApplyAcks.configId, 'CFG-INT-DB-cfg-001'))
        //   .limit(1)
        //
        // expect(persisted?.ackedBy).toBe('m-net')
        // expect(persisted?.status).toBe('acked')

        // Smoke: PostgreSQL connection was established successfully.
        // The actual schema validation will be test:contracts phase.
        const result = await client`select 1 as ok`
        expect(result[0]?.ok).toBe(1)
      } finally {
        await client.end()
      }
    }
  )

  test.skipIf(pgAvailable)(
    'skipped: PostgreSQL unavailable (run docker compose up -d postgres)',
    () => {
      expect(pgAvailable).toBe(false)
    }
  )
})
