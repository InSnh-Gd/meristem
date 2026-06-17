import type { createConfigStore } from '../../../apps/core/src/storage-adapter.ts'
import type {
  ConfigAckRecord,
  ConfigRecord,
  ConfigVersionRecord,
  CreateConfigInput,
  CreateConfigVersionInput,
  RecordConfigAckInput,
  RecordConfigTransitionInput,
  UpdateConfigStatusExtra
} from '../../../apps/core/src/storage-adapter-records-config.ts'

type ConfigStore = ReturnType<typeof createConfigStore>

export const BASE_TIME = '2026-01-01T00:00:00.000Z'

export function versionKey(configId: string, version: string): string {
  return `${configId}\u0000${version}`
}

function makeConfigRecord(overrides: Partial<ConfigRecord> = {}): ConfigRecord {
  return {
    id: 'config-1',
    configVersion: 'version-1',
    schemaVersion: 'config@0.1.0',
    configHash: 'hash-1',
    domain: 'm-net',
    targetScope: ['m-log', 'm-policy'],
    status: 'draft',
    payload: { enabled: true },
    createdBy: 'actor-1',
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides
  }
}

export class FakeConfigStore implements ConfigStore {
  readonly records = new Map<string, ConfigRecord>()
  readonly versions = new Map<string, ConfigVersionRecord>()
  readonly acks: ConfigAckRecord[] = []
  readonly transitions: RecordConfigTransitionInput[] = []

  seedConfig(overrides: Partial<ConfigRecord> = {}): ConfigRecord {
    const record = makeConfigRecord(overrides)
    this.records.set(record.id, record)
    return record
  }

  seedVersion(overrides: Partial<ConfigVersionRecord> = {}): ConfigVersionRecord {
    const version = {
      id: 'stored-version-1',
      configId: 'config-1',
      version: 'version-1',
      configHash: 'hash-1',
      payload: { enabled: true },
      status: 'published',
      createdBy: 'actor-1',
      createdAt: BASE_TIME,
      ...overrides
    }
    this.versions.set(versionKey(version.configId, version.version), version)
    return version
  }

  seedAck(overrides: Partial<ConfigAckRecord> = {}): ConfigAckRecord {
    const ack = {
      id: 'ack-1',
      configId: 'config-1',
      version: 'version-1',
      targetService: 'm-log',
      status: 'acked',
      createdAt: BASE_TIME,
      ...overrides
    }
    this.acks.push(ack)
    return ack
  }

  async list(): Promise<ConfigRecord[]> {
    return Array.from(this.records.values())
  }

  async get(id: string): Promise<ConfigRecord | null> {
    return this.records.get(id) ?? null
  }

  async create(input: CreateConfigInput): Promise<void> {
    this.records.set(input.id, {
      id: input.id,
      configVersion: input.configVersion,
      schemaVersion: input.schemaVersion,
      configHash: input.configHash,
      domain: input.domain,
      targetScope: input.targetScope,
      status: input.status,
      payload: input.payload,
      createdBy: input.createdBy,
      createdAt: input.createdAt.toISOString(),
      updatedAt: input.createdAt.toISOString(),
      ...(input.rollbackVersion ? { rollbackVersion: input.rollbackVersion } : {})
    })
  }

  async createVersion(input: CreateConfigVersionInput): Promise<void> {
    const version = {
      id: input.id,
      configId: input.configId,
      version: input.version,
      configHash: input.configHash,
      payload: input.payload,
      status: input.status,
      createdBy: input.createdBy,
      createdAt: input.createdAt.toISOString()
    }
    this.versions.set(versionKey(version.configId, version.version), version)
  }

  async updateStatus(id: string, status: string, extra?: UpdateConfigStatusExtra): Promise<void> {
    const record = this.records.get(id)
    if (!record) return
    const updatedAt = (extra?.publishedAt ?? new Date()).toISOString()
    this.records.set(id, {
      ...record,
      status,
      ...(extra?.publishedBy ? { publishedBy: extra.publishedBy } : {}),
      ...(extra?.publishedAt ? { publishedAt: extra.publishedAt.toISOString() } : {}),
      ...(extra?.rollbackVersion ? { rollbackVersion: extra.rollbackVersion } : {}),
      updatedAt
    })
  }

  async recordTransition(input: RecordConfigTransitionInput): Promise<void> {
    this.transitions.push(input)
  }

  async recordAck(input: RecordConfigAckInput): Promise<void> {
    this.acks.push({
      id: input.id,
      configId: input.configId,
      version: input.version,
      targetService: input.targetService,
      status: input.status,
      ...(input.error ? { error: input.error } : {}),
      ...(input.ackedAt ? { ackedAt: input.ackedAt.toISOString() } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
      createdAt: input.createdAt.toISOString()
    })
  }

  async getAck(
    configId: string,
    targetService: string,
    version?: string
  ): Promise<ConfigAckRecord | null> {
    return (
      this.acks.find(
        ack =>
          ack.configId === configId &&
          ack.targetService === targetService &&
          (!version || ack.version === version)
      ) ?? null
    )
  }

  async listAcks(configId: string, version?: string): Promise<ConfigAckRecord[]> {
    return this.acks.filter(
      ack => ack.configId === configId && (!version || ack.version === version)
    )
  }

  async getVersion(configId: string, version: string): Promise<ConfigVersionRecord | null> {
    return this.versions.get(versionKey(configId, version)) ?? null
  }

  async getVersionByHash(configId: string, hash: string): Promise<ConfigVersionRecord | null> {
    return (
      Array.from(this.versions.values()).find(
        version => version.configId === configId && version.configHash === hash
      ) ?? null
    )
  }
}
