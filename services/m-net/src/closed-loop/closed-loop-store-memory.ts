import type {
  MNetBreakGlassGrantFromSchema,
  MNetJoinCredentialFromSchema,
  MNetPendingJoinRequestFromSchema,
  MNetProfileMigrationResultFromSchema,
  MNetSidecarStatusFromSchema,
  MNetTunnelHealthFromSchema
} from '../../../../packages/contracts/src/index.ts'
import {
  type MNetClosedLoopCommit,
  type MNetClosedLoopEventIntent,
  MNetClosedLoopStorageError,
  type MNetClosedLoopStore,
  type MNetCredentialOperation,
  type MNetCredentialTransitionClaim,
  type StoredRelayPolicy
} from './closed-loop-store.ts'

type MemoryState = {
  joins: Map<string, MNetPendingJoinRequestFromSchema>
  credentials: Map<string, MNetJoinCredentialFromSchema>
  credentialOperations: Map<string, MNetCredentialOperation>
  relayPolicies: Map<string, StoredRelayPolicy>
  migrations: Map<string, MNetProfileMigrationResultFromSchema>
  breakGlass: Map<string, MNetBreakGlassGrantFromSchema>
  sidecars: Map<string, MNetSidecarStatusFromSchema>
  tunnels: Map<string, MNetTunnelHealthFromSchema>
  eventIntents: Map<string, MNetClosedLoopEventIntent>
}

function emptyState(): MemoryState {
  return {
    joins: new Map(),
    credentials: new Map(),
    credentialOperations: new Map(),
    relayPolicies: new Map(),
    migrations: new Map(),
    breakGlass: new Map(),
    sidecars: new Map(),
    tunnels: new Map(),
    eventIntents: new Map()
  }
}

function cloneState(state: MemoryState): MemoryState {
  return {
    joins: new Map(state.joins),
    credentials: new Map(state.credentials),
    credentialOperations: new Map(state.credentialOperations),
    relayPolicies: new Map(state.relayPolicies),
    migrations: new Map(state.migrations),
    breakGlass: new Map(state.breakGlass),
    sidecars: new Map(state.sidecars),
    tunnels: new Map(state.tunnels),
    eventIntents: new Map(state.eventIntents)
  }
}

function applyCommit(state: MemoryState, input: MNetClosedLoopCommit): void {
  for (const fact of input.facts) {
    switch (fact.kind) {
      case 'join':
        state.joins.set(fact.value.requestId, structuredClone(fact.value))
        break
      case 'credential':
        state.credentials.set(fact.value.credentialId, structuredClone(fact.value))
        break
      case 'credential-operation':
        state.credentialOperations.set(fact.value.operationId, structuredClone(fact.value))
        break
      case 'relay-policy':
        state.relayPolicies.set(fact.value.networkId, structuredClone(fact.value))
        break
      case 'migration':
        state.migrations.set(fact.value.migrationId, structuredClone(fact.value))
        break
      case 'break-glass':
        state.breakGlass.set(fact.value.grantId, structuredClone(fact.value))
        break
      case 'sidecar':
        state.sidecars.set(`${fact.networkId}:${fact.value.nodeId}`, structuredClone(fact.value))
        break
      case 'tunnel':
        state.tunnels.set(
          `${fact.networkId}:${fact.value.nodeId}:${fact.value.peerNodeId}`,
          structuredClone(fact.value)
        )
        break
    }
  }
  for (const intent of input.eventIntents) {
    state.eventIntents.set(intent.intentId, structuredClone(intent))
  }
}

/** Test-only closed-loop storage with atomic fact-plus-event-intent commits. */
export function createInMemoryMNetClosedLoopStore(): MNetClosedLoopStore {
  let state = emptyState()

  async function commit(input: MNetClosedLoopCommit): Promise<void> {
    const next = cloneState(state)
    applyCommit(next, input)
    state = next
  }

  async function claimCredentialTransition(input: MNetCredentialTransitionClaim): Promise<boolean> {
    const current = state.credentials.get(input.credentialId)
    if (!current || !input.expectedStatuses.includes(current.status)) return false
    const next = cloneState(state)
    applyCommit(next, { facts: input.facts, eventIntents: [] })
    state = next
    return true
  }

  return {
    commit,
    claimCredentialTransition,
    async listPendingEventIntents(operationId) {
      return [...state.eventIntents.values()]
        .filter(
          intent =>
            intent.status === 'pending' && (!operationId || intent.operationId === operationId)
        )
        .map(intent => structuredClone(intent))
    },
    async markEventIntentPublished(intentId, publishedAt) {
      const intent = state.eventIntents.get(intentId)
      if (!intent) {
        throw new MNetClosedLoopStorageError(
          'mnet.store.write_failed',
          `event intent not found: ${intentId}`
        )
      }
      const next = cloneState(state)
      next.eventIntents.set(intentId, {
        ...structuredClone(intent),
        status: 'published',
        publishedAt
      })
      state = next
    },
    async recordEventIntentFailure(intentId, errorCode) {
      const intent = state.eventIntents.get(intentId)
      if (!intent) {
        throw new MNetClosedLoopStorageError(
          'mnet.store.write_failed',
          `event intent not found: ${intentId}`
        )
      }
      const next = cloneState(state)
      next.eventIntents.set(intentId, { ...structuredClone(intent), lastError: errorCode })
      state = next
    },
    joins: {
      async upsert(request) {
        await commit({ facts: [{ kind: 'join', value: request }], eventIntents: [] })
      },
      async get(requestId) {
        const value = state.joins.get(requestId)
        return value ? structuredClone(value) : null
      },
      async listByNetwork(networkId) {
        return [...state.joins.values()]
          .filter(value => value.networkId === networkId)
          .map(value => structuredClone(value))
      }
    },
    credentials: {
      async upsert(credential) {
        await commit({ facts: [{ kind: 'credential', value: credential }], eventIntents: [] })
      },
      async get(credentialId) {
        const value = state.credentials.get(credentialId)
        return value ? structuredClone(value) : null
      },
      async listByNetwork(networkId) {
        return [...state.credentials.values()]
          .filter(value => value.networkId === networkId)
          .map(value => structuredClone(value))
      }
    },
    credentialOperations: {
      async get(operationId) {
        const value = state.credentialOperations.get(operationId)
        return value ? structuredClone(value) : null
      },
      async listPending() {
        return [...state.credentialOperations.values()]
          .filter(value => value.state !== 'completed')
          .map(value => structuredClone(value))
      }
    },
    relayPolicies: {
      async upsert(policy) {
        await commit({ facts: [{ kind: 'relay-policy', value: policy }], eventIntents: [] })
      },
      async get(networkId) {
        const value = state.relayPolicies.get(networkId)
        return value ? structuredClone(value) : null
      }
    },
    migrations: {
      async upsert(migration) {
        await commit({ facts: [{ kind: 'migration', value: migration }], eventIntents: [] })
      },
      async get(migrationId) {
        const value = state.migrations.get(migrationId)
        return value ? structuredClone(value) : null
      }
    },
    breakGlass: {
      async upsert(grant) {
        await commit({ facts: [{ kind: 'break-glass', value: grant }], eventIntents: [] })
      },
      async get(grantId) {
        const value = state.breakGlass.get(grantId)
        return value ? structuredClone(value) : null
      },
      async listActiveByNetwork(networkId) {
        return [...state.breakGlass.values()]
          .filter(value => value.networkId === networkId && value.state === 'active')
          .map(value => structuredClone(value))
      },
      async listExpirable() {
        return [...state.breakGlass.values()]
          .filter(value => value.state !== 'auto_revoked')
          .map(value => structuredClone(value))
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
        const prefix = `${networkId}:`
        return [...state.sidecars.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, value]) => structuredClone(value))
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
        const prefix = `${networkId}:`
        return [...state.tunnels.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, value]) => structuredClone(value))
      }
    }
  }
}
