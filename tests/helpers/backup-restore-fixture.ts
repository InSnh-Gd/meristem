import { createSqlClient } from '../../packages/db/src/client.ts'

export const POSTGRESQL_RPO_TARGET_MS = 15 * 60 * 1_000
export const POSTGRESQL_RTO_TARGET_MS = 30 * 60 * 1_000
export const OVERALL_RTO_TARGET_MS = 60 * 60 * 1_000

type JsonObject = {
  readonly [key: string]: JsonValue
}

type JsonValue = boolean | JsonObject | null | number | readonly JsonValue[] | string

type ActorFixtureRow = {
  readonly id: string
  readonly displayName: string
  readonly status: string
  readonly createdAt: string
  readonly updatedAt: string
}

type PolicyDecisionFixtureRow = {
  readonly id: string
  readonly actor: string
  readonly action: string
  readonly resource: string
  readonly result: string
  readonly reasons: JsonValue
  readonly createdAt: string
}

type AuditLogFixtureRow = {
  readonly id: string
  readonly timestamp: string
  readonly actor: string
  readonly action: string
  readonly resource: string
  readonly decisionId: string
  readonly result: string
  readonly correlationId: string
  readonly traceId: string
  readonly payload: JsonValue
}

type MDeployOperationFixtureRow = {
  readonly id: string
  readonly agentId: string
  readonly status: string
  readonly publicationStatus: string
  readonly operation: JsonValue
  readonly createdAt: string
  readonly updatedAt: string
}

type MDeployEvidenceFixtureRow = {
  readonly operationId: string
  readonly evidenceType: string
  readonly metadata: JsonValue
  readonly createdAt: string
}

type MDeployEventIntentFixtureRow = {
  readonly id: string
  readonly operationId: string
  readonly status: string
  readonly intent: JsonValue
  readonly createdAt: string
  readonly updatedAt: string
}

export type BackupRestoreFixture = {
  readonly id: string
  readonly actor: ActorFixtureRow
  readonly policyDecision: PolicyDecisionFixtureRow
  readonly auditLog: AuditLogFixtureRow
  readonly mdeployOperation: MDeployOperationFixtureRow
  readonly mdeployEvidence: MDeployEvidenceFixtureRow
  readonly mdeployEventIntent: MDeployEventIntentFixtureRow
}

export type BackupRestoreSnapshotRows = {
  readonly actor: ActorFixtureRow
  readonly policyDecision: PolicyDecisionFixtureRow
  readonly auditLog: AuditLogFixtureRow
  readonly mdeployOperation: MDeployOperationFixtureRow
  readonly mdeployEvidence: MDeployEvidenceFixtureRow
  readonly mdeployEventIntent: MDeployEventIntentFixtureRow
}

export type BackupRestoreSnapshot = {
  readonly transactionId: string
  readonly capturedAt: string
  readonly durationMs: number
  readonly rows: BackupRestoreSnapshotRows
}

export type SeededBackupRestoreFixture = {
  readonly committedAt: string
  readonly committedAtEpochMs: number
}

export type BackupRestoreResult = {
  readonly startedAt: string
  readonly completedAt: string
  readonly durationMs: number
}

export type BackupRestoreSqlClient = ReturnType<typeof createSqlClient>

type TransactionMetadataRow = {
  readonly transactionId: string
}

type CountRow = {
  readonly count: number
}

function requireSingle<Row>(rows: readonly Row[], table: string): Row {
  const row = rows[0]
  if (rows.length !== 1 || !row) {
    throw new Error(`expected exactly one ${table} row in the backup restore fixture`)
  }
  return row
}

function jsonIncludes(value: JsonValue, expected: string): boolean {
  const serialized = JSON.stringify(value)
  return serialized?.includes(expected) ?? false
}

/** 创建固定标识和净化数据的跨服务恢复夹具，不包含任何明文凭据。 */
export function createBackupRestoreFixture(): BackupRestoreFixture {
  const id = 'backup-restore-proof-v1'
  const timestamp = '2026-07-25T00:00:00.000Z'
  const actorId = `${id}-actor`
  const policyDecisionId = `${id}-policy-decision`
  const auditId = `${id}-audit`
  const operationId = `${id}-mdeploy-operation`
  const correlationId = `${id}-correlation`

  return {
    id,
    actor: {
      id: actorId,
      displayName: 'Backup Restore Operator',
      status: 'approved',
      createdAt: timestamp,
      updatedAt: timestamp
    },
    policyDecision: {
      id: policyDecisionId,
      actor: actorId,
      action: 'mdeploy.restore',
      resource: `drill:${id}`,
      result: 'allow',
      reasons: ['deterministic recovery drill'],
      createdAt: timestamp
    },
    auditLog: {
      id: auditId,
      timestamp,
      actor: actorId,
      action: 'mdeploy.restore',
      resource: `drill:${id}`,
      decisionId: policyDecisionId,
      result: 'allow',
      correlationId,
      traceId: `${id}-trace`,
      payload: { fixture: id, redactionStatus: 'redacted' }
    },
    mdeployOperation: {
      id: operationId,
      agentId: `${id}-agent`,
      status: 'succeeded',
      publicationStatus: 'published',
      operation: {
        operationId,
        actor: actorId,
        auditId,
        policyDecisionId,
        correlationId,
        desiredStateDigest: 'sha256:backup-restore-proof',
        redactionStatus: 'redacted'
      },
      createdAt: timestamp,
      updatedAt: timestamp
    },
    mdeployEvidence: {
      operationId,
      evidenceType: 'restore-proof',
      metadata: {
        operationId,
        auditId,
        correlationId,
        storageRef: 'm-log://evidence/backup-restore-proof',
        redactionStatus: 'redacted'
      },
      createdAt: timestamp
    },
    mdeployEventIntent: {
      id: `${id}-mdeploy-event-intent`,
      operationId,
      status: 'published',
      intent: {
        intentId: `${id}-mdeploy-event-intent`,
        operationId,
        correlationId,
        subject: 'mdeploy.restore.proved.v0'
      },
      createdAt: timestamp,
      updatedAt: timestamp
    }
  }
}

/** 通过仓库数据库入口创建真实 PostgreSQL 连接，供集成演练明确关闭。 */
export function createBackupRestoreSqlClient(): BackupRestoreSqlClient {
  return createSqlClient()
}

/** 探测本地 PostgreSQL；缺失时让集成演练明确跳过而不是退回 mock。 */
export async function isPostgresAvailableForBackupRestore(): Promise<boolean> {
  try {
    const client = createBackupRestoreSqlClient()
    await client`select 1`
    await client.end()
    return true
  } catch {
    return false
  }
}

/** 清理固定夹具范围内的关联行，保证重复演练不会污染共享开发数据库。 */
export async function cleanupBackupRestoreFixture(
  sql: BackupRestoreSqlClient,
  fixture: BackupRestoreFixture
): Promise<void> {
  await sql.begin(async transaction => {
    await transaction`delete from mdeploy_event_intents where id = ${fixture.mdeployEventIntent.id}`
    await transaction`
      delete from mdeploy_evidence
      where operation_id = ${fixture.mdeployEvidence.operationId}
        and evidence_type = ${fixture.mdeployEvidence.evidenceType}
    `
    await transaction`delete from mdeploy_operations where id = ${fixture.mdeployOperation.id}`
    await transaction`delete from audit_logs where id = ${fixture.auditLog.id}`
    await transaction`delete from policy_decisions where id = ${fixture.policyDecision.id}`
    await transaction`delete from actors where id = ${fixture.actor.id}`
  })
}

/** 在一个真实事务中写入 Identity、M-Policy、M-Log 和 M-Deploy 的关联事实。 */
export async function seedBackupRestoreFixture(
  sql: BackupRestoreSqlClient,
  fixture: BackupRestoreFixture
): Promise<SeededBackupRestoreFixture> {
  await sql.begin(async transaction => {
    await transaction`
      insert into actors (id, display_name, status, created_at, updated_at)
      values (
        ${fixture.actor.id},
        ${fixture.actor.displayName},
        ${fixture.actor.status},
        ${fixture.actor.createdAt},
        ${fixture.actor.updatedAt}
      )
    `
    await transaction`
      insert into policy_decisions (id, actor, action, resource, result, reasons, created_at)
      values (
        ${fixture.policyDecision.id},
        ${fixture.policyDecision.actor},
        ${fixture.policyDecision.action},
        ${fixture.policyDecision.resource},
        ${fixture.policyDecision.result},
        ${transaction.json(fixture.policyDecision.reasons)},
        ${fixture.policyDecision.createdAt}
      )
    `
    await transaction`
      insert into audit_logs (
        id, timestamp, actor, action, resource, decision_id, result, correlation_id, trace_id, payload
      )
      values (
        ${fixture.auditLog.id},
        ${fixture.auditLog.timestamp},
        ${fixture.auditLog.actor},
        ${fixture.auditLog.action},
        ${fixture.auditLog.resource},
        ${fixture.auditLog.decisionId},
        ${fixture.auditLog.result},
        ${fixture.auditLog.correlationId},
        ${fixture.auditLog.traceId},
        ${transaction.json(fixture.auditLog.payload)}
      )
    `
    await transaction`
      insert into mdeploy_operations (
        id, agent_id, status, publication_status, operation, created_at, updated_at
      )
      values (
        ${fixture.mdeployOperation.id},
        ${fixture.mdeployOperation.agentId},
        ${fixture.mdeployOperation.status},
        ${fixture.mdeployOperation.publicationStatus},
        ${transaction.json(fixture.mdeployOperation.operation)},
        ${fixture.mdeployOperation.createdAt},
        ${fixture.mdeployOperation.updatedAt}
      )
    `
    await transaction`
      insert into mdeploy_evidence (operation_id, evidence_type, metadata, created_at)
      values (
        ${fixture.mdeployEvidence.operationId},
        ${fixture.mdeployEvidence.evidenceType},
        ${transaction.json(fixture.mdeployEvidence.metadata)},
        ${fixture.mdeployEvidence.createdAt}
      )
    `
    await transaction`
      insert into mdeploy_event_intents (id, operation_id, status, intent, created_at, updated_at)
      values (
        ${fixture.mdeployEventIntent.id},
        ${fixture.mdeployEventIntent.operationId},
        ${fixture.mdeployEventIntent.status},
        ${transaction.json(fixture.mdeployEventIntent.intent)},
        ${fixture.mdeployEventIntent.createdAt},
        ${fixture.mdeployEventIntent.updatedAt}
      )
    `
  })

  const committedAtEpochMs = Date.now()
  return { committedAt: new Date(committedAtEpochMs).toISOString(), committedAtEpochMs }
}

/** 在 repeatable-read、只读事务内取得一份跨服务一致的 PostgreSQL 逻辑备份。 */
export async function captureBackupRestoreSnapshot(
  sql: BackupRestoreSqlClient,
  fixture: BackupRestoreFixture
): Promise<BackupRestoreSnapshot> {
  const startedAt = performance.now()
  const transactionSnapshot = await sql.begin(async transaction => {
    await transaction`set transaction isolation level repeatable read`
    await transaction`set transaction read only`
    const transactionMetadata = requireSingle(
      await transaction<TransactionMetadataRow[]>`
        select txid_current()::text as "transactionId"
      `,
      'transaction metadata'
    )
    const actor = requireSingle(
      await transaction<ActorFixtureRow[]>`
        select
          id,
          display_name as "displayName",
          status,
          created_at::text as "createdAt",
          updated_at::text as "updatedAt"
        from actors
        where id = ${fixture.actor.id}
      `,
      'actor'
    )
    const policyDecision = requireSingle(
      await transaction<PolicyDecisionFixtureRow[]>`
        select
          id,
          actor,
          action,
          resource,
          result,
          reasons,
          created_at::text as "createdAt"
        from policy_decisions
        where id = ${fixture.policyDecision.id}
      `,
      'policy decision'
    )
    const auditLog = requireSingle(
      await transaction<AuditLogFixtureRow[]>`
        select
          id,
          timestamp::text as timestamp,
          actor,
          action,
          resource,
          decision_id as "decisionId",
          result,
          correlation_id as "correlationId",
          trace_id as "traceId",
          payload
        from audit_logs
        where id = ${fixture.auditLog.id}
      `,
      'audit log'
    )
    const mdeployOperation = requireSingle(
      await transaction<MDeployOperationFixtureRow[]>`
        select
          id,
          agent_id as "agentId",
          status,
          publication_status as "publicationStatus",
          operation,
          created_at::text as "createdAt",
          updated_at::text as "updatedAt"
        from mdeploy_operations
        where id = ${fixture.mdeployOperation.id}
      `,
      'M-Deploy operation'
    )
    const mdeployEvidence = requireSingle(
      await transaction<MDeployEvidenceFixtureRow[]>`
        select
          operation_id as "operationId",
          evidence_type as "evidenceType",
          metadata,
          created_at::text as "createdAt"
        from mdeploy_evidence
        where operation_id = ${fixture.mdeployEvidence.operationId}
          and evidence_type = ${fixture.mdeployEvidence.evidenceType}
      `,
      'M-Deploy evidence'
    )
    const mdeployEventIntent = requireSingle(
      await transaction<MDeployEventIntentFixtureRow[]>`
        select
          id,
          operation_id as "operationId",
          status,
          intent,
          created_at::text as "createdAt",
          updated_at::text as "updatedAt"
        from mdeploy_event_intents
        where id = ${fixture.mdeployEventIntent.id}
      `,
      'M-Deploy event intent'
    )

    return {
      transactionId: transactionMetadata.transactionId,
      rows: {
        actor,
        policyDecision,
        auditLog,
        mdeployOperation,
        mdeployEvidence,
        mdeployEventIntent
      }
    }
  })

  return {
    ...transactionSnapshot,
    capturedAt: new Date().toISOString(),
    durationMs: performance.now() - startedAt
  }
}

/** 删除备份覆盖的全部关联行，以真实丢失状态模拟灾备恢复前的故障。 */
export async function disruptBackupRestoreFixture(
  sql: BackupRestoreSqlClient,
  fixture: BackupRestoreFixture
): Promise<void> {
  await cleanupBackupRestoreFixture(sql, fixture)
}

/** 从已验证的逻辑快照按外键顺序恢复跨服务权威事实。 */
export async function restoreBackupRestoreSnapshot(
  sql: BackupRestoreSqlClient,
  snapshot: BackupRestoreSnapshot
): Promise<BackupRestoreResult> {
  if (!hasConsistentBackupRestoreLinks(snapshot)) {
    throw new Error('refusing to restore an inconsistent backup restore snapshot')
  }

  const startedAt = new Date().toISOString()
  const startedAtMonotonic = performance.now()
  const { actor, policyDecision, auditLog, mdeployOperation, mdeployEvidence, mdeployEventIntent } =
    snapshot.rows

  await sql.begin(async transaction => {
    await transaction`delete from mdeploy_event_intents where id = ${mdeployEventIntent.id}`
    await transaction`
      delete from mdeploy_evidence
      where operation_id = ${mdeployEvidence.operationId}
        and evidence_type = ${mdeployEvidence.evidenceType}
    `
    await transaction`delete from mdeploy_operations where id = ${mdeployOperation.id}`
    await transaction`delete from audit_logs where id = ${auditLog.id}`
    await transaction`delete from policy_decisions where id = ${policyDecision.id}`
    await transaction`delete from actors where id = ${actor.id}`

    await transaction`
      insert into actors (id, display_name, status, created_at, updated_at)
      values (${actor.id}, ${actor.displayName}, ${actor.status}, ${actor.createdAt}, ${actor.updatedAt})
    `
    await transaction`
      insert into policy_decisions (id, actor, action, resource, result, reasons, created_at)
      values (
        ${policyDecision.id},
        ${policyDecision.actor},
        ${policyDecision.action},
        ${policyDecision.resource},
        ${policyDecision.result},
        ${transaction.json(policyDecision.reasons)},
        ${policyDecision.createdAt}
      )
    `
    await transaction`
      insert into audit_logs (
        id, timestamp, actor, action, resource, decision_id, result, correlation_id, trace_id, payload
      )
      values (
        ${auditLog.id},
        ${auditLog.timestamp},
        ${auditLog.actor},
        ${auditLog.action},
        ${auditLog.resource},
        ${auditLog.decisionId},
        ${auditLog.result},
        ${auditLog.correlationId},
        ${auditLog.traceId},
        ${transaction.json(auditLog.payload)}
      )
    `
    await transaction`
      insert into mdeploy_operations (
        id, agent_id, status, publication_status, operation, created_at, updated_at
      )
      values (
        ${mdeployOperation.id},
        ${mdeployOperation.agentId},
        ${mdeployOperation.status},
        ${mdeployOperation.publicationStatus},
        ${transaction.json(mdeployOperation.operation)},
        ${mdeployOperation.createdAt},
        ${mdeployOperation.updatedAt}
      )
    `
    await transaction`
      insert into mdeploy_evidence (operation_id, evidence_type, metadata, created_at)
      values (
        ${mdeployEvidence.operationId},
        ${mdeployEvidence.evidenceType},
        ${transaction.json(mdeployEvidence.metadata)},
        ${mdeployEvidence.createdAt}
      )
    `
    await transaction`
      insert into mdeploy_event_intents (id, operation_id, status, intent, created_at, updated_at)
      values (
        ${mdeployEventIntent.id},
        ${mdeployEventIntent.operationId},
        ${mdeployEventIntent.status},
        ${transaction.json(mdeployEventIntent.intent)},
        ${mdeployEventIntent.createdAt},
        ${mdeployEventIntent.updatedAt}
      )
    `
  })

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: performance.now() - startedAtMonotonic
  }
}

/** 验证恢复包中的 Identity、Policy、Audit 和 M-Deploy 引用仍指向同一事实链。 */
export function hasConsistentBackupRestoreLinks(snapshot: BackupRestoreSnapshot): boolean {
  const { actor, policyDecision, auditLog, mdeployOperation, mdeployEvidence, mdeployEventIntent } =
    snapshot.rows
  return (
    policyDecision.actor === actor.id &&
    auditLog.actor === actor.id &&
    auditLog.decisionId === policyDecision.id &&
    mdeployEvidence.operationId === mdeployOperation.id &&
    mdeployEventIntent.operationId === mdeployOperation.id &&
    jsonIncludes(mdeployOperation.operation, auditLog.id) &&
    jsonIncludes(mdeployOperation.operation, policyDecision.id) &&
    jsonIncludes(mdeployOperation.operation, auditLog.correlationId) &&
    jsonIncludes(mdeployEvidence.metadata, auditLog.id) &&
    jsonIncludes(mdeployEvidence.metadata, auditLog.correlationId) &&
    jsonIncludes(mdeployEventIntent.intent, mdeployOperation.id)
  )
}

/** 统计演练专用行，供测试在破坏和恢复后验证完整性。 */
export async function totalBackupRestoreFixtureRows(
  sql: BackupRestoreSqlClient,
  fixture: BackupRestoreFixture
): Promise<number> {
  const actor = requireSingle(
    await sql<
      CountRow[]
    >`select count(*)::integer as count from actors where id = ${fixture.actor.id}`,
    'actor count'
  )
  const policyDecision = requireSingle(
    await sql<CountRow[]>`
      select count(*)::integer as count from policy_decisions where id = ${fixture.policyDecision.id}
    `,
    'policy decision count'
  )
  const auditLog = requireSingle(
    await sql<
      CountRow[]
    >`select count(*)::integer as count from audit_logs where id = ${fixture.auditLog.id}`,
    'audit log count'
  )
  const mdeployOperation = requireSingle(
    await sql<CountRow[]>`
      select count(*)::integer as count from mdeploy_operations where id = ${fixture.mdeployOperation.id}
    `,
    'M-Deploy operation count'
  )
  const mdeployEvidence = requireSingle(
    await sql<CountRow[]>`
      select count(*)::integer as count
      from mdeploy_evidence
      where operation_id = ${fixture.mdeployEvidence.operationId}
        and evidence_type = ${fixture.mdeployEvidence.evidenceType}
    `,
    'M-Deploy evidence count'
  )
  const mdeployEventIntent = requireSingle(
    await sql<CountRow[]>`
      select count(*)::integer as count from mdeploy_event_intents where id = ${fixture.mdeployEventIntent.id}
    `,
    'M-Deploy event intent count'
  )

  return (
    actor.count +
    policyDecision.count +
    auditLog.count +
    mdeployOperation.count +
    mdeployEvidence.count +
    mdeployEventIntent.count
  )
}
