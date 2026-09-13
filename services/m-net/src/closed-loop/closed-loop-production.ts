import { eq } from 'drizzle-orm'
import type { RuntimeDeploymentConfig } from '../../../../packages/config/src/index.ts'
import type {
  NodeAgentRuntimeStatus,
  RedactedSecretRefFromSchema,
  SecretRefFromSchema
} from '../../../../packages/contracts/src/index.ts'
import { networkMemberships } from '../../../../packages/db/src/schema.ts'
import { createSecretProviderFromConfig } from '../../../../packages/secrets/src/index.ts'
import type { MNetInfrastructure } from '../clients.ts'
import type { MigrationEngine } from '../migration/migration-engine-contract.ts'
import { projectNodeAgentSidecarStatus } from './closed-loop-sidecar-projection.ts'
import { createInMemoryMNetClosedLoopStore } from './closed-loop-store-memory.ts'
import { createPgMNetClosedLoopStore } from './closed-loop-store-pg.ts'
import { createMNetClosedLoopService } from './closed-loop-workflow.ts'
import type { MNetClosedLoopDeps } from './closed-loop-workflow-types.ts'

function secretRef(provider: string, credentialId: string): SecretRefFromSchema {
  return { provider, keyPath: `mnet/credentials/${credentialId}` }
}

function redact(ref: SecretRefFromSchema): RedactedSecretRefFromSchema {
  return {
    provider: ref.provider,
    keyPath: ref.keyPath,
    ...(ref.version === undefined ? {} : { version: ref.version })
  }
}

function providerFailure(error: { code: string; message: string }) {
  return { ok: false as const, code: `secret.${error.code}`, message: error.message }
}

function auditWireResult(result: string): string {
  switch (result) {
    case 'allowed':
      return 'allow'
    case 'denied':
      return 'deny'
    case 'rolled-back':
      return 'success'
    case 'auto-revoked':
    case 'expired':
      return 'canceled'
    default:
      return 'failure'
  }
}

export type ClosedLoopProduction = {
  service: ReturnType<typeof createMNetClosedLoopService>
  ingestNodeRuntimeStatus(input: {
    nodeId: string
    runtimeStatus: NodeAgentRuntimeStatus
  }): Promise<void>
  enforceExpiry(): Promise<number>
  recoverCredentialOperations(): ReturnType<
    ReturnType<typeof createMNetClosedLoopService>['recoverPendingCredentialOperations']
  >
  flushPendingEvents(): ReturnType<
    ReturnType<typeof createMNetClosedLoopService>['dispatchPendingEvents']
  >
}

/**
 * 生产组合只接线既有 M-Policy/M-Log/M-EventBus/SecretProvider/迁移引擎端口；
 * DATABASE_URL 存在时 closed-loop facts 始终使用 PostgreSQL 权威存储。
 */
export function createClosedLoopProduction(input: {
  infrastructure: MNetInfrastructure
  runtimeConfig: RuntimeDeploymentConfig
  network: MNetClosedLoopDeps['network']
  migrationEngine: MigrationEngine
}): ClosedLoopProduction {
  const { infrastructure, runtimeConfig, network, migrationEngine } = input
  const configuredProvider = runtimeConfig.secretProvider.namedProvider
  const providerName = runtimeConfig.secretProvider.providerName
  const provider = createSecretProviderFromConfig(providerName, configuredProvider.config)
  const store = infrastructure.requireDatabase
    ? createPgMNetClosedLoopStore(infrastructure.db)
    : createInMemoryMNetClosedLoopStore()

  async function writeCredential(credentialId: string, value: string) {
    const ref = secretRef(providerName, credentialId)
    const written = await provider.write(ref, value)
    return written.ok
      ? ({ ok: true, credentialRef: redact(ref) } as const)
      : providerFailure(written.error)
  }

  const service = createMNetClosedLoopService({
    store,
    dataPlane: infrastructure.dataPlaneStores,
    policy: infrastructure.policyAuthorize,
    log: {
      async writeAudit(actor, action, resource, result, correlationId, payload) {
        await infrastructure.profileLog.writeAudit(
          actor,
          action,
          resource,
          auditWireResult(result),
          correlationId,
          payload
        )
      },
      async writeTimeline(summary, subject, correlationId) {
        await infrastructure.profileLog.writeTimeline(summary, subject, correlationId)
      },
      async writeFull(level, message, correlationId, payload) {
        await infrastructure.profileLog.writeFull(level, message, correlationId, payload)
      }
    },
    events: infrastructure.profileEvents,
    credentials: {
      async issue(credential) {
        return writeCredential(credential.credentialId, credential.value)
      },
      async rotate(credential) {
        return writeCredential(credential.credentialId, credential.value)
      },
      async revoke(credential) {
        const ref: SecretRefFromSchema = { ...credential.credentialRef }
        const overwritten = await provider.write(
          ref,
          `revoked-${credential.credentialId}-${crypto.randomUUID()}`
        )
        return overwritten.ok ? { ok: true as const } : providerFailure(overwritten.error)
      }
    },
    network,
    migration: {
      async apply(migration) {
        const result = await migrationEngine.migrateNetwork({
          networkId: migration.networkId,
          actor: migration.actor,
          reason: migration.reason,
          operationId: migration.migrationId,
          targetProfileVersion: migration.targetProfileVersion
        })
        if (!result.ok) return { ok: false as const, message: result.error }
        return result.value.result.status === 'failed' || result.value.result.status === 'skipped'
          ? {
              ok: false as const,
              message: result.value.result.reason ?? result.value.result.status
            }
          : { ok: true as const, appliedNetworkIds: [migration.networkId] }
      },
      async rollback(migration) {
        const result = await migrationEngine.rollbackSingleNetwork({
          operationId: migration.migrationId,
          networkId: migration.networkId,
          actor: migration.actor,
          reason: migration.reason,
          sourceProfileVersion: migration.sourceProfileVersion,
          targetProfileVersion: migration.targetProfileVersion
        })
        if (!result.ok) return { ok: false as const, message: result.error }
        return result.value.result.status === 'rolled_back'
          ? { ok: true as const, appliedNetworkIds: [migration.networkId] }
          : {
              ok: false as const,
              message: result.value.result.reason ?? result.value.result.status
            }
      }
    }
  })

  async function ingestNodeRuntimeStatus(input: {
    nodeId: string
    runtimeStatus: NodeAgentRuntimeStatus
  }): Promise<void> {
    const memberships = await infrastructure.db
      .select({ networkId: networkMemberships.networkId })
      .from(networkMemberships)
      .where(eq(networkMemberships.nodeId, input.nodeId))
    const sidecar = projectNodeAgentSidecarStatus(input.nodeId, input.runtimeStatus, {
      proofPath: 'runtime-probe'
    })
    const results = await Promise.all(
      memberships.map(membership =>
        service.recordSidecarStatus({ networkId: membership.networkId, status: sidecar })
      )
    )
    const failed = results.find(result => result.kind === 'failure')
    if (failed?.kind === 'failure') {
      throw Object.assign(new Error(failed.error.message), { code: failed.error.code })
    }
  }

  return {
    service,
    ingestNodeRuntimeStatus,
    enforceExpiry: service.enforceExpiredBreakGlass,
    recoverCredentialOperations: service.recoverPendingCredentialOperations,
    flushPendingEvents: service.dispatchPendingEvents
  }
}
