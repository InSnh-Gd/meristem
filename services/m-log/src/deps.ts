import type {
  AuditLog,
  AuditSearchQuery,
  BackfillParams,
  BackfillResult,
  DLQRecord,
  FullLog,
  FullLogSearchQuery,
  LogSearchResult,
  ProjectionHealth,
  TimelineLog,
  TimelineSearchQuery
} from '../../../packages/contracts/src/index.ts'

export type TimelineWriteInput = Omit<TimelineLog, 'id' | 'timestamp'>
export type FullWriteInput = Omit<FullLog, 'id' | 'timestamp'>
export type AuditWriteInput = Omit<AuditLog, 'id' | 'timestamp'>
export type ReloadInput = {
  correlationId?: string
  reason?: string
}

// 搜索端口：M-Log 内部 search deps，由 Core 通过内部 HTTP 调用。
export type SearchDeps = {
  full(query: FullLogSearchQuery): Promise<LogSearchResult<FullLog> | null>
  timeline(query: TimelineSearchQuery): Promise<LogSearchResult<TimelineLog> | null>
  audit(query: AuditSearchQuery): Promise<LogSearchResult<AuditLog> | null>
  isAvailable(): boolean
}

// 投影端口：projection engine 暴露给 API 层的操作。
export type ProjectionDeps = {
  getProjectionHealth(): Promise<ProjectionHealth[]>
  executeBackfill(params: BackfillParams): Promise<BackfillResult>
  listDLQ(index?: string): Promise<DLQRecord[]>
  replayDLQ(dlqId: string): Promise<boolean>
  skipDLQ(dlqId: string): Promise<void>
  isAvailable(): boolean
}

export type LogAppDeps = {
  readiness(): Promise<{ ready: boolean; opensearch: 'ready' | 'unavailable' }>
  writeTimeline(input: TimelineWriteInput): Promise<TimelineLog>
  writeFull(input: FullWriteInput): Promise<FullLog>
  writeAudit(input: AuditWriteInput): Promise<AuditLog>
  listTimeline(limit?: number): Promise<TimelineLog[]>
  listFull(limit?: number): Promise<FullLog[]>
  listAudit(limit?: number): Promise<AuditLog[]>
  reload(input: ReloadInput): Promise<{ serviceId: string; reloadedAt: string }>
  search: SearchDeps
  projection: ProjectionDeps
}
