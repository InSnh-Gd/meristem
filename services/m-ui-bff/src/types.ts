import type { CommandWellEligibility, Permission } from '../../../packages/contracts/src/index.ts'

export type StateSourceMetadata = {
  sourceType: 'authoritative' | 'event' | 'cache' | 'read-model' | 'log' | 'audit' | 'policy'
  sourceId: string
  correlationId?: string
  traceId?: string
}

export type GenericNoopEligibility =
  | {
      state: 'enabled'
      command: {
        id: 'task.noop.submit'
        label: string
        action: Permission
        resource: string
        risk: 'medium'
        requiredPermissions: readonly Permission[]
        requiresPolicy: boolean
        requiresAudit: boolean
      }
    }
  | Extract<CommandWellEligibility, { state: 'disabled' }>

export const GENERIC_NOOP_COMMAND_ID = 'task.noop.submit'
