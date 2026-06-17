import {
  actorIds,
  permissions as permissionLiterals
} from '../../../../packages/contracts/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import { tracedEvent } from '../middleware/route-support.ts'
import type { CoreDeps } from '../types.ts'

export async function readSession(deps: CoreDeps, headers: Record<string, string | undefined>) {
  const auth = await requireActor(deps, headers)
  const permissions = await deps.auth.getPermissions(auth.actor)
  if (!permissions.ok) {
    throw new CoreError(503, permissions.error.code, permissions.error.message, auth.correlationId)
  }
  return { actor: auth.actor, permissions: permissions.value }
}

export async function requireCoreStatusRead(
  deps: CoreDeps,
  headers: Record<string, string | undefined>
) {
  const auth = await requireActor(deps, headers)
  await authorize(deps, {
    actor: auth.actor,
    action: 'core:read',
    resource: 'core',
    correlationId: auth.correlationId
  })
  return auth
}

export async function readCoreReadiness(deps: CoreDeps, degradedEventOpen: { value: boolean }) {
  const dependencies = await deps.storage.readiness()
  const ready = Object.values(dependencies).every(dependency => dependency === 'ready')
  if (!ready && !degradedEventOpen.value) {
    degradedEventOpen.value = true
    await deps.events.publish(
      'core.lifecycle.degraded.v0',
      tracedEvent({
        type: 'core.lifecycle.degraded',
        source: 'meristem-core',
        payload: { dependencies }
      })
    )
  }
  if (ready) degradedEventOpen.value = false
  return { ready, dependencies }
}

export const sessionActorIds = actorIds
export const sessionPermissions = permissionLiterals
