import type { ActorId } from '../../../packages/contracts/src/literals.ts'
import { mExtensionScope } from '../../../packages/contracts/src/types/extension.ts'
import type {
  MExtensionDefinition,
  MExtensionInstance,
  MExtensionManifestV01,
  MExtensionTransition
} from '../../../packages/contracts/src/types/extension.ts'

export type RegisterDefinitionInput = {
  manifest: MExtensionManifestV01
  actor: ActorId
  policyDecisionId: string
  correlationId: string
}

export type InstanceTransitionInput = {
  extensionId: string
  actor: ActorId
  reason?: string | undefined
  policyDecisionId: string
  correlationId: string
}

export type ExtensionStore = {
  list(): Promise<Array<{ definition: MExtensionDefinition; instance?: MExtensionInstance }>>
  get(id: string): Promise<{ definition: MExtensionDefinition; instance?: MExtensionInstance } | null>
  register(input: RegisterDefinitionInput): Promise<{ definition: MExtensionDefinition; instance: MExtensionInstance }>
  enable(input: InstanceTransitionInput): Promise<{ definition: MExtensionDefinition; instance: MExtensionInstance } | null>
  disable(input: InstanceTransitionInput): Promise<{ definition: MExtensionDefinition; instance: MExtensionInstance } | null>
  transitions(): Promise<MExtensionTransition[]>
}

function cloneDefinition(definition: MExtensionDefinition): MExtensionDefinition {
  return {
    ...definition,
    manifest: { ...definition.manifest, requestedPermissions: [...definition.manifest.requestedPermissions], declaredCapabilities: [...definition.manifest.declaredCapabilities] },
    declaredCapabilities: [...definition.declaredCapabilities],
    requestedPermissions: [...definition.requestedPermissions]
  }
}

function cloneInstance(instance: MExtensionInstance): MExtensionInstance {
  return { ...instance }
}

/**
 * 内存适配器服务于契约测试和本地最小运行；PostgreSQL 表结构是权威部署目标。
 */
export function createInMemoryExtensionStore(): ExtensionStore {
  const definitions = new Map<string, MExtensionDefinition>()
  const instances = new Map<string, MExtensionInstance>()
  const transitionRecords: MExtensionTransition[] = []

  function pair(definition: MExtensionDefinition): { definition: MExtensionDefinition; instance?: MExtensionInstance } {
    const instance = instances.get(definition.id)
    return instance ? { definition: cloneDefinition(definition), instance: cloneInstance(instance) } : { definition: cloneDefinition(definition) }
  }

  function recordTransition(input: Omit<MExtensionTransition, 'id' | 'createdAt'>): void {
    transitionRecords.push({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() })
  }

  return {
    async list() {
      return [...definitions.values()].map(pair)
    },
    async get(id) {
      const definition = definitions.get(id)
      return definition ? pair(definition) : null
    },
    async register(input) {
      const now = new Date().toISOString()
      const existing = definitions.get(input.manifest.id)
      const existingInstance = instances.get(input.manifest.id)
      const definition: MExtensionDefinition = {
        id: input.manifest.id,
        manifestVersion: input.manifest.manifestVersion,
        kind: input.manifest.kind,
        displayName: input.manifest.displayName,
        owner: input.manifest.owner,
        license: input.manifest.license,
        manifest: input.manifest,
        declaredCapabilities: input.manifest.declaredCapabilities,
        requestedPermissions: input.manifest.requestedPermissions,
        riskClass: input.manifest.riskClass,
        status: 'registered',
        registeredBy: input.actor,
        policyDecisionId: input.policyDecisionId,
        correlationId: input.correlationId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      const instance: MExtensionInstance = existingInstance ?? {
        id: crypto.randomUUID(),
        extensionId: definition.id,
        scopeType: mExtensionScope.type,
        scopeId: mExtensionScope.id,
        status: 'disabled',
        createdAt: now,
        updatedAt: now
      }
      definitions.set(definition.id, definition)
      instances.set(definition.id, instance)
      recordTransition({ extensionId: definition.id, toStatus: 'registered', actor: input.actor, policyDecisionId: input.policyDecisionId, correlationId: input.correlationId })
      return { definition: cloneDefinition(definition), instance: cloneInstance(instance) }
    },
    async enable(input) {
      const pairValue = await this.get(input.extensionId)
      if (!pairValue?.instance) return null
      const now = new Date().toISOString()
      const { lastError: _lastError, ...current } = pairValue.instance
      const next: MExtensionInstance = {
        ...current,
        status: 'enabled',
        enabledBy: input.actor,
        policyDecisionId: input.policyDecisionId,
        correlationId: input.correlationId,
        updatedAt: now,
        enabledAt: now
      }
      instances.set(input.extensionId, next)
      recordTransition({ extensionId: input.extensionId, instanceId: next.id, fromStatus: pairValue.instance.status, toStatus: 'enabled', actor: input.actor, ...(input.reason ? { reason: input.reason } : {}), policyDecisionId: input.policyDecisionId, correlationId: input.correlationId })
      return { definition: pairValue.definition, instance: cloneInstance(next) }
    },
    async disable(input) {
      const pairValue = await this.get(input.extensionId)
      if (!pairValue?.instance) return null
      const now = new Date().toISOString()
      const { lastError: _lastError, ...current } = pairValue.instance
      const next: MExtensionInstance = {
        ...current,
        status: 'disabled',
        disabledBy: input.actor,
        policyDecisionId: input.policyDecisionId,
        correlationId: input.correlationId,
        updatedAt: now,
        disabledAt: now
      }
      instances.set(input.extensionId, next)
      recordTransition({ extensionId: input.extensionId, instanceId: next.id, fromStatus: pairValue.instance.status, toStatus: 'disabled', actor: input.actor, ...(input.reason ? { reason: input.reason } : {}), policyDecisionId: input.policyDecisionId, correlationId: input.correlationId })
      return { definition: pairValue.definition, instance: cloneInstance(next) }
    },
    async transitions() {
      return transitionRecords.map((transition) => ({ ...transition }))
    }
  }
}
