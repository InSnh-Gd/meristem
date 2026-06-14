import type { ActorId, Permission } from '../../../packages/contracts/src/literals.ts'
import type {
  MExtensionDefinition,
  MExtensionLifecyclePayload
} from '../../../packages/contracts/src/types/extension.ts'
import type { ExtensionStore } from './store.ts'

export type MExtensionError = { code: string; message: string }

export type PolicyDecisionResult =
  | 'allow'
  | 'deny'
  | 'require_manual_review'
  | 'require_multi_approval'

export type MExtensionPolicyDecision = {
  result: PolicyDecisionResult
  id: string
  reasons: string[]
}

export type MExtensionDeps = {
  jwtSecret: string
  store: ExtensionStore
  policy: {
    authorize(
      actor: ActorId,
      action: Permission,
      resource: string
    ): Promise<MExtensionPolicyDecision>
  }
  log: {
    writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void>
    writeFull(
      level: 'debug' | 'info' | 'warn' | 'error',
      message: string,
      correlationId?: string,
      payload?: unknown
    ): Promise<void>
    writeAudit(
      actor: ActorId,
      action: string,
      resource: string,
      result: string,
      correlationId: string,
      payload: unknown
    ): Promise<void>
  }
  events: {
    publish(
      subject: string,
      type: string,
      payload: MExtensionLifecyclePayload,
      correlationId?: string
    ): Promise<void>
  }
  readiness(): Promise<{ ready: boolean }>
}

export type AuthContext = { actor: ActorId; correlationId: string }

export type LifecyclePayloadInput = {
  definition: MExtensionDefinition
  actor: ActorId
  decisionId: string
  reason?: string | undefined
  correlationId: string
  errorCode?: string | undefined
}
