import type { ActorId, Permission } from '../literals.ts'
import type { OperationDangerLevel, RiskFactor } from './task.ts'

export type PolicyResult = 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'

export type PolicyDecision = {
  id: string
  actor: ActorId
  action: Permission
  resource: string
  result: PolicyResult
  reasons: string[]
  operationDangerLevel?: OperationDangerLevel
  suspicionScore?: number
  riskFactors?: RiskFactor[]
  requiredAction?: 'manual_review' | 'multi_approval'
  createdAt: string
}

// 三层日志事实共享同一组基础字段，但语义和权限要求完全不同。
export type TimelineLog = {
  id: string
  timestamp: string
  summary: string
  subject?: string
  correlationId?: string
}

export type FullLog = {
  id: string
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: string
  message: string
  correlationId?: string
  traceId?: string
  payload?: unknown
}

export type AuditLog = {
  id: string
  timestamp: string
  actor: ActorId | 'system'
  action: string
  resource: string
  decisionId?: string
  result: string
  correlationId?: string
  traceId?: string
  payload?: unknown
}
