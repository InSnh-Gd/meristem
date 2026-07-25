import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  captureBackupRestoreSnapshot,
  cleanupBackupRestoreFixture,
  createBackupRestoreFixture,
  createBackupRestoreSqlClient,
  disruptBackupRestoreFixture,
  hasConsistentBackupRestoreLinks,
  isPostgresAvailableForBackupRestore,
  OVERALL_RTO_TARGET_MS,
  POSTGRESQL_RPO_TARGET_MS,
  POSTGRESQL_RTO_TARGET_MS,
  restoreBackupRestoreSnapshot,
  seedBackupRestoreFixture,
  totalBackupRestoreFixtureRows
} from '../helpers/backup-restore-fixture.ts'

const pgAvailable = await isPostgresAvailableForBackupRestore()

/** 将真实演练的无敏感指标写入标准证据目录，供运维回顾。 */
async function writeRecoveryEvidence(evidence: Record<string, unknown>): Promise<void> {
  const evidenceDir = join(import.meta.dir, '..', 'evidence')
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(
    join(evidenceDir, 'backup-restore-postgresql-rpo-rto.json'),
    JSON.stringify(evidence, null, 2)
  )
}

describe('integration: PostgreSQL backup and restore proof', () => {
  test.skipIf(!pgAvailable)(
    'takes a consistent full logical backup and restores linked authority facts inside RPO/RTO targets',
    async () => {
      await import('../../packages/db/src/migrate.ts')
      const sql = createBackupRestoreSqlClient()
      const fixture = createBackupRestoreFixture()

      try {
        await cleanupBackupRestoreFixture(sql, fixture)
        const seeded = await seedBackupRestoreFixture(sql, fixture)
        const backup = await captureBackupRestoreSnapshot(sql, fixture)

        expect(hasConsistentBackupRestoreLinks(backup)).toBe(true)
        expect(backup.rows.actor.id).toBe(fixture.actor.id)
        expect(backup.rows.auditLog.decisionId).toBe(fixture.policyDecision.id)
        expect(backup.rows.mdeployEvidence.operationId).toBe(fixture.mdeployOperation.id)
        expect(backup.rows.mdeployEventIntent.operationId).toBe(fixture.mdeployOperation.id)

        await disruptBackupRestoreFixture(sql, fixture)
        expect(await totalBackupRestoreFixtureRows(sql, fixture)).toBe(0)

        const restore = await restoreBackupRestoreSnapshot(sql, backup)
        const recovered = await captureBackupRestoreSnapshot(sql, fixture)
        const rpoMs = Date.parse(backup.capturedAt) - seeded.committedAtEpochMs

        await writeRecoveryEvidence({
          drill: 'postgresql-authority-backup-restore',
          fixture: fixture.id,
          timestamps: {
            fixtureCommittedAt: seeded.committedAt,
            backupCapturedAt: backup.capturedAt,
            restoreStartedAt: restore.startedAt,
            restoreCompletedAt: restore.completedAt
          },
          targets: {
            rpoMs: POSTGRESQL_RPO_TARGET_MS,
            postgresqlRtoMs: POSTGRESQL_RTO_TARGET_MS,
            overallRtoMs: OVERALL_RTO_TARGET_MS
          },
          measured: {
            rpoMs,
            backupDurationMs: backup.durationMs,
            restoreDurationMs: restore.durationMs
          },
          linksRestored: hasConsistentBackupRestoreLinks(recovered),
          recoveredRowCount: await totalBackupRestoreFixtureRows(sql, fixture)
        })

        expect(recovered.rows).toEqual(backup.rows)
        expect(hasConsistentBackupRestoreLinks(recovered)).toBe(true)
        expect(rpoMs).toBeGreaterThanOrEqual(0)
        expect(rpoMs).toBeLessThanOrEqual(POSTGRESQL_RPO_TARGET_MS)
        expect(restore.durationMs).toBeLessThanOrEqual(POSTGRESQL_RTO_TARGET_MS)
        expect(restore.durationMs).toBeLessThanOrEqual(OVERALL_RTO_TARGET_MS)
      } finally {
        await cleanupBackupRestoreFixture(sql, fixture)
        await sql.end()
      }
    }
  )

  test.skipIf(pgAvailable)(
    'skipped: PostgreSQL unavailable, run docker compose up -d postgres',
    () => {
      expect(pgAvailable).toBe(false)
    }
  )
})
