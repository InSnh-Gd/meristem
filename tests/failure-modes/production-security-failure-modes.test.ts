import { describe, expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import { createLocalIamService, type LocalIamAuditFact } from '../../packages/auth/src/index.ts'
import { ok } from '../../packages/common/src/result.ts'
import type {
  DeploymentConfigV02FromSchema,
  NodeAgentRuntimeDesiredSidecar
} from '../../packages/contracts/src/index.ts'
import {
  createLocalDevEnvSecretProvider,
  createSecretManager,
  createVaultKvV2SecretProvider
} from '../../packages/secrets/src/index.ts'
import { createInMemoryDataPlaneStores } from '../../services/m-net/src/data-plane-store-memory.ts'
import { createInMemoryMNetClosedLoopStore } from '../../services/m-net/src/closed-loop-store-memory.ts'
import { createMNetClosedLoopService } from '../../services/m-net/src/closed-loop-workflow.ts'
import {
  createInMemoryMDeployDeps,
  createMDeployApp,
  runtimeTestControllerFingerprint
} from '../../services/m-deploy/src/index.ts'
import { applySidecarDesiredState } from '../../services/node-agent/src/node-agent-sidecar-lifecycle.ts'

const networkId = 'production-security-network'
const nodeId = 'production-security-node'
const initialNow = '2026-07-24T10:00:00.000Z'
const deploymentDigest = { algorithm: 'sha256', value: 'sha256:desired-state-001' }

type MNetFixtureOptions = {
  policy?: 'allow' | 'deny'
  auditUnavailable?: boolean
}

function createMNetFixture(options: MNetFixtureOptions = {}) {
  const calls: string[] = []
  const store = createInMemoryMNetClosedLoopStore()
  let currentNow = initialNow
  let idSequence = 0
  const service = createMNetClosedLoopService({
    store,
    dataPlane: createInMemoryDataPlaneStores(),
    now: () => new Date(currentNow),
    id: prefix => `${prefix}-production-security-${++idSequence}`,
    policy: {
      async authorize(_actor, action) {
        calls.push(`policy:${action}`)
        const result = options.policy ?? 'allow'
        return { result, id: `policy-${result}`, reasons: [`production security ${result}`] }
      }
    },
    log: {
      async writeAudit(_actor, action) {
        calls.push(`audit:${action}`)
        if (options.auditUnavailable) throw new Error('M-Log unavailable')
      },
      async writeTimeline() {},
      async writeFull() {}
    },
    events: {
      async publish(subject) {
        calls.push(`event:${subject}`)
      }
    },
    credentials: {
      async issue(input) {
        return {
          ok: true,
          credentialRef: {
            provider: 'vault-prod',
            keyPath: `secret/data/mnet/${input.credentialId}`,
            version: 1
          }
        }
      },
      async rotate(input) {
        return {
          ok: true,
          credentialRef: {
            provider: 'vault-prod',
            keyPath: `secret/data/mnet/${input.credentialId}`,
            version: 2
          }
        }
      },
      async revoke() {
        return { ok: true }
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
        return { ok: true, appliedNetworkIds: [networkId] }
      },
      async rollback() {
        return { ok: true, appliedNetworkIds: [] }
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
    setNow(value: string) {
      currentNow = value
    }
  }
}

function relayPolicyChange(fixture: ReturnType<typeof createMNetFixture>) {
  return fixture.service.changeRelayPolicy({
    actor: 'operator',
    networkId,
    state: 'enabled',
    routeClass: 'forced-tcp-relay',
    selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
    reason: 'production security failure-mode test',
    affectedNodeIds: [nodeId]
  })
}

async function withMDeployInternalToken<T>(token: string, action: () => Promise<T>): Promise<T> {
  const previous = process.env.MERISTEM_INTERNAL_TOKEN
  process.env.MERISTEM_INTERNAL_TOKEN = token
  try {
    return await action()
  } finally {
    if (previous === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
    else process.env.MERISTEM_INTERNAL_TOKEN = previous
  }
}

async function enrollMDeployAgent(
  app: ReturnType<typeof createMDeployApp>,
  internalToken: string,
  agentId: string
): Promise<void> {
  const response = await app.handle(
    new Request('http://mdeploy.internal/internal/v0/deploy/agents/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-meristem-internal-token': internalToken },
      body: JSON.stringify({
        schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
        agentId,
        hostId: `host-${agentId}`,
        capabilities: [{ runtimeDriver: 'podman', version: '5.0.0', features: ['quadlet'] }],
        controllerTrust: {
          issuer: 'm-deploy-controller',
          audience: 'mdeploy-agent',
          publicKeyFingerprint: runtimeTestControllerFingerprint(),
          expiresAt: '2026-07-25T00:00:00.000Z'
        },
        enrolledAt: initialNow
      })
    })
  )
  expect(response.status).toBe(200)
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'object' || value === null) throw new Error(`expected ${name} container`)
  const field = Reflect.get(value, name)
  if (typeof field !== 'string') throw new Error(`expected ${name}`)
  return field
}

async function createApprovedMDeployProposal(
  app: ReturnType<typeof createMDeployApp>,
  agentId: string
): Promise<void> {
  const proposed = await app.handle(
    new Request('http://mdeploy.internal/api/v0/deploy/proposals', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin',
        'content-type': 'application/json',
        'x-correlation-id': 'corr-production-security'
      },
      body: JSON.stringify({
        sourceRef: {
          repositoryUrl: 'https://git.example/meristem/desired-state.git',
          branch: 'main',
          commit: '0123456789abcdef0123456789abcdef01234567',
          path: 'deploy/production',
          digest: deploymentDigest,
          syncedAt: initialNow
        },
        diffSummary: { added: 1, changed: 1, removed: 0, summary: 'production security test' }
      })
    })
  )
  if (!proposed.ok) throw new Error('expected deployment proposal to be created')
  const proposal = await proposed.json()
  if (typeof proposal !== 'object' || proposal === null) throw new Error('expected proposal body')
  const proposalRecord = Reflect.get(proposal, 'proposal')
  const proposalId = stringField(proposalRecord, 'proposalId')

  const approved = await app.handle(
    new Request(`http://mdeploy.internal/api/v0/deploy/proposals/${proposalId}/approve`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer security-admin',
        'content-type': 'application/json',
        'x-correlation-id': 'corr-production-security'
      },
      body: JSON.stringify({ result: 'approve' })
    })
  )
  expect(approved.status).toBe(200)

  const apply = await app.handle(
    new Request('http://mdeploy.internal/api/v0/deploy/apply', {
      method: 'POST',
      headers: {
        authorization: 'Bearer security-admin',
        'content-type': 'application/json',
        'x-correlation-id': 'corr-production-security'
      },
      body: JSON.stringify({ proposalId, agentId })
    })
  )
  expect(apply.status).toBe(400)
  expect(await apply.json()).toMatchObject({ error: { code: 'unsigned_desired_state' } })
}

const sidecarDeploymentConfig: DeploymentConfigV02FromSchema = {
  track: 'nixos',
  serviceUrls: {
    core: 'http://core.test',
    mnet: 'http://mnet.test',
    policy: 'http://policy.test',
    log: 'http://log.test',
    eventbus: 'http://eventbus.test',
    task: 'http://task.test',
    extension: 'http://extension.test',
    uiBff: 'http://ui-bff.test',
    nodeAgent: 'http://node-agent.test'
  },
  internalAuth: { headerName: 'x-meristem-internal-token', tokenEnvVar: 'MERISTEM_INTERNAL_TOKEN' },
  oidc: {
    provider: 'oidc',
    issuer: 'https://keycloak.test/realms/meristem',
    audiences: ['meristem-core']
  },
  secretProvider: {
    providerName: 'runtime',
    backend: 'local-dev-env',
    namedProvider: { name: 'runtime', config: { backend: 'local-dev-env', envMappings: {} } }
  },
  secretBindings: [],
  netbird: {
    signalEndpoint: 'https://signal.test',
    relayEndpoint: 'https://relay.test',
    stunEndpoint: 'stun:stun.test:3478'
  },
  nodeAgentCapabilities: {
    netAdmin: true,
    wireguardModulePath: '/lib/modules/wireguard.ko',
    wgBinaryPath: '/usr/bin/wg',
    ipBinaryPath: '/usr/bin/ip'
  },
  readiness: {
    postgres: { kind: 'postgres-select-1', target: 'postgres' },
    core: { kind: 'http-get', target: 'core', endpoint: '/ready' },
    mnet: { kind: 'http-get', target: 'mnet', endpoint: '/ready' },
    policy: { kind: 'http-get', target: 'policy', endpoint: '/ready' },
    log: { kind: 'http-get', target: 'log', endpoint: '/ready' },
    eventbus: { kind: 'http-get', target: 'eventbus', endpoint: '/ready' },
    task: { kind: 'http-get', target: 'task', endpoint: '/ready' },
    extension: { kind: 'http-get', target: 'extension', endpoint: '/ready' },
    uiBff: { kind: 'http-get', target: 'ui-bff', endpoint: '/ready' },
    nodeAgent: { kind: 'http-get', target: 'node-agent', endpoint: '/ready' }
  }
}

const desiredSidecar: NodeAgentRuntimeDesiredSidecar = {
  desiredState: 'start',
  credentialStatus: 'ready',
  healthStatus: 'healthy',
  signalConfigRef: { configRef: 'netbird/signal/production' },
  relayConfigRef: { configRef: 'netbird/relay/production' },
  stunConfigRef: { configRef: 'netbird/stun/production' },
  sidecarCredentialRef: { provider: 'runtime', keyPath: 'netbird/sidecar/production' }
}

describe('production security, policy, and audit failure modes', () => {
  it('blocks a high-risk secret mutation when Audit cannot be written without persisting it', async () => {
    const app = createCoreApp(
      createInMemoryCoreDeps({ actor: 'security-admin', auditAvailable: false })
    )
    const secretName = 'audit-failure-must-not-persist'

    const blocked = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        method: 'POST',
        headers: {
          authorization: 'Bearer security-admin-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ name: secretName, scope: 'system', value: 'test-only-value' })
      })
    )

    expect(blocked.status).toBe(503)
    expect(await blocked.json()).toMatchObject({
      error: { code: expect.stringContaining('audit') }
    })
    const listed = await app.handle(
      new Request('http://localhost/api/v0/secrets', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )
    expect(listed.status).toBe(200)
    expect(await listed.text()).not.toContain(secretName)
  })

  it('records policy-denial evidence while keeping a relay-policy mutation side-effect free', async () => {
    const fixture = createMNetFixture({ policy: 'deny' })
    const denied = await relayPolicyChange(fixture)

    expect(denied).toMatchObject({
      result: 'denied',
      sideEffect: 'none',
      policy: { outcome: 'deny' },
      audit: { result: 'denied' }
    })
    expect(fixture.calls).toContain('audit:mnet.relay_policy.enable')
    expect(await fixture.store.relayPolicies.get(networkId)).toBeNull()
    expect(fixture.calls.some(call => call.startsWith('mutation:'))).toBe(false)
  })

  it('revokes existing sessions and rejects new sessions after an identity is disabled', async () => {
    const auditFacts: LocalIamAuditFact[] = []
    const iam = createLocalIamService({
      now: () => new Date(initialNow),
      initialPrincipals: [
        {
          contractVersion: 'oidc-iam-principal@0.1.0',
          principalId: 'principal-production-operator',
          oidcIssuer: 'https://keycloak.test/realms/meristem',
          oidcSubject: 'production-operator',
          status: 'approved',
          roles: ['operator'],
          display: { name: 'Production Operator' },
          createdAt: initialNow,
          updatedAt: initialNow,
          approvedAt: initialNow,
          approvedBy: 'security-admin'
        }
      ],
      policy: {
        async authorize() {
          return ok(undefined)
        }
      },
      audit: {
        async write(fact) {
          auditFacts.push(fact)
          return ok(undefined)
        }
      }
    })
    const issued = await iam.issueSession({
      principalId: 'principal-production-operator',
      correlationId: 'corr-disabled-identity-issued'
    })
    if (!issued.ok) throw new Error('expected initial session')

    const disabled = await iam.disable({
      principalId: 'principal-production-operator',
      actorPrincipalId: 'principal-security-admin',
      actorRoles: ['security-admin'],
      reason: 'production security investigation',
      correlationId: 'corr-disabled-identity-disable'
    })
    expect(disabled.ok).toBe(true)

    expect(
      await iam.getSession({
        sessionId: issued.value.session.sessionId,
        correlationId: 'corr-disabled-identity-read'
      })
    ).toMatchObject({ ok: false, error: { code: 'session_revoked' } })
    expect(
      await iam.issueSession({
        principalId: 'principal-production-operator',
        correlationId: 'corr-disabled-identity-reissue'
      })
    ).toMatchObject({ ok: false, error: { code: 'principal_disabled' } })
    expect(auditFacts.map(fact => fact.action)).toEqual(
      expect.arrayContaining(['principal.disabled', 'session.revoked'])
    )
  })

  it('denies an unauthorized SecretRef read without issuing a secret write request', async () => {
    const methods: string[] = []
    const vault = createVaultKvV2SecretProvider(
      'vault-prod',
      {
        backend: 'vault-kv-v2',
        address: 'https://vault.test',
        mountPath: 'meristem',
        authMethodRef: 'vault-auth/production'
      },
      {
        resolveAuthHeaders: async () => ok({}),
        fetchImpl: async (_input, init) => {
          methods.push(init?.method ?? 'GET')
          return new Response('denied', { status: 403 })
        }
      }
    )
    const result = await createSecretManager({ providers: [vault] }).read({
      provider: 'vault-prod',
      keyPath: 'deploy/registry-token',
      version: 1
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'permission_denied', ref: { keyPath: 'deploy/registry-token' } }
    })
    expect(methods).toEqual(['GET'])
    expect(JSON.stringify(result)).not.toContain('registry-token-value')
  })

  it('rejects unsigned desired-state before SecretProvider or runtime work begins', async () => {
    await withMDeployInternalToken('production-security-unsigned-token', async () => {
      const deps = createInMemoryMDeployDeps({
        gitEnvelopeOverride: { schemaVersion: 'mdeploy.desired-state@0.1.0' },
        existingPolicyApprovers: ['security-admin-2']
      })
      const app = createMDeployApp(deps)

      await enrollMDeployAgent(app, 'production-security-unsigned-token', 'agent-unsigned')
      await createApprovedMDeployProposal(app, 'agent-unsigned')

      expect(deps.__testing.secretResolutionCount()).toBe(0)
      expect(deps.__testing.runtimeApplyCount()).toBe(0)
      expect(deps.__testing.evidenceTypes()).toEqual([])
    })
  })

  it('auto-revokes an expired break-glass grant, records expiry Audit evidence, and denies approval', async () => {
    const fixture = createMNetFixture()
    const initiated = await fixture.service.initiateBreakGlass({
      actor: 'security-admin',
      networkId,
      reason: 'contain production incident'
    })
    if (!('kind' in initiated) || initiated.kind !== 'mutation')
      throw new Error('expected break-glass grant')

    fixture.setNow(initiated.value.expiresAt)
    const approval = await fixture.service.approveBreakGlass({
      actor: 'break-glass-reviewer',
      grantId: initiated.value.grantId
    })

    expect(approval).toMatchObject({
      kind: 'mutation',
      value: { state: 'auto_revoked', autoRevokedAt: initiated.value.expiresAt }
    })
    expect(await fixture.store.breakGlass.get(initiated.value.grantId)).toMatchObject({
      state: 'auto_revoked',
      autoRevokedAt: initiated.value.expiresAt,
      evidence: { audit: { result: 'auto-revoked' } }
    })
    expect(await fixture.service.isBreakGlassActive(initiated.value.grantId)).toBe(false)
  })

  it('keeps break-glass inactive and free of an approver until a distinct second approval exists', async () => {
    const fixture = createMNetFixture()
    const initiated = await fixture.service.initiateBreakGlass({
      actor: 'security-admin',
      networkId,
      reason: 'contain production incident'
    })
    if (!('kind' in initiated) || initiated.kind !== 'mutation')
      throw new Error('expected break-glass grant')

    expect(await fixture.service.isBreakGlassActive(initiated.value.grantId)).toBe(false)
    const stored = await fixture.store.breakGlass.get(initiated.value.grantId)
    if (!stored) throw new Error('expected pending break-glass grant')
    expect(stored).toMatchObject({ state: 'second_approval_pending' })
    expect(stored).not.toHaveProperty('secondApprover')
    expect(fixture.calls).not.toContain('mutation:break-glass-activated')
  })

  it('returns a 403 from the Dashboard-facing audit projection boundary without leaking entries', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'viewer' }))
    const response = await app.handle(
      new Request('http://localhost/api/v0/audit/search?q=production', {
        headers: { authorization: 'Bearer viewer-token' }
      })
    )

    expect(response.status).toBe(403)
    const body = await response.text()
    expect(body).toContain('policy.denied')
    expect(body).not.toContain('entries')
    expect(body).not.toContain('secret')
  })

  it('keeps authoritative control and Audit reads available while OpenSearch search returns a typed outage', async () => {
    const app = createCoreApp(
      createInMemoryCoreDeps({ actor: 'security-admin', searchAvailable: false })
    )
    const nodeName = 'node-with-opensearch-unavailable'
    const created = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        method: 'POST',
        headers: { authorization: 'Bearer operator-token', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'leaf', name: nodeName })
      })
    )

    expect(created.status).toBe(200)
    const nodes = await app.handle(
      new Request('http://localhost/api/v0/nodes', {
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    expect(nodes.status).toBe(200)
    expect(await nodes.text()).toContain(nodeName)
    const audit = await app.handle(
      new Request('http://localhost/api/v0/audit', {
        headers: { authorization: 'Bearer security-admin-token' }
      })
    )
    expect(audit.status).toBe(200)
    const search = await app.handle(
      new Request('http://localhost/api/v0/logs/timeline/search?q=production', {
        headers: { authorization: 'Bearer operator-token' }
      })
    )
    expect(search.status).toBe(503)
  })

  it('fails Vault-sealed secret reads closed without falling back to a local plaintext provider', async () => {
    const fallbackSecret = 'fallback-secret-must-not-be-used'
    const methods: string[] = []
    const vault = createVaultKvV2SecretProvider(
      'vault-prod',
      {
        backend: 'vault-kv-v2',
        address: 'https://vault.test',
        mountPath: 'meristem',
        authMethodRef: 'vault-auth/production'
      },
      {
        resolveAuthHeaders: async () => ok({}),
        fetchImpl: async (_input, init) => {
          methods.push(init?.method ?? 'GET')
          return new Response('sealed', { status: 503 })
        }
      }
    )
    const localFallback = createLocalDevEnvSecretProvider(
      'local-fallback',
      { backend: 'local-dev-env', envMappings: { 'deploy/registry-token': 'FALLBACK_SECRET' } },
      { FALLBACK_SECRET: fallbackSecret }
    )
    const result = await createSecretManager({ providers: [vault, localFallback] }).read({
      provider: 'vault-prod',
      keyPath: 'deploy/registry-token'
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'provider_unavailable' } })
    expect(methods).toEqual(['GET'])
    expect(JSON.stringify(result)).not.toContain(fallbackSecret)
  })

  it('reports an M-Net sidecar and its tunnel unhealthy with a visible degraded reason and no route mutation', async () => {
    const secretManager = createSecretManager({
      providers: [
        createLocalDevEnvSecretProvider(
          'runtime',
          {
            backend: 'local-dev-env',
            envMappings: {
              'netbird/signal/production': 'NETBIRD_SIGNAL',
              'netbird/relay/production': 'NETBIRD_RELAY',
              'netbird/stun/production': 'NETBIRD_STUN',
              'netbird/sidecar/production': 'NETBIRD_SIDECAR'
            }
          },
          { NETBIRD_SIGNAL: 'signal', NETBIRD_RELAY: 'relay', NETBIRD_STUN: 'stun' }
        )
      ]
    })
    const writes: string[] = []
    const sidecar = await applySidecarDesiredState(
      {
        nodeId,
        correlationId: 'corr-sidecar-degraded',
        observedAt: initialNow,
        desired: desiredSidecar,
        runtimeMap: { networkId, mapVersion: 1 }
      },
      {
        deploymentConfig: sidecarDeploymentConfig,
        secretManager,
        async mkdir() {},
        async writeTextFile(_path, contents) {
          writes.push(contents)
        }
      }
    )
    expect(sidecar.runtimeStatus).toMatchObject({
      kind: 'degraded',
      degradedReasons: [{ code: 'secret.missing', detail: 'secret_missing' }]
    })
    expect(sidecar.process.processRef).toBeUndefined()
    expect(writes).toEqual([])

    const fixture = createMNetFixture()
    const sidecarFact = await fixture.service.recordSidecarStatus({
      networkId,
      status: {
        nodeId,
        desiredState: 'start',
        healthStatus: 'unhealthy',
        degradedReason: 'secret.missing',
        proofPath: 'runtime-probe',
        uiFacingFact: true,
        healthy: false,
        checkedAt: initialNow
      }
    })
    const tunnelFact = await fixture.service.recordTunnelHealth({
      networkId,
      health: {
        nodeId,
        peerNodeId: 'production-security-peer',
        status: 'down',
        mode: 'none',
        relayStatus: 'unavailable',
        checkedAt: initialNow,
        stateSource: 'node-runtime-report'
      }
    })

    expect(sidecarFact).toMatchObject({
      kind: 'mutation',
      value: { healthy: false, degradedReason: 'secret.missing' }
    })
    expect(tunnelFact).toMatchObject({ kind: 'mutation', value: { status: 'down' } })
    expect(await fixture.store.sidecars.listByNetwork(networkId)).toMatchObject([
      { nodeId, healthy: false, degradedReason: 'secret.missing' }
    ])
    expect(await fixture.store.tunnels.listByNetwork(networkId)).toMatchObject([{ status: 'down' }])
    expect(await fixture.store.relayPolicies.get(networkId)).toBeNull()
  })
})
