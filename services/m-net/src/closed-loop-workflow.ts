import { createJoinCredentialWorkflow } from './closed-loop-join-credential-workflow.ts'
import { createMigrationBreakGlassWorkflow } from './closed-loop-migration-break-glass-workflow.ts'
import { projectNodeAgentSidecarStatus } from './closed-loop-sidecar-projection.ts'
import { createTopologyWorkflow } from './closed-loop-topology-workflow.ts'
import {
  closedLoopFailureFromUnknown,
  createClosedLoopWorkflowContext
} from './closed-loop-workflow-support.ts'
import type { ClosedLoopFailure, MNetClosedLoopDeps } from './closed-loop-workflow-types.ts'

function protect<Args extends readonly unknown[], Result>(
  operation: (...args: Args) => Promise<Result>
): (...args: Args) => Promise<Result | ClosedLoopFailure> {
  return async (...args) => {
    try {
      return await operation(...args)
    } catch (error) {
      return closedLoopFailureFromUnknown(error)
    }
  }
}

/**
 * M-Net closed-loop facade：路由只依赖这一稳定入口，具体状态机按职责拆分。
 */
export function createMNetClosedLoopService(deps: MNetClosedLoopDeps) {
  const context = createClosedLoopWorkflowContext(deps)
  const joinCredential = createJoinCredentialWorkflow(context)
  const topology = createTopologyWorkflow(context)
  const migrationBreakGlass = createMigrationBreakGlassWorkflow(context)
  return {
    submitJoinRequest: protect(joinCredential.submitJoinRequest),
    decideJoinRequest: protect(joinCredential.decideJoinRequest),
    rotateCredential: protect(joinCredential.rotateCredential),
    revokeCredential: protect(joinCredential.revokeCredential),
    recoverPendingCredentialOperations: joinCredential.recoverPendingCredentialOperations,
    isTunnelEligible: joinCredential.isTunnelEligible,
    changeRelayPolicy: protect(topology.changeRelayPolicy),
    recordSidecarStatus: protect(topology.recordSidecarStatus),
    recordTunnelHealth: protect(topology.recordTunnelHealth),
    getTopologyView: protect(topology.getTopologyView),
    migrateProfile: protect(migrationBreakGlass.migrateProfile),
    rollbackProfile: protect(migrationBreakGlass.rollbackProfile),
    initiateBreakGlass: protect(migrationBreakGlass.initiateBreakGlass),
    approveBreakGlass: protect(migrationBreakGlass.approveBreakGlass),
    enforceBreakGlassExpiry: protect(migrationBreakGlass.enforceBreakGlassExpiry),
    enforceExpiredBreakGlass: migrationBreakGlass.enforceExpiredBreakGlass,
    isBreakGlassActive: migrationBreakGlass.isBreakGlassActive,
    dispatchPendingEvents: context.dispatchPendingEvents
  }
}

export { projectNodeAgentSidecarStatus }
export type { ClosedLoopFailure, MNetClosedLoopDeps } from './closed-loop-workflow-types.ts'

export type MNetClosedLoopService = ReturnType<typeof createMNetClosedLoopService>
