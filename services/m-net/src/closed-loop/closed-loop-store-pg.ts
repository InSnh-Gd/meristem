import { and, eq } from 'drizzle-orm'
import { Result } from 'effect'
import * as Schema from 'effect/Schema'
import {
  type MNetBreakGlassGrantFromSchema,
  MNetBreakGlassGrantSchema,
  MNetClosedLoopEventSubjectSchema,
  type MNetCredentialOperationFromSchema,
  MNetCredentialOperationSchema,
  MNetForcedRelayPolicyResultSchema,
  type MNetJoinCredentialFromSchema,
  MNetJoinCredentialSchema,
  type MNetPendingJoinRequestFromSchema,
  MNetPendingJoinRequestSchema,
  type MNetProfileMigrationResultFromSchema,
  MNetProfileMigrationResultSchema,
  type MNetSidecarStatusFromSchema,
  MNetSidecarStatusSchema,
  type MNetTunnelHealthFromSchema,
  MNetTunnelHealthSchema
} from '../../../../packages/contracts/src/index.ts'
import type { MeristemDb } from '../../../../packages/db/src/client.ts'
import { mnetClosedLoopFacts } from '../../../../packages/db/src/schema.ts'
import {
  type MNetClosedLoopCommit,
  type MNetClosedLoopEventIntent,
  type MNetClosedLoopFactWrite,
  MNetClosedLoopStorageError,
  type MNetClosedLoopStore,
  type MNetCredentialOperation,
  type MNetCredentialTransitionClaim,
  type StoredRelayPolicy
} from './closed-loop-store.ts'

type FactKind =
  | 'join'
  | 'credential'
  | 'credential-operation'
  | 'relay-policy'
  | 'migration'
  | 'break-glass'
  | 'sidecar'
  | 'tunnel'
  | 'event-intent'

const eventIntentSchema = Schema.Struct({
  intentId: Schema.String,
  operationId: Schema.String,
  networkId: Schema.String,
  subject: MNetClosedLoopEventSubjectSchema,
  payload: Schema.Unknown,
  correlationId: Schema.String,
  status: Schema.Literals(['pending', 'published']),
  createdAt: Schema.String,
  publishedAt: Schema.optional(Schema.String),
  lastError: Schema.optional(Schema.String)
})

function decodeRequired<A, I>(schema: Schema.Codec<A, I>, value: unknown, label: string): A {
  const decoded = Schema.decodeUnknownResult(schema)(value)
  if (Result.isSuccess(decoded)) return decoded.success
  throw new MNetClosedLoopStorageError(
    'mnet.store.decode_failed',
    `invalid persisted M-Net closed-loop ${label}`
  )
}

function decodeRelay(value: unknown): StoredRelayPolicy {
  const decoded = decodeRequired(MNetForcedRelayPolicyResultSchema, value, 'relay-policy fact')
  if (decoded.result !== 'denied') return decoded
  throw new MNetClosedLoopStorageError(
    'mnet.store.decode_failed',
    'persisted relay-policy fact must not contain a denied operation'
  )
}

export function decodeStoredMNetClosedLoopJoin(value: unknown): MNetPendingJoinRequestFromSchema {
  return decodeRequired<MNetPendingJoinRequestFromSchema, MNetPendingJoinRequestFromSchema>(
    MNetPendingJoinRequestSchema,
    value,
    'join fact'
  )
}

function factRecord(fact: MNetClosedLoopFactWrite): {
  factKind: FactKind
  factId: string
  networkId: string
  payload: unknown
} {
  switch (fact.kind) {
    case 'join':
      return {
        factKind: fact.kind,
        factId: fact.value.requestId,
        networkId: fact.value.networkId,
        payload: fact.value
      }
    case 'credential':
      return {
        factKind: fact.kind,
        factId: fact.value.credentialId,
        networkId: fact.value.networkId,
        payload: fact.value
      }
    case 'credential-operation':
      return {
        factKind: fact.kind,
        factId: fact.value.operationId,
        networkId: fact.value.networkId,
        payload: fact.value
      }
    case 'relay-policy':
      return {
        factKind: fact.kind,
        factId: fact.value.networkId,
        networkId: fact.value.networkId,
        payload: fact.value
      }
    case 'migration':
      return {
        factKind: fact.kind,
        factId: fact.value.migrationId,
        networkId: fact.value.networkId,
        payload: fact.value
      }
    case 'break-glass':
      return {
        factKind: fact.kind,
        factId: fact.value.grantId,
        networkId: fact.value.networkId,
        payload: fact.value
      }
    case 'sidecar':
      return {
        factKind: fact.kind,
        factId: fact.value.nodeId,
        networkId: fact.networkId,
        payload: fact.value
      }
    case 'tunnel':
      return {
        factKind: fact.kind,
        factId: `${fact.value.nodeId}:${fact.value.peerNodeId}`,
        networkId: fact.networkId,
        payload: fact.value
      }
  }
}

/** PostgreSQL-authoritative fact store with atomic state and event-intent commits. */
export function createPgMNetClosedLoopStore(db: MeristemDb): MNetClosedLoopStore {
  async function commit(input: MNetClosedLoopCommit): Promise<void> {
    try {
      await db.transaction(async tx => {
        const records = [
          ...input.facts.map(factRecord),
          ...input.eventIntents.map(intent => ({
            factKind: 'event-intent' as const,
            factId: intent.intentId,
            networkId: intent.networkId,
            payload: intent
          }))
        ]
        for (const record of records) {
          await tx
            .insert(mnetClosedLoopFacts)
            .values({ ...record, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [mnetClosedLoopFacts.factKind, mnetClosedLoopFacts.factId],
              set: {
                networkId: record.networkId,
                payload: record.payload,
                updatedAt: new Date()
              }
            })
        }
      })
    } catch (error) {
      if (error instanceof MNetClosedLoopStorageError) throw error
      throw new MNetClosedLoopStorageError(
        'mnet.store.write_failed',
        'M-Net closed-loop storage write failed'
      )
    }
  }

  async function claimCredentialTransition(input: MNetCredentialTransitionClaim): Promise<boolean> {
    try {
      return await db.transaction(async tx => {
        const [row] = await tx
          .select({ payload: mnetClosedLoopFacts.payload })
          .from(mnetClosedLoopFacts)
          .where(
            and(
              eq(mnetClosedLoopFacts.factKind, 'credential'),
              eq(mnetClosedLoopFacts.factId, input.credentialId)
            )
          )
          .for('update')
          .limit(1)
        if (!row) return false
        const current = decodeRequired(
          MNetJoinCredentialSchema,
          row.payload,
          'credential transition fact'
        )
        if (!input.expectedStatuses.includes(current.status)) return false
        for (const fact of input.facts) {
          const record = factRecord(fact)
          await tx
            .insert(mnetClosedLoopFacts)
            .values({ ...record, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [mnetClosedLoopFacts.factKind, mnetClosedLoopFacts.factId],
              set: {
                networkId: record.networkId,
                payload: record.payload,
                updatedAt: new Date()
              }
            })
        }
        return true
      })
    } catch (error) {
      if (error instanceof MNetClosedLoopStorageError) throw error
      throw new MNetClosedLoopStorageError(
        'mnet.store.write_failed',
        'M-Net credential transition write failed'
      )
    }
  }

  async function get(factKind: FactKind, factId: string): Promise<unknown | null> {
    try {
      const [row] = await db
        .select({ payload: mnetClosedLoopFacts.payload })
        .from(mnetClosedLoopFacts)
        .where(
          and(eq(mnetClosedLoopFacts.factKind, factKind), eq(mnetClosedLoopFacts.factId, factId))
        )
        .limit(1)
      return row?.payload ?? null
    } catch {
      throw new MNetClosedLoopStorageError(
        'mnet.store.write_failed',
        'M-Net closed-loop storage read failed'
      )
    }
  }

  async function list(factKind: FactKind, networkId?: string): Promise<unknown[]> {
    try {
      const rows = networkId
        ? await db
            .select({ payload: mnetClosedLoopFacts.payload })
            .from(mnetClosedLoopFacts)
            .where(
              and(
                eq(mnetClosedLoopFacts.factKind, factKind),
                eq(mnetClosedLoopFacts.networkId, networkId)
              )
            )
        : await db
            .select({ payload: mnetClosedLoopFacts.payload })
            .from(mnetClosedLoopFacts)
            .where(eq(mnetClosedLoopFacts.factKind, factKind))
      return rows.map(row => row.payload)
    } catch {
      throw new MNetClosedLoopStorageError(
        'mnet.store.write_failed',
        'M-Net closed-loop storage read failed'
      )
    }
  }

  async function eventIntent(intentId: string): Promise<MNetClosedLoopEventIntent> {
    const stored = await get('event-intent', intentId)
    if (stored === null) {
      throw new MNetClosedLoopStorageError(
        'mnet.store.write_failed',
        `event intent not found: ${intentId}`
      )
    }
    return decodeRequired(eventIntentSchema, stored, 'event intent')
  }

  return {
    commit,
    claimCredentialTransition,
    async listPendingEventIntents(operationId) {
      return (await list('event-intent'))
        .map(value => decodeRequired(eventIntentSchema, value, 'event intent'))
        .filter(
          intent =>
            intent.status === 'pending' && (!operationId || intent.operationId === operationId)
        )
    },
    async markEventIntentPublished(intentId, publishedAt) {
      const intent = await eventIntent(intentId)
      await commit({
        facts: [],
        eventIntents: [{ ...intent, status: 'published', publishedAt }]
      })
    },
    async recordEventIntentFailure(intentId, errorCode) {
      const intent = await eventIntent(intentId)
      await commit({ facts: [], eventIntents: [{ ...intent, lastError: errorCode }] })
    },
    joins: {
      async upsert(request) {
        await commit({ facts: [{ kind: 'join', value: request }], eventIntents: [] })
      },
      async get(requestId) {
        const value = await get('join', requestId)
        return value === null ? null : decodeStoredMNetClosedLoopJoin(value)
      },
      async listByNetwork(networkId) {
        return (await list('join', networkId)).map(decodeStoredMNetClosedLoopJoin)
      }
    },
    credentials: {
      async upsert(credential) {
        await commit({ facts: [{ kind: 'credential', value: credential }], eventIntents: [] })
      },
      async get(credentialId) {
        const value = await get('credential', credentialId)
        return value === null
          ? null
          : decodeRequired<MNetJoinCredentialFromSchema, MNetJoinCredentialFromSchema>(
              MNetJoinCredentialSchema,
              value,
              'credential fact'
            )
      },
      async listByNetwork(networkId) {
        return (await list('credential', networkId)).map(value =>
          decodeRequired<MNetJoinCredentialFromSchema, MNetJoinCredentialFromSchema>(
            MNetJoinCredentialSchema,
            value,
            'credential fact'
          )
        )
      }
    },
    credentialOperations: {
      async get(operationId) {
        const value = await get('credential-operation', operationId)
        return value === null
          ? null
          : decodeRequired<MNetCredentialOperationFromSchema, MNetCredentialOperationFromSchema>(
              MNetCredentialOperationSchema,
              value,
              'credential operation fact'
            )
      },
      async listPending() {
        return (await list('credential-operation'))
          .map(value =>
            decodeRequired<MNetCredentialOperation, MNetCredentialOperation>(
              MNetCredentialOperationSchema,
              value,
              'credential operation fact'
            )
          )
          .filter(value => value.state !== 'completed')
      }
    },
    relayPolicies: {
      async upsert(policy) {
        await commit({ facts: [{ kind: 'relay-policy', value: policy }], eventIntents: [] })
      },
      async get(networkId) {
        const value = await get('relay-policy', networkId)
        return value === null ? null : decodeRelay(value)
      }
    },
    migrations: {
      async upsert(migration) {
        await commit({ facts: [{ kind: 'migration', value: migration }], eventIntents: [] })
      },
      async get(migrationId) {
        const value = await get('migration', migrationId)
        return value === null
          ? null
          : decodeRequired<
              MNetProfileMigrationResultFromSchema,
              MNetProfileMigrationResultFromSchema
            >(MNetProfileMigrationResultSchema, value, 'migration fact')
      }
    },
    breakGlass: {
      async upsert(grant) {
        await commit({ facts: [{ kind: 'break-glass', value: grant }], eventIntents: [] })
      },
      async get(grantId) {
        const value = await get('break-glass', grantId)
        return value === null
          ? null
          : decodeRequired<MNetBreakGlassGrantFromSchema, MNetBreakGlassGrantFromSchema>(
              MNetBreakGlassGrantSchema,
              value,
              'break-glass fact'
            )
      },
      async listActiveByNetwork(networkId) {
        return (await list('break-glass', networkId))
          .map(value =>
            decodeRequired<MNetBreakGlassGrantFromSchema, MNetBreakGlassGrantFromSchema>(
              MNetBreakGlassGrantSchema,
              value,
              'break-glass fact'
            )
          )
          .filter(value => value.state === 'active')
      },
      async listExpirable() {
        return (await list('break-glass'))
          .map(value =>
            decodeRequired<MNetBreakGlassGrantFromSchema, MNetBreakGlassGrantFromSchema>(
              MNetBreakGlassGrantSchema,
              value,
              'break-glass fact'
            )
          )
          .filter(value => value.state !== 'auto_revoked')
      }
    },
    sidecars: {
      async upsert(networkId, status) {
        await commit({
          facts: [{ kind: 'sidecar', networkId, value: status }],
          eventIntents: []
        })
      },
      async listByNetwork(networkId) {
        return (await list('sidecar', networkId)).map(value =>
          decodeRequired<MNetSidecarStatusFromSchema, MNetSidecarStatusFromSchema>(
            MNetSidecarStatusSchema,
            value,
            'sidecar fact'
          )
        )
      }
    },
    tunnels: {
      async upsert(networkId, health) {
        await commit({
          facts: [{ kind: 'tunnel', networkId, value: health }],
          eventIntents: []
        })
      },
      async listByNetwork(networkId) {
        return (await list('tunnel', networkId)).map(value =>
          decodeRequired<MNetTunnelHealthFromSchema, MNetTunnelHealthFromSchema>(
            MNetTunnelHealthSchema,
            value,
            'tunnel fact'
          )
        )
      }
    }
  }
}
