import { beforeEach, describe, expect, it } from 'bun:test'
import {
  InternalNetworkProfileRejectResponseSchema,
  InternalNetworkProfileResumeResponseSchema
} from '../../packages/contracts/src/index.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'
import { createInMemorySuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'
import {
  createTestApp,
  decodeJson,
  ErrorResponseSchema,
  internalHeaders,
  internalToken,
  jwtSecret
} from './_helpers/mnet-profile-routes.ts'

describe('M-Net profile internal resume/reject routes', () => {
  const internalPost = (path: string, body?: Record<string, unknown>): Request =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: internalHeaders(),
      ...(body ? { body: JSON.stringify(body) } : {})
    })

  beforeEach(() => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
    process.env.MERISTEM_INTERNAL_TOKEN = internalToken
  })

  it('POST /internal/v0/network-profile-operations/:id/resume succeeds', async () => {
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createTestApp(profileStore, suspendedOps)
    const networkId = 'test-network-7'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })

    const op = await suspendedOps.create({
      policyDecisionId: 'pd-1',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable CN',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`)
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, InternalNetworkProfileResumeResponseSchema)
    expect(body.status).toBe('resumed')
    expect(body.operationId).toBe(op.id)

    const updatedOp = await suspendedOps.get(op.id)
    expect(updatedOp?.status).toBe('resumed')

    const state = await profileStore.getNetworkState(networkId)
    expect(state?.status).toBe('enabled')
    expect(state?.profileVersion).toBe('m-net-cn@0.1.0')
  })

  it('POST /internal/v0/network-profile-operations/:id/resume on stale state fails', async () => {
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createTestApp(profileStore, suspendedOps)
    const networkId = 'test-network-8'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabling'
    })

    const op = await suspendedOps.create({
      policyDecisionId: 'pd-2',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable CN',
      correlationId: 'corr-2',
      idempotencyKey: 'idem-2',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`)
    )

    expect(response.status).toBe(409)
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('resume.stale_state')

    const updatedOp = await suspendedOps.get(op.id)
    expect(updatedOp?.status).toBe('resume_failed')
    expect(updatedOp?.terminalReason).toContain('stale state')
  })

  it('POST /internal/v0/network-profile-operations/:id/resume on expired fails', async () => {
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createTestApp(profileStore, suspendedOps)
    const networkId = 'test-network-9'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })

    const op = await suspendedOps.create({
      policyDecisionId: 'pd-3',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable CN (expired)',
      correlationId: 'corr-3',
      idempotencyKey: 'idem-3',
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString()
    })

    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`)
    )

    expect(response.status).toBe(409)
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('operation.expired')

    const updatedOp = await suspendedOps.get(op.id)
    expect(updatedOp?.status).toBe('expired')
  })

  it('POST /internal/v0/network-profile-operations/:id/resume returns 404 for unknown operation', async () => {
    const app = createTestApp(createInMemoryProfileStore(), createInMemorySuspendedOperationStore())
    const response = await app.handle(
      internalPost('/internal/v0/network-profile-operations/nonexistent-id/resume')
    )

    expect(response.status).toBe(404)
  })

  it('POST /internal/v0/network-profile-operations/:id/resume returns 409 when operation is not suspended', async () => {
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createTestApp(profileStore, suspendedOps)
    const networkId = 'test-network-10'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })

    const op = await suspendedOps.create({
      policyDecisionId: 'pd-4',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable CN',
      correlationId: 'corr-4',
      idempotencyKey: 'idem-4',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    await suspendedOps.transition(op.id, 'resumed')

    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`)
    )

    expect(response.status).toBe(409)
    const body = await decodeJson(response, ErrorResponseSchema)
    expect(body.error.code).toBe('operation.not_suspended')
  })

  it('POST /internal/v0/network-profile-operations/:id/resume rejects duplicate resume', async () => {
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createTestApp(profileStore, suspendedOps)
    const networkId = 'test-network-duplicate-resume'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })

    const op = await suspendedOps.create({
      policyDecisionId: 'pd-duplicate-resume',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'duplicate resume test',
      correlationId: 'corr-duplicate-resume',
      idempotencyKey: 'idem-duplicate-resume',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    const first = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`)
    )
    expect(first.status).toBe(200)

    const second = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/resume`)
    )
    expect(second.status).toBe(409)
    const secondBody = await decodeJson(second, ErrorResponseSchema)
    expect(secondBody.error.code).toBe('operation.not_suspended')
  })

  it('POST /internal/v0/network-profile-operations/:id/reject succeeds', async () => {
    const profileStore = createInMemoryProfileStore()
    const suspendedOps = createInMemorySuspendedOperationStore()
    const app = createTestApp(profileStore, suspendedOps)
    const networkId = 'test-network-11'

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabling'
    })

    const op = await suspendedOps.create({
      policyDecisionId: 'pd-5',
      action: 'mnet.profile.enable',
      networkId,
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable CN',
      correlationId: 'corr-5',
      idempotencyKey: 'idem-5',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })

    const response = await app.handle(
      internalPost(`/internal/v0/network-profile-operations/${op.id}/reject`)
    )

    expect(response.status).toBe(200)
    const body = await decodeJson(response, InternalNetworkProfileRejectResponseSchema)
    expect(body.status).toBe('rejected')
    expect(body.operationId).toBe(op.id)

    const updatedOp = await suspendedOps.get(op.id)
    expect(updatedOp?.status).toBe('rejected')
    expect(updatedOp?.terminalReason).toBe('approval rejected')

    const state = await profileStore.getNetworkState(networkId)
    expect(state?.status).toBe('disabled')
    expect(state?.profileVersion).toBe('m-net-default@0.1.0')
  })

  it('POST /internal/v0/network-profile-operations/:id/resume returns 401 without internal token', async () => {
    const app = createTestApp(createInMemoryProfileStore(), createInMemorySuspendedOperationStore())
    const response = await app.handle(
      new Request('http://localhost/internal/v0/network-profile-operations/some-id/resume', {
        method: 'POST'
      })
    )

    expect(response.status).toBe(401)
  })
})
