import type { MNetAppDeps } from './deps.ts'
import { canResume, type ProfileState } from './profile-state-machine.ts'

type FeatureDeps = Pick<
  MNetAppDeps,
  'profileStore' | 'suspendedOps' | 'networkUpdater' | 'events' | 'log'
> & {
  profileStore: NonNullable<MNetAppDeps['profileStore']>
  suspendedOps: NonNullable<MNetAppDeps['suspendedOps']>
}

type SuspendedOp = NonNullable<Awaited<ReturnType<FeatureDeps['suspendedOps']['get']>>>

export type ProfileAdminFailure = {
  kind: 'failure'
  status: 404 | 409 | 503
  error: { code: string; message: string }
}

export function isProfileAdminFailure(value: unknown): value is ProfileAdminFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind?: string }).kind === 'failure'
  )
}

function failure(
  status: ProfileAdminFailure['status'],
  code: string,
  message: string
): ProfileAdminFailure {
  return { kind: 'failure', status, error: { code, message } }
}

function toProfileState(status: string): ProfileState | null {
  switch (status) {
    case 'disabled':
    case 'enabling':
    case 'enabled':
    case 'disabling':
    case 'failed':
      return status
    default:
      return null
  }
}

/**
 * internal admin 路由必须同时具备 suspended ops 和 profile store；否则 fail-closed。
 */
export function requireProfileAdminDeps(
  deps: Pick<MNetAppDeps, 'profileStore' | 'suspendedOps' | 'networkUpdater' | 'events' | 'log'>
): FeatureDeps | ProfileAdminFailure {
  if (!deps.suspendedOps || !deps.profileStore) {
    return failure(503, 'feature.unavailable', 'profile features are not available')
  }
  return {
    profileStore: deps.profileStore,
    suspendedOps: deps.suspendedOps,
    ...(deps.networkUpdater ? { networkUpdater: deps.networkUpdater } : {}),
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.log ? { log: deps.log } : {})
  }
}

async function loadPendingOperation(
  suspendedOps: FeatureDeps['suspendedOps'],
  id: string
): Promise<SuspendedOp | ProfileAdminFailure> {
  const suspendedOp = await suspendedOps.get(id)
  if (!suspendedOp) {
    return failure(404, 'operation.not_found', 'suspended operation not found')
  }
  if (suspendedOp.status !== 'suspended') {
    return failure(409, 'operation.not_suspended', 'operation is not suspended')
  }
  return suspendedOp
}

async function expireIfNeeded(
  suspendedOps: FeatureDeps['suspendedOps'],
  suspendedOp: SuspendedOp
): Promise<true | ProfileAdminFailure> {
  if (new Date(suspendedOp.expiresAt) >= new Date()) return true
  await suspendedOps.transition(suspendedOp.id, 'expired', 'operation expired')
  return failure(409, 'operation.expired', 'suspended operation expired')
}

async function publishResumeFailureArtifacts(
  deps: FeatureDeps,
  suspendedOp: SuspendedOp,
  input: {
    terminalReason: string
    failureReason: string
  }
) {
  await deps.suspendedOps.transition(suspendedOp.id, 'resume_failed', input.terminalReason)
  await deps.events?.publish(
    'mnet.profile.apply_failed.v0',
    'mnet.profile.apply_failed',
    {
      networkId: suspendedOp.networkId,
      fromProfileVersion: suspendedOp.fromProfileVersion,
      toProfileVersion: suspendedOp.toProfileVersion,
      actor: 'system',
      policyDecisionId: suspendedOp.policyDecisionId,
      operationId: suspendedOp.id,
      correlationId: suspendedOp.correlationId,
      reason: input.failureReason,
      controlPlaneOnly: true
    },
    suspendedOp.correlationId
  )
  await deps.log?.writeTimeline(
    `profile apply failed for network ${suspendedOp.networkId}`,
    'mnet.profile.apply_failed',
    suspendedOp.correlationId
  )
  await deps.log?.writeAudit(
    'system',
    'mnet.profile.enable.failure',
    `network:${suspendedOp.networkId}`,
    'failure',
    suspendedOp.correlationId,
    { reason: input.failureReason }
  )
}

/**
 * resume 成功路径会同时提交 profile 状态、network updater、transition、event 和 audit；集中成 workflow 便于保持顺序一致。
 */
export async function resumeProfileAdminOperation(
  deps: FeatureDeps,
  id: string
): Promise<{ status: 'resumed'; operationId: string } | ProfileAdminFailure> {
  const suspendedOp = await loadPendingOperation(deps.suspendedOps, id)
  if (isProfileAdminFailure(suspendedOp)) return suspendedOp

  const notExpired = await expireIfNeeded(deps.suspendedOps, suspendedOp)
  if (isProfileAdminFailure(notExpired)) return notExpired

  const state = await deps.profileStore.getNetworkState(suspendedOp.networkId)
  if (!state || state.profileVersion !== suspendedOp.fromProfileVersion) {
    await publishResumeFailureArtifacts(deps, suspendedOp, {
      terminalReason: 'stale state: current profile does not match expected',
      failureReason: 'stale_state'
    })
    return failure(
      409,
      'resume.stale_state',
      'network profile has changed since operation was created'
    )
  }

  const profileState = toProfileState(state.status)
  if (!profileState || !canResume(profileState)) {
    const stateReason = `state is ${state.status}, not enabling`
    await publishResumeFailureArtifacts(deps, suspendedOp, {
      terminalReason: `invalid state for resume: ${state.status}`,
      failureReason: stateReason
    })
    return failure(409, 'resume.invalid_state', 'network is not in enabling state')
  }

  await deps.profileStore.setNetworkState(suspendedOp.networkId, {
    profileVersion: suspendedOp.toProfileVersion,
    status: 'enabled'
  })
  await deps.networkUpdater?.setProfileVersion(suspendedOp.networkId, suspendedOp.toProfileVersion)
  await deps.profileStore.recordTransition({
    networkId: suspendedOp.networkId,
    fromVersion: suspendedOp.fromProfileVersion,
    toVersion: suspendedOp.toProfileVersion,
    fromStatus: 'enabling',
    toStatus: 'enabled',
    actor: 'system',
    reason: 'approved resume',
    policyDecisionId: suspendedOp.policyDecisionId,
    correlationId: suspendedOp.correlationId
  })
  await deps.suspendedOps.transition(suspendedOp.id, 'resumed')

  await deps.events?.publish(
    'mnet.profile.enabled.v0',
    'mnet.profile.enabled',
    {
      networkId: suspendedOp.networkId,
      fromProfileVersion: suspendedOp.fromProfileVersion,
      toProfileVersion: suspendedOp.toProfileVersion,
      actor: 'system',
      policyDecisionId: suspendedOp.policyDecisionId,
      operationId: suspendedOp.id,
      correlationId: suspendedOp.correlationId,
      reason: suspendedOp.reason ?? 'approved resume',
      controlPlaneOnly: true
    },
    suspendedOp.correlationId
  )
  await deps.log?.writeTimeline(
    `profile enabled for network ${suspendedOp.networkId}`,
    'mnet.profile.enabled',
    suspendedOp.correlationId
  )
  await deps.log?.writeFull(
    'info',
    `profile enabled for network ${suspendedOp.networkId}`,
    suspendedOp.correlationId,
    { profileVersion: suspendedOp.toProfileVersion, operationId: suspendedOp.id }
  )
  await deps.log?.writeAudit(
    'system',
    'mnet.profile.enable.resume.attempt',
    `network:${suspendedOp.networkId}`,
    'success',
    suspendedOp.correlationId
  )
  await deps.log?.writeAudit(
    'system',
    'mnet.profile.enable.success',
    `network:${suspendedOp.networkId}`,
    'success',
    suspendedOp.correlationId,
    { profileVersion: suspendedOp.toProfileVersion }
  )

  return { status: 'resumed', operationId: id }
}

/**
 * reject 是 enable suspended-op 的补偿路径；路由只保留入口，workflow 负责状态回滚与事件记录。
 */
export async function rejectProfileAdminOperation(
  deps: FeatureDeps,
  id: string
): Promise<{ status: 'rejected'; operationId: string } | ProfileAdminFailure> {
  const suspendedOp = await loadPendingOperation(deps.suspendedOps, id)
  if (isProfileAdminFailure(suspendedOp)) return suspendedOp

  await deps.profileStore.setNetworkState(suspendedOp.networkId, {
    profileVersion: suspendedOp.fromProfileVersion,
    status: 'disabled'
  })
  await deps.profileStore.recordTransition({
    networkId: suspendedOp.networkId,
    fromVersion: suspendedOp.fromProfileVersion,
    toVersion: suspendedOp.toProfileVersion,
    fromStatus: 'enabling',
    toStatus: 'disabled',
    actor: 'system',
    reason: 'approval rejected',
    policyDecisionId: suspendedOp.policyDecisionId,
    correlationId: suspendedOp.correlationId
  })
  await deps.suspendedOps.transition(suspendedOp.id, 'rejected', 'approval rejected')

  await deps.events?.publish(
    'mnet.profile.enable.canceled.v0',
    'mnet.profile.enable.canceled',
    {
      networkId: suspendedOp.networkId,
      fromProfileVersion: suspendedOp.fromProfileVersion,
      toProfileVersion: suspendedOp.toProfileVersion,
      actor: 'system',
      policyDecisionId: suspendedOp.policyDecisionId,
      operationId: suspendedOp.id,
      correlationId: suspendedOp.correlationId,
      reason: 'approval rejected',
      controlPlaneOnly: true
    },
    suspendedOp.correlationId
  )
  await deps.log?.writeTimeline(
    `profile enable canceled for network ${suspendedOp.networkId}`,
    'mnet.profile.enable.canceled',
    suspendedOp.correlationId
  )
  await deps.log?.writeAudit(
    'system',
    'mnet.profile.enable.cancel',
    `network:${suspendedOp.networkId}`,
    'canceled',
    suspendedOp.correlationId
  )

  return { status: 'rejected', operationId: id }
}
