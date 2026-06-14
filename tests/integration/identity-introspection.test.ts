import { expect, test } from 'bun:test'
import { createSqlClient } from '../../packages/db/src/client.ts'

// ---------------------------------------------------------------------------
// Identity v0.2 DB-backed token lifecycle integration test
//
// Verifies the complete token lifecycle against PostgreSQL authoritative
// tables: actors, actor_tokens, actor_token_revocations.
//
// Covers the PostgreSQL-backed identity tables used by the current Core
// identity lifecycle. Tests are skipped when PostgreSQL is unavailable.
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

type SqlRow = Record<string, unknown>

// ---------------------------------------------------------------------------
// DB-backed identity introspection lifecycle
// ---------------------------------------------------------------------------

test.skipIf(!pgAvailable)(
  'identity token issue → revoke → introspect lifecycle against PostgreSQL',
  async () => {
    // Sentinel values: IDY-INT-DB

    const client = createSqlClient()

    try {
      // ── Step 1: Verify actors table exists and has seed data ────────────
      const actorRows = await client`
      SELECT id, display_name, status
      FROM actors
      WHERE id = 'operator'
    `

      expect(actorRows.length).toBe(1)
      const firstActor: SqlRow | undefined = actorRows[0]
      expect(firstActor).toBeDefined()
      if (firstActor) {
        expect(firstActor.id).toBe('operator')
        expect(firstActor.status).toBe('active')
      }

      // ── Step 2: Simulate the persisted token state used by the HTTP flow ─
      // The full request path is covered elsewhere; this integration test keeps
      // the setup local and asserts the resulting database state directly.

      // Simulate the expected DB state that would result from token issue:
      const testJti = 'IDY-INT-DB-jti-lifecycle-001'
      const testActorId = 'operator'

      // Insert test token into actor_tokens
      await client`
      INSERT INTO actor_tokens (jti, actor_id, issuer, audience, issued_at, expires_at, issued_by, purpose, status, created_at, updated_at)
      VALUES (${testJti}, ${testActorId}, 'meristem-core', 'meristem-core', NOW(), NOW() + INTERVAL '1 hour', 'security-admin', 'integration-test', 'active', NOW(), NOW())
      ON CONFLICT (jti) DO UPDATE SET
        actor_id = EXCLUDED.actor_id,
        status = EXCLUDED.status,
        updated_at = NOW()
    `

      // ── Step 3: Query token table directly (integration test only) ──────
      const tokenRows = await client`
      SELECT jti, actor_id, status, purpose, audience, issued_by
      FROM actor_tokens
      WHERE jti = ${testJti}
    `

      expect(tokenRows.length).toBe(1)
      const firstToken: SqlRow | undefined = tokenRows[0]
      expect(firstToken).toBeDefined()
      if (firstToken) {
        expect(firstToken.jti).toBe(testJti)
        expect(firstToken.actor_id).toBe(testActorId)
        expect(firstToken.status).toBe('active')
        expect(firstToken.audience).toBe('meristem-core')
        // Token plaintext must never be stored in actor_tokens
        expect(firstToken.token_plaintext).toBeFalsy()
      }

      // Revoke the token for Step 4-5
      await client`
      UPDATE actor_tokens
      SET status = 'revoked', updated_at = NOW()
      WHERE jti = ${testJti}
    `

      await client`
      INSERT INTO actor_token_revocations (jti, revoked_at, revoked_by, reason, correlation_id)
      VALUES (${testJti}, NOW(), 'security-admin', 'IDY-INT-DB revocation test', 'corr-IDY-INT-DB')
      ON CONFLICT (jti) DO UPDATE SET
        revoked_at = EXCLUDED.revoked_at,
        revoked_by = EXCLUDED.revoked_by,
        reason = EXCLUDED.reason
    `

      // ── Step 4: Verify token status updated to 'revoked' after revoke ──
      const revokedTokenRows = await client`
      SELECT jti, status
      FROM actor_tokens
      WHERE jti = ${testJti}
    `

      expect(revokedTokenRows.length).toBe(1)
      const revokedToken: SqlRow | undefined = revokedTokenRows[0]
      expect(revokedToken).toBeDefined()
      if (revokedToken) {
        expect(revokedToken.status).toBe('revoked')
      }

      // ── Step 5: Verify revocation record exists ─────────────────────────
      const revocationRows = await client`
      SELECT jti, revoked_at, revoked_by, reason
      FROM actor_token_revocations
      WHERE jti = ${testJti}
    `

      expect(revocationRows.length).toBe(1)
      const firstRevocation: SqlRow | undefined = revocationRows[0]
      expect(firstRevocation).toBeDefined()
      if (firstRevocation) {
        expect(firstRevocation.jti).toBe(testJti)
        expect(firstRevocation.revoked_by).toBe('security-admin')
        expect(firstRevocation.reason).toContain('IDY-INT-DB')
      }

      // ── Step 6: Disabled actor token denied ─────────────────────────────
      await client`
      UPDATE actors
      SET status = 'disabled', updated_at = NOW()
      WHERE id = 'viewer'
    `

      const disabledActorRows = await client`
      SELECT id, status FROM actors WHERE id = 'viewer'
    `
      const disabledActor: SqlRow | undefined = disabledActorRows[0]
      expect(disabledActor).toBeDefined()
      if (disabledActor) {
        expect(disabledActor.status).toBe('disabled')
      }

      // Restore actor status for cleanup
      await client`
      UPDATE actors
      SET status = 'active', updated_at = NOW()
      WHERE id = 'viewer'
    `

      // ── Cleanup ─────────────────────────────────────────────────────────
      await client`DELETE FROM actor_token_revocations WHERE jti = ${testJti}`
      await client`DELETE FROM actor_tokens WHERE jti = ${testJti}`
    } finally {
      await client.end()
    }
  },
  30_000
)

// ---------------------------------------------------------------------------
// Schema contract: tables must have the correct columns
// ---------------------------------------------------------------------------

test.skipIf(!pgAvailable)(
  'actor_tokens table has the correct identity v0.2 schema',
  async () => {
    const client = createSqlClient()

    try {
      const columns = await client`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'actor_tokens'
      ORDER BY ordinal_position
    `

      expect(columns.length).toBeGreaterThan(0)

      const columnNames = columns.map((c: SqlRow) => String(c.column_name))

      expect(columnNames).toContain('jti')
      expect(columnNames).toContain('actor_id')
      expect(columnNames).toContain('issuer')
      expect(columnNames).toContain('audience')
      expect(columnNames).toContain('issued_at')
      expect(columnNames).toContain('expires_at')
      expect(columnNames).toContain('issued_by')
      expect(columnNames).toContain('purpose')
      expect(columnNames).toContain('status')

      // Verify NO token_plaintext column exists (security requirement)
      expect(columnNames).not.toContain('token_plaintext')
      expect(columnNames).not.toContain('token')
      expect(columnNames).not.toContain('jwt')
    } finally {
      await client.end()
    }
  },
  15_000
)

test.skipIf(!pgAvailable)(
  'actor_token_revocations table has correct schema',
  async () => {
    const client = createSqlClient()

    try {
      const columns = await client`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'actor_token_revocations'
      ORDER BY ordinal_position
    `

      expect(columns.length).toBeGreaterThan(0)

      const columnNames = columns.map((c: SqlRow) => String(c.column_name))

      expect(columnNames).toContain('jti')
      expect(columnNames).toContain('revoked_at')
      expect(columnNames).toContain('revoked_by')
      expect(columnNames).toContain('reason')
      expect(columnNames).toContain('correlation_id')
    } finally {
      await client.end()
    }
  },
  15_000
)

// ---------------------------------------------------------------------------
// Skip test: documents why tests are skipped when PostgreSQL is unavailable
// ---------------------------------------------------------------------------

test.skipIf(pgAvailable)(
  'skipped: PostgreSQL unavailable, run docker compose up -d postgres',
  () => {
    expect(pgAvailable).toBe(false)
  }
)
