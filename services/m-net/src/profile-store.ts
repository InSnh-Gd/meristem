import { eq } from 'drizzle-orm'
import type { MNetRegionalProfile } from '../../../packages/contracts/src/types/mnet-profile.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import {
  mnetNetworkProfileStates,
  mnetProfileDefinitions,
  mnetProfileTransitions
} from '../../../packages/db/src/schema.ts'
import { decodeRegionalProfile } from './store-codecs.ts'

/**
 * M-Net Profile 存储端口，仅定义接口，不依赖具体数据库实现。
 */
export type ProfileStore = {
  /** 返回所有已注册的 Profile 定义 */
  getDefinitions(): Promise<MNetRegionalProfile[]>

  /** 根据 profileVersion 获取单个定义，不存在返回 null */
  getDefinition(profileVersion: string): Promise<MNetRegionalProfile | null>

  /** 获取某网络的当前 Profile 状态，未设置返回 null */
  getNetworkState(networkId: string): Promise<NetworkProfileStateRecord | null>

  /** 设置某网络的 Profile 状态 */
  setNetworkState(
    networkId: string,
    state: { profileVersion: string; status: string }
  ): Promise<void>

  /** 列出所有网络的当前 Profile 状态（用于批量迁移扫描） */
  listNetworkStates(): Promise<NetworkProfileStateRecord[]>

  /** 记录一次状态迁移 */
  recordTransition(record: ProfileTransitionRecord): Promise<void>
}

/** 网络 Profile 运行时状态记录 */
export type NetworkProfileStateRecord = {
  networkId: string
  profileVersion: string
  status: string
  updatedAt: string
}

/** 状态迁移记录 */
export type ProfileTransitionRecord = {
  networkId: string
  fromVersion: string
  toVersion: string
  fromStatus: string
  toStatus: string
  actor: string
  reason?: string
  policyDecisionId?: string
  correlationId?: string
}

/**
 * 内置默认 Profile 种子定义。
 * m-net-default@0.1.0：controlPlaneOnly: false 的基线 Profile。
 * m-net-cn@0.1.0：controlPlaneOnly: true 的区域控制面 Profile。
 * m-net-cn@0.2.0：WireGuard + wstunnel relay 的生产数据面 Profile。
 */
const DEFAULT_PROFILES: MNetRegionalProfile[] = [
  {
    profileVersion: 'm-net-default@0.1.0',
    region: 'default',
    displayName: 'M-Net Default',
    schemaVersion: 'mnet-profile@0.1.0',
    status: 'available',
    rules: {},
    capabilities: {
      realWstunnelRelay: false,
      realTcpInterconnect: false,
      realUdpPathSwitching: false,
      controlPlaneOnly: false
    }
  },
  {
    profileVersion: 'm-net-cn@0.1.0',
    region: 'cn',
    displayName: 'M-Net CN',
    schemaVersion: 'mnet-profile@0.1.0',
    status: 'available',
    rules: {
      mainlandNodeWithoutPublicAccess: {
        interconnect: 'tcp_required'
      }
    },
    capabilities: {
      realWstunnelRelay: false,
      realTcpInterconnect: false,
      realUdpPathSwitching: false,
      controlPlaneOnly: true
    }
  },
  {
    profileVersion: 'm-net-cn@0.2.0',
    region: 'cn',
    displayName: 'M-Net CN (Production Data Plane)',
    schemaVersion: 'mnet-profile@0.2.0',
    status: 'available',
    rules: {
      mainlandNodeWithoutPublicAccess: {
        interconnect: 'wstunnel_relay'
      },
      residency: 'cn-only'
    },
    capabilities: {
      realWstunnelRelay: false,
      realTcpInterconnect: false,
      realUdpPathSwitching: false,
      controlPlaneOnly: false,
      realWireGuardTunnel: true,
      realRelayFallback: true
    },
    runtimeConfig: {
      headscaleEndpoint: { secretRefId: 'mnet-cn-headscale-endpoint' },
      routingTable: { secretRefId: 'mnet-cn-routing-table' }
    }
  }
]

async function ensureProfileDefinitions(db: MeristemDb): Promise<void> {
  const now = new Date()
  for (const definition of DEFAULT_PROFILES) {
    await db
      .insert(mnetProfileDefinitions)
      .values({
        id: definition.profileVersion,
        profileVersion: definition.profileVersion,
        region: definition.region,
        schemaVersion: definition.schemaVersion,
        definition,
        status: definition.status,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: mnetProfileDefinitions.profileVersion,
        set: {
          id: definition.profileVersion,
          region: definition.region,
          schemaVersion: definition.schemaVersion,
          definition,
          status: definition.status,
          updatedAt: now
        }
      })
  }
}

/**
 * 创建内存 Profile 存储适配器，用于单元测试和契约测试。
 * 默认 seed m-net-default@0.1.0、m-net-cn@0.1.0 和 m-net-cn@0.2.0 Profile。
 */
export function createInMemoryProfileStore(definitions?: MNetRegionalProfile[]): ProfileStore {
  const profileDefinitions = new Map<string, MNetRegionalProfile>()
  const networkStates = new Map<string, NetworkProfileStateRecord>()
  const transitions: (ProfileTransitionRecord & { createdAt: string })[] = []

  // 种子 Profile 定义
  const seeds = definitions ?? DEFAULT_PROFILES
  for (const def of seeds) {
    profileDefinitions.set(def.profileVersion, { ...def })
  }

  return {
    async getDefinitions() {
      return [...profileDefinitions.values()]
    },

    async getDefinition(profileVersion: string) {
      const def = profileDefinitions.get(profileVersion)
      return def ? { ...def } : null
    },

    async getNetworkState(networkId: string) {
      const state = networkStates.get(networkId)
      return state ? { ...state } : null
    },

    async setNetworkState(networkId: string, state: { profileVersion: string; status: string }) {
      networkStates.set(networkId, {
        networkId,
        profileVersion: state.profileVersion,
        status: state.status,
        updatedAt: new Date().toISOString()
      })
    },

    async listNetworkStates() {
      return [...networkStates.values()].map(s => ({ ...s }))
    },

    async recordTransition(record: ProfileTransitionRecord) {
      transitions.push({
        ...record,
        createdAt: new Date().toISOString()
      })
    }
  }
}

/**
 * 创建 PostgreSQL Profile 存储适配器，供生产接线复用权威写模型。
 */
export function createPgProfileStore(db: MeristemDb): ProfileStore {
  return {
    async getDefinitions() {
      await ensureProfileDefinitions(db)
      const rows = await db.select().from(mnetProfileDefinitions)
      return rows
        .map(row => decodeRegionalProfile(row.definition))
        .filter((profile): profile is MNetRegionalProfile => profile !== null)
    },

    async getDefinition(profileVersion: string) {
      await ensureProfileDefinitions(db)
      const [row] = await db
        .select()
        .from(mnetProfileDefinitions)
        .where(eq(mnetProfileDefinitions.profileVersion, profileVersion))
        .limit(1)
      if (!row) return null
      return decodeRegionalProfile(row.definition)
    },

    async getNetworkState(networkId: string) {
      const [row] = await db
        .select()
        .from(mnetNetworkProfileStates)
        .where(eq(mnetNetworkProfileStates.networkId, networkId))
        .limit(1)
      if (!row) return null
      return {
        networkId: row.networkId,
        profileVersion: row.profileVersion,
        status: row.status,
        updatedAt: row.updatedAt.toISOString()
      }
    },

    async setNetworkState(networkId: string, state) {
      const now = new Date()
      await db
        .insert(mnetNetworkProfileStates)
        .values({
          networkId,
          profileVersion: state.profileVersion,
          status: state.status,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: mnetNetworkProfileStates.networkId,
          set: {
            profileVersion: state.profileVersion,
            status: state.status,
            updatedAt: now
          }
        })
    },

    async listNetworkStates() {
      const rows = await db.select().from(mnetNetworkProfileStates)
      return rows.map(row => ({
        networkId: row.networkId,
        profileVersion: row.profileVersion,
        status: row.status,
        updatedAt: row.updatedAt.toISOString()
      }))
    },

    async recordTransition(record) {
      await db.insert(mnetProfileTransitions).values({
        id: crypto.randomUUID(),
        networkId: record.networkId,
        fromProfileVersion: record.fromVersion,
        toProfileVersion: record.toVersion,
        fromStatus: record.fromStatus,
        toStatus: record.toStatus,
        actor: record.actor,
        reason: record.reason ?? null,
        policyDecisionId: record.policyDecisionId ?? null,
        correlationId: record.correlationId ?? null,
        createdAt: new Date()
      })
    }
  }
}
