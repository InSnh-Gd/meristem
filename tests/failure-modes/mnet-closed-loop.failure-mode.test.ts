import { describe, expect, it } from 'bun:test'
import type { MNetBreakGlassGrantFromSchema } from '../../packages/contracts/src/index.ts'
import { createInMemoryDataPlaneStores } from '../../services/m-net/src/data-plane-store-memory.ts'
import { createInMemoryMNetClosedLoopStore } from '../../services/m-net/src/closed-loop-store-memory.ts'
import {
  MNetClosedLoopStorageError,
  type MNetClosedLoopStore
} from '../../services/m-net/src/closed-loop-store.ts'
import { decodeStoredMNetClosedLoopJoin } from '../../services/m-net/src/closed-loop-store-pg.ts'
import { createMNetClosedLoopService } from '../../services/m-net/src/closed-loop-workflow.ts'

const networkId = 'network-closed-loop-failure'
const nodeId = 'leaf-closed-loop-failure'
const now = '2026-07-24T10:00:00.000Z'

type FixtureOptions = {
  policy?: 'allow' | 'deny' | 'unavailable'
  auditUnavailable?: boolean
  eventUnavailable?: boolean
  secretIssueUnavailable?: boolean
  secretRotateUnavailable?: boolean
  secretRevokeUnavailable?: boolean
  migrationApplyUnavailable?: boolean
  migrationRollbackUnavailable?: boolean
  store?: MNetClosedLoopStore
}

function createFixture(options: FixtureOptions = {}) {
  const calls: string[] = []
  const store = options.store ?? createInMemoryMNetClosedLoopStore()
  let eventUnavailable = options.eventUnavailable ?? false
  let currentNow = now
  let idSequence = 0
  const service = createMNetClosedLoopService({
    store,
    dataPlane: createInMemoryDataPlaneStores(),
    now: () => new Date(currentNow),
    id: prefix => `${prefix}-failure-${++idSequence}`,
    policy: {
      async authorize(_actor, action) {
        calls.push(`policy:${action}`)
        if (options.policy === 'unavailable') throw new Error('policy offline')
        const result = options.policy ?? 'allow'
        return { result, id: `policy-${result}`, reasons: [`fixture ${result}`] }
      }
    },
    log: {
      async writeAudit(_actor, action) {
        calls.push(`audit:${action}`)
        if (options.auditUnavailable) throw new Error('audit offline')
      },
      async writeTimeline() {},
      async writeFull() {}
    },
    events: {
      async publish(subject) {
        calls.push(`event:${subject}`)
        if (eventUnavailable) throw new Error('event bus offline')
      }
    },
    credentials: {
      async issue(input) {
        calls.push(`secret:issue:${input.credentialId}`)
        return options.secretIssueUnavailable
          ? { ok: false, code: 'secret.provider_unavailable', message: 'secret provider offline' }
          : {
              ok: true,
              credentialRef: {
                provider: 'vault-kv-v2',
                keyPath: `secret/data/mnet/${input.credentialId}`,
                version: 1
              }
            }
      },
      async rotate(input) {
        if (options.secretRotateUnavailable) {
          return { ok: false, code: 'secret.provider_unavailable', message: 'rotation offline' }
        }
        return {
          ok: true,
          credentialRef: {
            provider: 'vault-kv-v2',
            keyPath: `secret/data/mnet/${input.credentialId}`,
            version: 2
          }
        }
      },
      async revoke(input) {
        calls.push(`secret:revoke:${input.credentialId}`)
        return options.secretRevokeUnavailable
          ? { ok: false, code: 'secret.provider_unavailable', message: 'revocation offline' }
          : { ok: true }
      }
    },
    network: {
      async listNetworks() {
        return { ok: true, value: [] }
      },
      async listMembers() {
        return { ok: true, value: [] }
      }
    },
    migration: {
      async apply() {
        calls.push('migration:apply')
        return options.migrationApplyUnavailable
          ? { ok: false, message: 'migration apply offline' }
          : { ok: true, appliedNetworkIds: [networkId] }
      },
      async rollback() {
        calls.push('migration:rollback')
        return options.migrationRollbackUnavailable
          ? { ok: false, message: 'migration rollback offline' }
          : { ok: true, appliedNetworkIds: [] }
      }
    },
    onMutation(kind) {
      calls.push(`mutation:${kind}`)
    }
  })
  return {
    calls,
    service,
    store,
    setEventUnavailable(value: boolean) {
      eventUnavailable = value
    },
    setNow(value: string) {
      currentNow = value
    }
  }
}

async function submitJoin(fixture: ReturnType<typeof createFixture>) {
  const result = await fixture.service.submitJoinRequest({
    requestId: 'join-failure',
    networkId,
    nodeId,
    requestedNodeKind: 'leaf',
    requestedProfileVersion: 'm-net-cn@0.3.0',
    requestedBy: 'operator',
    expiresAt: '2026-07-24T11:00:00.000Z',
    correlationId: 'correlation-join-failure'
  })
  if (!('kind' in result) || result.kind !== 'mutation') {
    throw new Error('expected committed join request')
  }
  return result.value
}

async function approveJoin(fixture: ReturnType<typeof createFixture>) {
  const submitted = await submitJoin(fixture)
  const result = await fixture.service.decideJoinRequest({
    actor: 'admin',
    requestId: submitted.requestId,
    decision: 'approve',
    credentialExpiresAt: '2026-07-25T10:00:00.000Z'
  })
  if (!('kind' in result) || result.kind !== 'mutation' || result.value.result !== 'approved') {
    throw new Error('expected approved join mutation')
  }
  return result.value.credential
}

describe('failure mode: M-Net closed-loop control', () => {
  it('fails closed before mutation when M-Policy is unavailable', async () => {
    const fixture = createFixture({ policy: 'unavailable' })
    const result = await fixture.service.changeRelayPolicy({
      actor: 'operator',
      networkId,
      state: 'enabled',
      routeClass: 'forced-tcp-relay',
      selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
      reason: 'regional failure',
      affectedNodeIds: [nodeId]
    })

    expect(result).toMatchObject({ kind: 'failure', error: { code: 'policy.unavailable' } })
    expect(await fixture.store.relayPolicies.get(networkId)).toBeNull()
    expect(fixture.calls.some(call => call.startsWith('audit:'))).toBe(false)
    expect(fixture.calls.some(call => call.startsWith('mutation:'))).toBe(false)
  })

  it('fails closed before mutation when Audit is unavailable', async () => {
    const fixture = createFixture({ auditUnavailable: true })
    const result = await fixture.service.changeRelayPolicy({
      actor: 'operator',
      networkId,
      state: 'enabled',
      routeClass: 'forced-tcp-relay',
      selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
      reason: 'regional failure',
      affectedNodeIds: [nodeId]
    })

    expect(result).toMatchObject({ kind: 'failure', error: { code: 'audit.write_failed' } })
    expect(await fixture.store.relayPolicies.get(networkId)).toBeNull()
    expect(fixture.calls.some(call => call.startsWith('mutation:'))).toBe(false)
  })

  it('keeps policy-denied join decisions side-effect free', async () => {
    const fixture = createFixture()
    const submitted = await submitJoin(fixture)
    const policyDenied = createFixture({ policy: 'deny', store: fixture.store })

    const result = await policyDenied.service.decideJoinRequest({
      actor: 'admin',
      requestId: submitted.requestId,
      decision: 'approve',
      credentialExpiresAt: '2026-07-25T10:00:00.000Z'
    })

    expect(result).toMatchObject({ result: 'denied', sideEffect: 'none' })
    expect(await fixture.store.joins.get(submitted.requestId)).toMatchObject({
      status: 'pending'
    })
    expect(await fixture.store.credentials.listByNetwork(networkId)).toEqual([])
  })

  it('does not mutate join state when credential issue fails', async () => {
    const fixture = createFixture({ secretIssueUnavailable: true })
    const submitted = await submitJoin(fixture)

    const result = await fixture.service.decideJoinRequest({
      actor: 'admin',
      requestId: submitted.requestId,
      decision: 'approve',
      credentialExpiresAt: '2026-07-25T10:00:00.000Z'
    })

    expect(result).toMatchObject({
      kind: 'failure',
      error: { code: 'secret.provider_unavailable' },
      recovery: 'no_side_effect'
    })
    expect(await fixture.store.joins.get(submitted.requestId)).toMatchObject({
      status: 'pending'
    })
    expect(await fixture.store.credentials.listByNetwork(networkId)).toEqual([])
  })

  it('returns a durable pending-publication outcome when EventBus is unavailable', async () => {
    const fixture = createFixture({ eventUnavailable: true })
    const result = await fixture.service.changeRelayPolicy({
      actor: 'operator',
      networkId,
      state: 'enabled',
      routeClass: 'forced-tcp-relay',
      selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
      reason: 'regional failure',
      affectedNodeIds: [nodeId]
    })

    expect(result).toMatchObject({
      kind: 'mutation',
      publication: {
        status: 'pending',
        pendingSubjects: ['mnet.relay_policy.changed.v0']
      }
    })
    expect(await fixture.store.relayPolicies.get(networkId)).toMatchObject({ state: 'enabled' })
    expect(await fixture.store.listPendingEventIntents()).toHaveLength(1)

    fixture.setEventUnavailable(false)
    expect(await fixture.service.dispatchPendingEvents()).toEqual({
      status: 'published',
      pendingSubjects: []
    })
    expect(await fixture.store.listPendingEventIntents()).toEqual([])
  })

  it('persists a fail-closed rotation operation when the secret provider is unavailable', async () => {
    const fixture = createFixture({ secretRotateUnavailable: true })
    const credential = await approveJoin(fixture)

    const result = await fixture.service.rotateCredential({
      actor: 'security-admin',
      credentialId: credential.credentialId,
      expiresAt: '2026-07-26T10:00:00.000Z',
      reason: 'scheduled rotation'
    })

    expect(result).toMatchObject({
      kind: 'failure',
      error: { code: 'secret.provider_unavailable' },
      recovery: 'retry_pending'
    })
    expect(await fixture.store.credentials.get(credential.credentialId)).toMatchObject({
      status: 'rotating'
    })
    expect(await fixture.service.isTunnelEligible(networkId, nodeId)).toBe(false)
    expect(await fixture.store.credentialOperations.listPending()).toHaveLength(1)
  })

  it('retries a persisted revocation operation after restart without restoring credential eligibility', async () => {
    const fixture = createFixture({ secretRevokeUnavailable: true })
    const credential = await approveJoin(fixture)

    const result = await fixture.service.revokeCredential({
      actor: 'security-admin',
      credentialId: credential.credentialId,
      reason: 'compromise response'
    })

    expect(result).toMatchObject({
      kind: 'failure',
      error: { code: 'secret.provider_unavailable' },
      recovery: 'retry_pending'
    })
    expect(await fixture.store.credentials.get(credential.credentialId)).toMatchObject({
      status: 'rotating'
    })
    expect(await fixture.service.isTunnelEligible(networkId, nodeId)).toBe(false)
    expect(await fixture.store.credentialOperations.listPending()).toHaveLength(1)

    const restarted = createFixture({ store: fixture.store })
    expect(await restarted.service.recoverPendingCredentialOperations()).toBe(1)
    expect(await restarted.store.credentials.get(credential.credentialId)).toMatchObject({
      status: 'revoked'
    })
    expect(await restarted.store.credentialOperations.listPending()).toEqual([])
    expect(await restarted.service.isTunnelEligible(networkId, nodeId)).toBe(false)
  })

  it('does not persist migration state when the migration engine fails', async () => {
    const fixture = createFixture({ migrationApplyUnavailable: true })
    const result = await fixture.service.migrateProfile({
      actor: 'admin',
      networkId,
      sourceProfileVersion: 'm-net-cn@0.2.0',
      targetProfileVersion: 'm-net-cn@0.3.0',
      reason: 'activate current profile'
    })

    expect(result).toMatchObject({
      kind: 'failure',
      error: { code: 'mnet.profile.migration_failed' }
    })
  })

  it('keeps rollback available when the migration rollback engine fails', async () => {
    const fixture = createFixture({ migrationRollbackUnavailable: true })
    const applied = await fixture.service.migrateProfile({
      actor: 'admin',
      networkId,
      sourceProfileVersion: 'm-net-cn@0.2.0',
      targetProfileVersion: 'm-net-cn@0.3.0',
      reason: 'activate current profile'
    })
    if (!('kind' in applied) || applied.kind !== 'mutation') {
      throw new Error('expected applied migration')
    }

    const result = await fixture.service.rollbackProfile({
      actor: 'admin',
      migrationId: applied.value.migrationId,
      reason: 'runtime proof failed'
    })

    expect(result).toMatchObject({
      kind: 'failure',
      error: { code: 'mnet.profile.rollback_failed' }
    })
    expect(await fixture.store.migrations.get(applied.value.migrationId)).toMatchObject({
      state: 'rollback_available',
      rollbackState: 'available'
    })
  })

  it('keeps break-glass pending when the second actor is not independent', async () => {
    const fixture = createFixture()
    const initiated = await fixture.service.initiateBreakGlass({
      actor: 'security-admin',
      networkId,
      reason: 'contain compromised overlay'
    })
    if (!('kind' in initiated) || initiated.kind !== 'mutation') {
      throw new Error('expected initiated break-glass')
    }

    const result = await fixture.service.approveBreakGlass({
      actor: 'security-admin',
      grantId: initiated.value.grantId
    })

    expect(result).toMatchObject({
      kind: 'failure',
      status: 403,
      error: { code: 'mnet.break_glass.independent_reviewer_required' }
    })
    expect(await fixture.store.breakGlass.get(initiated.value.grantId)).toMatchObject({
      state: 'second_approval_pending'
    })
  })

  it('returns a typed conflict when a concurrent sweep already auto-revoked break-glass', async () => {
    const fixture = createFixture()
    const initiated = await fixture.service.initiateBreakGlass({
      actor: 'security-admin',
      networkId,
      reason: 'contain compromised overlay'
    })
    if (!('kind' in initiated) || initiated.kind !== 'mutation') {
      throw new Error('expected initiated break-glass')
    }
    const autoRevoked: MNetBreakGlassGrantFromSchema = {
      ...initiated.value,
      secondApprover: 'break-glass-reviewer',
      state: 'auto_revoked',
      autoRevokedAt: initiated.value.expiresAt,
      evidence: {
        ...initiated.value.evidence,
        audit: {
          ...initiated.value.evidence.audit,
          result: 'auto-revoked'
        }
      }
    }
    let reads = 0
    fixture.store.breakGlass.get = async () => {
      reads += 1
      return reads === 1 ? initiated.value : autoRevoked
    }
    fixture.setNow(initiated.value.expiresAt)

    const result = await fixture.service.approveBreakGlass({
      actor: 'break-glass-reviewer',
      grantId: initiated.value.grantId
    })

    expect(result).toMatchObject({
      kind: 'failure',
      status: 409,
      error: { code: 'mnet.break_glass.not_pending' }
    })
  })

  it('allows only one concurrent credential rotation to claim the active credential', async () => {
    const fixture = createFixture()
    const credential = await approveJoin(fixture)

    const results = await Promise.all([
      fixture.service.rotateCredential({
        actor: 'admin',
        credentialId: credential.credentialId,
        expiresAt: '2026-07-26T10:00:00.000Z',
        reason: 'concurrent rotation one'
      }),
      fixture.service.rotateCredential({
        actor: 'admin',
        credentialId: credential.credentialId,
        expiresAt: '2026-07-26T10:00:00.000Z',
        reason: 'concurrent rotation two'
      })
    ])

    expect(results.filter(result => 'kind' in result && result.kind === 'mutation')).toHaveLength(1)
    expect(results.find(result => 'kind' in result && result.kind === 'failure')).toMatchObject({
      kind: 'failure',
      status: 409,
      error: { code: 'mnet.credential.transition_conflict' },
      recovery: 'no_side_effect'
    })
    const credentials = await fixture.store.credentials.listByNetwork(networkId)
    expect(
      credentials.filter(item => item.status === 'issued' || item.status === 'active')
    ).toHaveLength(1)
  })

  it('sanitizes unknown dependency messages at the workflow boundary', async () => {
    const fixture = createFixture()
    fixture.store.credentials.get = async () => {
      throw new Error('postgres://user:password@internal-db/mnet')
    }

    const result = await fixture.service.rotateCredential({
      actor: 'admin',
      credentialId: 'credential-sensitive-error',
      expiresAt: '2026-07-26T10:00:00.000Z',
      reason: 'exercise sanitized error boundary'
    })

    expect(result).toMatchObject({
      kind: 'failure',
      error: {
        code: 'mnet.dependency_failed',
        message: 'M-Net dependency is unavailable'
      }
    })
    expect(JSON.stringify(result)).not.toContain('password')
    expect(JSON.stringify(result)).not.toContain('internal-db')
  })

  it('maps storage failure to a typed recovery outcome', async () => {
    const base = createInMemoryMNetClosedLoopStore()
    const store: MNetClosedLoopStore = {
      ...base,
      async commit() {
        throw Object.assign(new Error('postgres write failed'), {
          code: 'mnet.store.write_failed'
        })
      }
    }
    const fixture = createFixture({ store })
    const result = await fixture.service.changeRelayPolicy({
      actor: 'operator',
      networkId,
      state: 'enabled',
      routeClass: 'forced-tcp-relay',
      selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
      reason: 'regional failure',
      affectedNodeIds: [nodeId]
    })

    expect(result).toMatchObject({
      kind: 'failure',
      error: { code: 'mnet.store.write_failed' },
      recovery: 'no_side_effect'
    })
    expect(await base.relayPolicies.get(networkId)).toBeNull()
  })

  it('rolls back an applied profile migration when durable storage fails', async () => {
    const base = createInMemoryMNetClosedLoopStore()
    const store: MNetClosedLoopStore = {
      ...base,
      async commit() {
        throw Object.assign(new Error('postgres write failed'), {
          code: 'mnet.store.write_failed'
        })
      }
    }
    const fixture = createFixture({ store })
    const result = await fixture.service.migrateProfile({
      actor: 'admin',
      networkId,
      sourceProfileVersion: 'm-net-cn@0.2.0',
      targetProfileVersion: 'm-net-cn@0.3.0',
      reason: 'activate current profile'
    })

    expect(result).toMatchObject({
      kind: 'failure',
      error: { code: 'mnet.store.write_failed' },
      recovery: 'compensated'
    })
    expect(fixture.calls.filter(call => call.startsWith('migration:'))).toEqual([
      'migration:apply',
      'migration:rollback'
    ])
  })

  it('fails closed when PostgreSQL contains an invalid closed-loop fact', () => {
    try {
      decodeStoredMNetClosedLoopJoin({ requestId: 'corrupt-row' })
      throw new Error('expected stored fact decode to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(MNetClosedLoopStorageError)
      if (!(error instanceof MNetClosedLoopStorageError)) throw error
      expect(error.code).toBe('mnet.store.decode_failed')
    }
  })
})
