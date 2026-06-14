import { afterAll, beforeAll, describe, expect, it, test } from 'bun:test'
import type { ManagedProcess } from '../helpers/process.ts'
import { coreFetch, infrastructureAvailable, startFullStack, stopFullStack } from './_shared.ts'

const infraOk = await infrastructureAvailable()
const mnetUrl = 'http://127.0.0.1:3104'
const policyUrl = 'http://127.0.0.1:3101'

async function parseJsonOrEmpty(response: Response, scope: string): Promise<unknown> {
  if (response.status === 204) return {}
  return await response.json().catch(error => {
    console.warn(
      `${scope}: failed to parse JSON response (${response.status}) - ${error instanceof Error ? error.message : String(error)}`
    )
    return {}
  })
}

async function mnetFetch(
  path: string,
  token: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(`${mnetUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`
    }
  })
  const data = await parseJsonOrEmpty(response, `mnet-profile mnetFetch ${path}`)
  return { ok: response.ok, status: response.status, data }
}

async function policyFetch(
  path: string,
  token: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(`${policyUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`
    }
  })
  const data = await parseJsonOrEmpty(response, `mnet-profile policyFetch ${path}`)
  return { ok: response.ok, status: response.status, data }
}

describe('e2e: m-net profile lifecycle', () => {
  let devAll: ManagedProcess | null = null
  let bffProcess: ManagedProcess | null = null
  let operatorToken = ''
  let adminToken = ''
  let securityAdminToken = ''

  beforeAll(async () => {
    if (!infraOk) return
    const stack = await startFullStack()
    devAll = stack.devAll
    bffProcess = stack.bffProcess
    operatorToken = stack.operatorToken
    adminToken = stack.adminToken
    securityAdminToken = stack.securityAdminToken
  }, 60_000)

  afterAll(async () => {
    if (!infraOk || !devAll || !bffProcess) return
    await stopFullStack(devAll, bffProcess)
  }, 30_000)

  test.skipIf(!infraOk)(
    'runs full enable->approve->disable lifecycle and checks event/audit/timeline consistency',
    async () => {
      const createNetwork = await coreFetch('/api/v0/networks', operatorToken, {
        method: 'POST',
        body: JSON.stringify({ name: `e2e-mnet-profile-${Date.now()}` })
      })
      expect(createNetwork.status).toBe(200)
      const created = createNetwork.data as { network: { id: string } }
      const networkId = created.network.id

      const enable = await mnetFetch(`/api/v0/networks/${networkId}/profile`, adminToken, {
        method: 'POST',
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.1.0',
          reason: 'e2e approval flow enable'
        })
      })
      expect(enable.status).toBe(200)
      const enableBody = enable.data as {
        status: string
        operationId: string
        approvalId?: string
        correlationId: string
      }
      expect(enableBody.status).toBe('pending_approval')
      expect(enableBody.operationId).toBeString()
      expect(enableBody.approvalId).toBeString()
      const correlationId = enableBody.correlationId

      const pendingApprovals = await policyFetch('/api/v0/policy/approvals', securityAdminToken)
      expect(pendingApprovals.status).toBe(200)
      const approvalsBody = pendingApprovals.data as {
        approvals: Array<{ id: string; operationId: string; originService: string; status: string }>
      }
      const targetApproval = approvalsBody.approvals.find(
        item => item.operationId === enableBody.operationId
      )
      expect(targetApproval).toBeDefined()
      expect(targetApproval?.originService).toBe('m-net')
      expect(targetApproval?.status).toBe('pending')
      if (!targetApproval) throw new Error('missing approval for profile enable flow')

      const approve = await policyFetch(
        `/api/v0/policy/approvals/${targetApproval.id}/approve`,
        securityAdminToken,
        {
          method: 'POST',
          body: JSON.stringify({ reason: 'e2e security-admin approval' })
        }
      )
      expect(approve.status).toBe(200)

      const activeState = await coreFetch('/api/v0/networks', operatorToken)
      expect(activeState.status).toBe(200)
      const networksAfterEnable = activeState.data as {
        networks: Array<{ id: string; profileVersion: string }>
      }
      const networkAfterEnable = networksAfterEnable.networks.find(
        network => network.id === networkId
      )
      expect(networkAfterEnable?.profileVersion).toBe('m-net-cn@0.1.0')

      const timeline = await coreFetch('/api/v0/logs/timeline', operatorToken)
      expect(timeline.status).toBe(200)
      const timelineEntries = (
        timeline.data as { entries: Array<{ correlationId?: string; subject?: string }> }
      ).entries
      expect(
        timelineEntries.some(
          entry => entry.correlationId === correlationId && entry.subject === 'mnet.profile.enabled'
        )
      ).toBe(true)

      const fullLogs = await coreFetch('/api/v0/logs/full', operatorToken)
      expect(fullLogs.status).toBe(200)
      const fullEntries = (fullLogs.data as { entries: Array<{ correlationId?: string }> }).entries
      expect(fullEntries.some(entry => entry.correlationId === correlationId)).toBe(true)

      const audit = await coreFetch('/api/v0/audit', securityAdminToken)
      expect(audit.status).toBe(200)
      const auditEntries = (
        audit.data as { entries: Array<{ correlationId?: string; action?: string }> }
      ).entries
      expect(
        auditEntries.some(
          entry =>
            entry.correlationId === correlationId && entry.action === 'mnet.profile.enable.success'
        )
      ).toBe(true)

      const disable = await mnetFetch(`/api/v0/networks/${networkId}/profile`, adminToken, {
        method: 'POST',
        body: JSON.stringify({
          profileVersion: 'm-net-default@0.1.0',
          reason: 'e2e disable back to default'
        })
      })
      expect(disable.status).toBe(200)

      const finalState = await coreFetch('/api/v0/networks', operatorToken)
      expect(finalState.status).toBe(200)
      const networksAfterDisable = finalState.data as {
        networks: Array<{ id: string; profileVersion: string }>
      }
      const networkAfterDisable = networksAfterDisable.networks.find(
        network => network.id === networkId
      )
      expect(networkAfterDisable?.profileVersion).toBe('m-net-default@0.1.0')
    },
    90_000
  )

  it('documents skip condition when PostgreSQL or NATS is unavailable', () => {
    if (!infraOk) {
      expect(true).toBe(true)
      return
    }
    expect(true).toBe(true)
  })
})
