import { createHash, generateKeyPairSync, type KeyObject, sign, verify } from 'node:crypto'
import { err, ok } from '../../../packages/common/src/result.ts'
import {
  type ActorId,
  actorIds,
  type MDeployApprovalStatusFromSchema,
  type MDeployApprovalV01FromSchema,
  type MDeployControllerTrustMaterialV01FromSchema,
  type MDeployDesiredStateDocumentV01FromSchema,
  type MDeployDigestFromSchema,
  type MDeployGitSourceRefV01FromSchema,
  type MDeployDriftReportV01FromSchema,
  type MDeployEvidenceMetadataV01FromSchema,
  type MDeployProposalV01FromSchema,
  type MDeploySignedEnvelopeV01FromSchema,
  type MDeployStorageRefV01FromSchema,
  mDeployApproverActorIds,
  type PolicyResult
} from '../../../packages/contracts/src/index.ts'
import { decidePermission, rolePermissions } from '../../../packages/policy/src/index.ts'
import type {
  MDeployAgentRecord,
  MDeployDeps,
  MDeployEventIntent,
  MDeployOperation,
  MDeployOperationStatus
} from './deps.ts'
import { mDeployEnvelopeVerificationBytes } from './envelope-verification.ts'

export type InMemoryMDeployOptions = {
  controllerAvailable?: boolean
  forcePolicyResult?: Exclude<PolicyResult, 'allow'>
  auditAvailable?: boolean
  gitAvailable?: boolean
  secretAvailable?: boolean
  runtimeAvailable?: boolean
  now?: string
  agentEnvelopeOverride?: unknown
  gitEnvelopeOverride?: unknown
  /**
   * local-dev 专用：为任意被提案 pin 的 Git source 生成签名 envelope。
   *
   * 默认 fixture 只服务单一固定 digest，用于服务测试的确定性；本地控制面需要
   * 对操作者真实提交的 sourceRef 作出响应，因此显式开启该行为而不是放宽默认值。
   */
  gitEnvelopeFromRequestedSource?: boolean
  /**
   * local-dev 专用：覆盖 controller trust 的到期时间。
   *
   * 默认值绑定服务测试使用的固定时钟；长期运行的本地控制面必须提供一个相对当前
   * 时间有效的到期时间，否则 apply 会以 signature_verification_failed 结束。
   */
  controllerTrustExpiresAt?: string
  existingPolicyApprovers?: readonly ActorId[]
  initialAgents?: readonly MDeployAgentRecord[]
}

/**
 * Lazily-generated Ed25519 key pair used as test-only signing material.
 *
 * Fresh key material is produced at runtime so no literal private key ever
 * appears in production source text. The pair is cached for the process
 * lifetime so that signing and verification within the same test use a
 * consistent key.
 */
let _testKeyPair: { privateKey: KeyObject; publicKey: KeyObject } | undefined

function runtimeTestKeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  if (_testKeyPair) return _testKeyPair
  const kp = generateKeyPairSync('ed25519')
  _testKeyPair = { privateKey: kp.privateKey, publicKey: kp.publicKey }
  return _testKeyPair
}

function digestKey(digest: MDeployDigestFromSchema): string {
  return `${digest.algorithm}:${digest.value}`
}

function actorFromBearer(token: string): ActorId | null {
  if (!token.startsWith('Bearer ')) return null
  const candidate = token.slice('Bearer '.length)
  return actorIds.find(actor => actor === candidate) ?? null
}

function controllerFingerprint(publicKey: KeyObject): string {
  return createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64url')
}

/**
 * Returns the base64url SHA-256 fingerprint of the runtime-generated test
 * controller public key.  Test files that enrol agents against the in-memory
 * fixture must use this value (not a hardcoded string) so the enrolled
 * fingerprint always matches the runtime key material.
 */
export function runtimeTestControllerFingerprint(): string {
  return controllerFingerprint(runtimeTestKeyPair().publicKey)
}

function fixtureEnvelope(
  now: string,
  privateKey: KeyObject,
  controllerTrust: MDeployControllerTrustMaterialV01FromSchema,
  source?: MDeployGitSourceRefV01FromSchema
): MDeploySignedEnvelopeV01FromSchema {
  const digest: MDeployDigestFromSchema = source?.digest ?? {
    algorithm: 'sha256',
    value: 'sha256:desired-state-001'
  }
  const desiredState: MDeployDesiredStateDocumentV01FromSchema = {
    schemaVersion: 'mdeploy.desired-state@0.1.0',
    source: source ?? {
      repositoryUrl: 'https://git.example/meristem/desired-state.git',
      branch: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'deploy/prod',
      digest,
      syncedAt: now
    },
    runtime: { driver: 'podman', iacDriver: 'opentofu', targetScope: ['production'] },
    topology: {
      topologyId: 'production-vm-topology',
      revision: 'topology-1',
      nodes: [{ nodeId: 'node-1', hostId: 'host-1', role: 'worker', runtimeDriver: 'podman' }]
    },
    services: [
      {
        serviceId: 'm-ui',
        image: { image: 'registry.example/meristem/m-ui', digest },
        config: {
          OIDC_CLIENT_SECRET: {
            kind: 'secretRef',
            secretRef: { provider: 'vault-kv-v2', keyPath: 'secret/data/mdeploy/oidc', version: 1 }
          }
        },
        secretRefs: [{ provider: 'vault-kv-v2', keyPath: 'secret/data/mdeploy/oidc', version: 1 }]
      }
    ],
    generatedAt: now
  }
  const unsigned: MDeploySignedEnvelopeV01FromSchema = {
    schemaVersion: 'mdeploy.signed-envelope@0.1.0',
    payload: desiredState,
    signature: { algorithm: 'ed25519', value: 'pending-signature', payloadDigest: digest },
    signer: { kind: 'mdeploy-controller', identity: 'm-deploy-controller' },
    issuedAt: now,
    expiresAt: new Date(Date.parse(now) + 15 * 60 * 1000).toISOString(),
    verification: { verified: true, verifiedAt: now, verifier: 'm-deploy-controller' }
  }
  return {
    ...unsigned,
    signature: {
      ...unsigned.signature,
      value: sign(
        null,
        mDeployEnvelopeVerificationBytes(unsigned, controllerTrust),
        privateKey
      ).toString('base64url')
    }
  }
}

/** 内存端口提供直接 service tests，不模拟 SSH、Git push 或任何 plaintext secret 返回。 */
export function createInMemoryMDeployDeps(options: InMemoryMDeployOptions = {}): MDeployDeps & {
  __testing: {
    auditActions(): readonly string[]
    evidenceTypes(): readonly string[]
    runtimeApplyCount(): number
    secretResolutionCount(): number
    operationStatuses(): readonly MDeployOperationStatus[]
    controllerTrust(): MDeployControllerTrustMaterialV01FromSchema
    recordPolicyApproval(proposalId: string, actor: ActorId): void
    setControllerAvailable(available: boolean): void
  }
} {
  const now = options.now ?? '2026-07-13T00:05:00.000Z'
  const controllerTrust: MDeployControllerTrustMaterialV01FromSchema = {
    issuer: 'm-deploy-controller',
    audience: 'mdeploy-agent',
    publicKeyFingerprint: controllerFingerprint(runtimeTestKeyPair().publicKey),
    expiresAt: options.controllerTrustExpiresAt ?? '2026-07-14T00:00:00.000Z'
  }
  const envelope = fixtureEnvelope(now, runtimeTestKeyPair().privateKey, controllerTrust)
  const proposals = new Map<string, MDeployProposalV01FromSchema>()
  const approvals = new Map<string, MDeployApprovalV01FromSchema>()
  const policyApprovers = new Map<string, Set<ActorId>>()
  const operations = new Map<string, MDeployOperation>()
  const agents = new Map<string, MDeployAgentRecord>()
  const drift = new Map<string, MDeployDriftReportV01FromSchema>()
  const evidence = new Map<string, MDeployEvidenceMetadataV01FromSchema>()
  const eventIntents = new Map<string, MDeployEventIntent>()
  const verifiedEnvelopes = new Map<string, MDeploySignedEnvelopeV01FromSchema>()
  const lastSuccessful = new Map<string, MDeploySignedEnvelopeV01FromSchema>()
  const auditActions: string[] = []
  const evidenceTypes: string[] = []
  const statuses: MDeployOperationStatus[] = []
  let runtimeApplyCount = 0
  let secretResolutionCount = 0
  let controllerAvailable = options.controllerAvailable !== false

  for (const agent of options.initialAgents ?? []) agents.set(agent.enrollment.agentId, agent)

  const storage = {
    async createProposal(proposal: MDeployProposalV01FromSchema) {
      proposals.set(proposal.proposalId, proposal)
      return ok(proposal)
    },
    async getProposal(id: string) {
      return ok(proposals.get(id) ?? null)
    },
    async updateProposalStatus(id: string, approvalStatus: MDeployApprovalStatusFromSchema) {
      const existing = proposals.get(id)
      if (!existing) return ok(null)
      const updated = { ...existing, approvalStatus }
      proposals.set(id, updated)
      return ok(updated)
    },
    async createApproval(approval: MDeployApprovalV01FromSchema) {
      approvals.set(approval.approvalId, approval)
      return ok(approval)
    },
    async createOperation(operation: MDeployOperation) {
      operations.set(operation.operationId, operation)
      return ok(operation)
    },
    async admitOperation(input: {
      operation: MDeployOperation
      evidence: readonly MDeployEvidenceMetadataV01FromSchema[]
      eventIntents: readonly MDeployEventIntent[]
    }) {
      operations.set(input.operation.operationId, input.operation)
      for (const metadata of input.evidence) {
        evidence.set(`${metadata.operationId}:${metadata.evidenceType}`, metadata)
      }
      for (const intent of input.eventIntents) eventIntents.set(intent.intentId, intent)
      return ok(input.operation)
    },
    async getOperation(operationId: string) {
      return ok(operations.get(operationId) ?? null)
    },
    async nextQueuedOperation(agentId: string) {
      const queued = [...operations.values()].find(
        operation => operation.agentId === agentId && operation.status === 'queued'
      )
      return ok(
        queued
          ? {
              ...queued,
              ...(options.agentEnvelopeOverride === undefined
                ? {}
                : { envelope: options.agentEnvelopeOverride })
            }
          : null
      )
    },
    async transitionOperation(
      operationId: string,
      status: MDeployOperationStatus,
      completedAt?: string
    ) {
      const existing = operations.get(operationId)
      if (!existing) return ok(null)
      const updated = { ...existing, status, ...(completedAt ? { completedAt } : {}) }
      operations.set(operationId, updated)
      statuses.push(status)
      return ok(updated)
    },
    async completeOperation(input: {
      operationId: string
      completedAt: string
      evidence: readonly MDeployEvidenceMetadataV01FromSchema[]
      eventIntents: readonly MDeployEventIntent[]
      lastSuccessfulEnvelope: MDeploySignedEnvelopeV01FromSchema
    }) {
      const existing = operations.get(input.operationId)
      if (!existing) return ok(null)
      const updated: MDeployOperation = {
        ...existing,
        status: 'succeeded',
        publicationStatus: 'pending',
        completedAt: input.completedAt
      }
      operations.set(input.operationId, updated)
      statuses.push('succeeded')
      for (const metadata of input.evidence) {
        evidence.set(`${metadata.operationId}:${metadata.evidenceType}`, metadata)
      }
      for (const intent of input.eventIntents) eventIntents.set(intent.intentId, intent)
      lastSuccessful.set(existing.agentId, input.lastSuccessfulEnvelope)
      verifiedEnvelopes.set(
        digestKey(input.lastSuccessfulEnvelope.payload.source.digest),
        input.lastSuccessfulEnvelope
      )
      return ok(updated)
    },
    async listPendingEventIntents(operationId?: string) {
      return ok(
        [...eventIntents.values()].filter(
          intent =>
            intent.status === 'pending' &&
            (operationId === undefined || intent.operationId === operationId)
        )
      )
    },
    async markEventIntentPublished(intentId: string, publishedAt: string) {
      const existing = eventIntents.get(intentId)
      if (!existing) return ok(null)
      const updated: MDeployEventIntent = { ...existing, status: 'published', publishedAt }
      eventIntents.set(intentId, updated)
      const operation = operations.get(existing.operationId)
      if (operation) {
        const hasPending = [...eventIntents.values()].some(
          intent => intent.operationId === operation.operationId && intent.status === 'pending'
        )
        operations.set(operation.operationId, {
          ...operation,
          publicationStatus: hasPending ? 'pending' : 'published'
        })
      }
      return ok(updated)
    },
    async recordEventIntentFailure(intentId: string, errorCode: string) {
      const existing = eventIntents.get(intentId)
      if (!existing) return ok(null)
      const updated: MDeployEventIntent = { ...existing, status: 'pending', lastError: errorCode }
      eventIntents.set(intentId, updated)
      return ok(updated)
    },
    async upsertAgent(agent: MDeployAgentRecord) {
      agents.set(agent.enrollment.agentId, agent)
      return ok(agent)
    },
    async getAgent(agentId: string) {
      return ok(agents.get(agentId) ?? null)
    },
    async listAgents() {
      return ok([...agents.values()])
    },
    async recordDrift(report: MDeployDriftReportV01FromSchema) {
      drift.set(report.reportId, report)
      return ok(report)
    },
    async listDrift() {
      return ok([...drift.values()])
    },
    async addEvidence(metadata: MDeployEvidenceMetadataV01FromSchema) {
      evidence.set(`${metadata.operationId}:${metadata.evidenceType}`, metadata)
      return ok(metadata)
    },
    async listEvidence() {
      return ok([...evidence.values()])
    },
    async setLastSuccessful(agentId: string, signedEnvelope: MDeploySignedEnvelopeV01FromSchema) {
      lastSuccessful.set(agentId, signedEnvelope)
      verifiedEnvelopes.set(digestKey(signedEnvelope.payload.source.digest), signedEnvelope)
      return ok(undefined)
    },
    async getLastSuccessful(agentId: string) {
      return ok(lastSuccessful.get(agentId) ?? null)
    },
    async desiredStateSummary(controllerAvailable: boolean) {
      const latest = [...operations.values()].at(-1)
      const successful = [...lastSuccessful.values()].at(-1)
      return ok({
        ...(latest ? { latestDigest: latest.desiredStateDigest } : {}),
        ...(successful ? { lastSuccessfulDigest: successful.payload.source.digest } : {}),
        stale: !controllerAvailable,
        controllerAvailable
      })
    },
    async findVerifiedEnvelope(digest: MDeployDigestFromSchema) {
      return ok(verifiedEnvelopes.get(digestKey(digest)) ?? null)
    }
  }

  return {
    auth: {
      async verify(bearerToken) {
        const actor = actorFromBearer(bearerToken)
        return actor
          ? ok({ actor })
          : err({ code: 'auth.unauthorized', message: 'invalid bearer token' })
      }
    },
    policy: {
      async authorize(input) {
        const draft = decidePermission({
          actor: input.actor,
          action: input.action,
          resource: input.resource,
          permissions: rolePermissions[input.actor]
        })
        return ok({
          decisionId: crypto.randomUUID(),
          result: options.forcePolicyResult ?? draft.result
        })
      },
      async recordApproval(input) {
        if (input.actor === input.proposal.actor) {
          return err({
            code: 'policy.self_approval_denied',
            message: 'proposer cannot approve this proposal'
          })
        }
        const approval: MDeployApprovalV01FromSchema = {
          schemaVersion: 'mdeploy.approval@0.1.0',
          approvalId: crypto.randomUUID(),
          proposalId: input.proposal.proposalId,
          approver: input.actor,
          timestamp: now,
          result: input.result,
          policyDecisionId: crypto.randomUUID(),
          correlationId: input.correlationId
        }
        const proposalApprovers =
          policyApprovers.get(input.proposal.proposalId) ?? new Set<ActorId>()
        if (input.result === 'approve') proposalApprovers.add(input.actor)
        policyApprovers.set(input.proposal.proposalId, proposalApprovers)
        const distinctEligible = new Set(
          [...proposalApprovers, ...(options.existingPolicyApprovers ?? [])].filter(isSecurityAdmin)
        )
        return ok({
          approval,
          proposalStatus:
            input.result === 'reject'
              ? 'rejected'
              : distinctEligible.size === 2
                ? 'approved'
                : 'pending'
        })
      },
      async proveProductionApplyQuorum(input) {
        const approvers = [
          ...(policyApprovers.get(input.proposal.proposalId) ?? []),
          ...(options.existingPolicyApprovers ?? [])
        ].filter(approver => approver !== input.proposal.actor && isSecurityAdmin(approver))
        const distinct = [...new Set(approvers)]
        if (distinct.length !== 2 || distinct[0] === undefined || distinct[1] === undefined) {
          return err({
            code: 'policy.quorum_not_satisfied',
            message: 'production apply requires exactly two distinct eligible approvers'
          })
        }
        return ok({
          proofId: `quorum-${input.proposal.proposalId}`,
          proposalId: input.proposal.proposalId,
          approvers: [distinct[0], distinct[1]],
          issuedAt: now
        })
      }
    },
    log: {
      async writeAudit(input) {
        if (options.auditAvailable === false) {
          return err({ code: 'audit.unavailable', message: 'audit writer unavailable' })
        }
        auditActions.push(input.action)
        return ok({ auditId: `audit-${auditActions.length}` })
      },
      async writeTimeline() {
        return ok(undefined)
      },
      async writeFull() {
        return ok(undefined)
      },
      async writeEvidence(input) {
        if (options.auditAvailable === false) {
          return err({ code: 'evidence.unavailable', message: 'evidence writer unavailable' })
        }
        evidenceTypes.push(input.evidenceType)
        const storageRef: MDeployStorageRefV01FromSchema = {
          uri: `memory://mdeploy/${input.operationId}/${input.evidenceType}`,
          digest: input.digest,
          redactionStatus: 'redacted'
        }
        return ok(storageRef)
      }
    },
    events: {
      async publish() {
        return ok(undefined)
      }
    },
    git: {
      async fetchSignedEnvelope(source) {
        if (options.gitAvailable === false) {
          return err({ code: 'git.unavailable', message: 'git source unavailable' })
        }
        if (source.digest.value === envelope.payload.source.digest.value) {
          return ok(
            options.gitEnvelopeOverride === undefined ? envelope : options.gitEnvelopeOverride
          )
        }
        // local-dev 控制面按操作者实际 pin 的 sourceRef 签发 envelope；默认 fixture 仍严格匹配单一 digest。
        if (options.gitEnvelopeFromRequestedSource === true) {
          return ok(fixtureEnvelope(now, runtimeTestKeyPair().privateKey, controllerTrust, source))
        }
        return err({
          code: 'git.digest_not_found',
          message: 'requested digest not found in git source'
        })
      }
    },
    agentIdentity: {
      async verifyEnrollment() {
        return ok(undefined)
      }
    },
    envelopeVerifier: {
      async verify(input) {
        const trustMatches =
          input.controllerTrust.issuer === controllerTrust.issuer &&
          input.controllerTrust.audience === controllerTrust.audience &&
          input.controllerTrust.publicKeyFingerprint === controllerTrust.publicKeyFingerprint &&
          Date.parse(input.controllerTrust.expiresAt) > Date.parse(now) &&
          input.signer.kind === 'mdeploy-controller' &&
          input.signer.identity === controllerTrust.issuer &&
          input.signature.algorithm === 'ed25519'
        if (!trustMatches) {
          return err({
            code: 'signature_verification_failed',
            message: 'desired-state signer is not bound to enrolled controller trust'
          })
        }
        let signature: Buffer
        try {
          signature = Buffer.from(input.signature.value, 'base64url')
        } catch {
          return err({
            code: 'signature_verification_failed',
            message: 'desired-state signature encoding is invalid'
          })
        }
        return verify(null, input.signedBytes, runtimeTestKeyPair().publicKey, signature)
          ? ok(undefined)
          : err({
              code: 'signature_verification_failed',
              message: 'desired-state envelope signature verification failed'
            })
      }
    },
    secretProvider: {
      async resolve() {
        if (options.secretAvailable === false) {
          return err({ code: 'provider_unavailable', message: 'secret provider unavailable' })
        }
        secretResolutionCount++
        return ok({ redactedRef: 'vault-kv-v2:ref', version: 1, auditId: 'secret-audit-1' })
      }
    },
    runtime: {
      async apply() {
        if (options.runtimeAvailable === false) {
          return err({ code: 'runtime.unavailable', message: 'local runtime unavailable' })
        }
        runtimeApplyCount++
        return ok(undefined)
      },
      async rollback() {
        if (options.runtimeAvailable === false) {
          return err({ code: 'runtime.unavailable', message: 'local runtime unavailable' })
        }
        runtimeApplyCount++
        return ok(undefined)
      }
    },
    controller: {
      async isAvailable() {
        return controllerAvailable
      }
    },
    store: storage,
    now: () => now,
    snapshotTtlMs: 15 * 60 * 1000,
    __testing: {
      auditActions: () => [...auditActions],
      evidenceTypes: () => [...evidenceTypes],
      runtimeApplyCount: () => runtimeApplyCount,
      secretResolutionCount: () => secretResolutionCount,
      operationStatuses: () => [...statuses],
      controllerTrust: () => ({ ...controllerTrust }),
      recordPolicyApproval: (proposalId, actor) => {
        const approvers = policyApprovers.get(proposalId) ?? new Set<ActorId>()
        approvers.add(actor)
        policyApprovers.set(proposalId, approvers)
        const distinctEligible = [...approvers].filter(isSecurityAdmin)
        const proposal = proposals.get(proposalId)
        if (proposal && new Set(distinctEligible).size === 2) {
          proposals.set(proposalId, { ...proposal, approvalStatus: 'approved' })
        }
      },
      setControllerAvailable: available => {
        controllerAvailable = available
      }
    }
  }
}

function isSecurityAdmin(actor: ActorId): boolean {
  return mDeployApproverActorIds.includes(actor)
}
