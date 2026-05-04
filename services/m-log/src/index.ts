import { connect } from '@nats-io/transport-node'
import { desc } from 'drizzle-orm'
import { createDb } from '../../../packages/db/src/client.ts'
import { auditLogs, fullLogs, timelineLogs } from '../../../packages/db/src/schema.ts'
import { serveJsonRequests, subjects } from '../../../packages/nats-rpc/src/index.ts'
import type { ActorId, AuditLog, FullLog, TimelineLog } from '../../../packages/contracts/src/index.ts'

const { db, client } = createDb()
const nc = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' })

type TimelineWriteRequest = Omit<TimelineLog, 'id' | 'timestamp'>
type FullWriteRequest = Omit<FullLog, 'id' | 'timestamp'>
type AuditWriteRequest = Omit<AuditLog, 'id' | 'timestamp'>
type ListRequest = { limit?: number }

void serveJsonRequests<TimelineWriteRequest, { ok: true; entry: TimelineLog }>(nc, subjects.timelineWrite, async (request) => {
  const entry: TimelineLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...request
  }
  await db.insert(timelineLogs).values({
    id: entry.id,
    timestamp: new Date(entry.timestamp),
    summary: entry.summary,
    subject: entry.subject,
    correlationId: entry.correlationId
  })
  return { ok: true, entry }
})

void serveJsonRequests<FullWriteRequest, { ok: true; entry: FullLog }>(nc, subjects.fullWrite, async (request) => {
  const entry: FullLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...request
  }
  await db.insert(fullLogs).values({
    id: entry.id,
    timestamp: new Date(entry.timestamp),
    level: entry.level,
    source: entry.source,
    message: entry.message,
    correlationId: entry.correlationId,
    traceId: entry.traceId,
    payload: entry.payload
  })
  return { ok: true, entry }
})

void serveJsonRequests<AuditWriteRequest, { ok: true; entry: AuditLog }>(nc, subjects.auditWrite, async (request) => {
  const entry: AuditLog = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...request
  }
  await db.insert(auditLogs).values({
    id: entry.id,
    timestamp: new Date(entry.timestamp),
    actor: entry.actor,
    action: entry.action,
    resource: entry.resource,
    decisionId: entry.decisionId,
    result: entry.result,
    correlationId: entry.correlationId,
    traceId: entry.traceId,
    payload: entry.payload
  })
  return { ok: true, entry }
})

void serveJsonRequests<ListRequest, { ok: true; entries: TimelineLog[] }>(nc, subjects.timelineList, async (request) => {
  const rows = await db.select().from(timelineLogs).orderBy(desc(timelineLogs.timestamp)).limit(request.limit ?? 50)
  return {
    ok: true,
    entries: rows.map((row) => {
      const entry: TimelineLog = {
        id: row.id,
        timestamp: row.timestamp.toISOString(),
        summary: row.summary
      }
      if (row.subject) entry.subject = row.subject
      if (row.correlationId) entry.correlationId = row.correlationId
      return entry
    })
  }
})

void serveJsonRequests<ListRequest, { ok: true; entries: FullLog[] }>(nc, subjects.fullList, async (request) => {
  const rows = await db.select().from(fullLogs).orderBy(desc(fullLogs.timestamp)).limit(request.limit ?? 50)
  return {
    ok: true,
    entries: rows.map((row) => {
      const entry: FullLog = {
        id: row.id,
        timestamp: row.timestamp.toISOString(),
        level: row.level as FullLog['level'],
        source: row.source,
        message: row.message
      }
      if (row.correlationId) entry.correlationId = row.correlationId
      if (row.traceId) entry.traceId = row.traceId
      if (row.payload) entry.payload = row.payload
      return entry
    })
  }
})

void serveJsonRequests<ListRequest, { ok: true; entries: AuditLog[] }>(nc, subjects.auditList, async (request) => {
  const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp)).limit(request.limit ?? 50)
  return {
    ok: true,
    entries: rows.map((row) => {
      const entry: AuditLog = {
        id: row.id,
        timestamp: row.timestamp.toISOString(),
        actor: row.actor as ActorId | 'system',
        action: row.action,
        resource: row.resource,
        result: row.result
      }
      if (row.decisionId) entry.decisionId = row.decisionId
      if (row.correlationId) entry.correlationId = row.correlationId
      if (row.traceId) entry.traceId = row.traceId
      if (row.payload) entry.payload = row.payload
      return entry
    })
  }
})

process.on('SIGINT', () => {
  void nc.drain().then(() => client.end()).then(() => process.exit(0))
})

console.log('m-log listening')
