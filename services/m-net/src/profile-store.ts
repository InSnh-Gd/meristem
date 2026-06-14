import type { MNetRegionalProfile } from '../../../packages/contracts/src/types/mnet-profile.ts'

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
      realDerpRelay: false,
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
      realDerpRelay: false,
      realTcpInterconnect: false,
      realUdpPathSwitching: false,
      controlPlaneOnly: true
    }
  }
]

/**
 * 创建内存 Profile 存储适配器，用于单元测试和契约测试。
 * 默认 seed m-net-default@0.1.0 和 m-net-cn@0.1.0 两个 Profile。
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

    async recordTransition(record: ProfileTransitionRecord) {
      transitions.push({
        ...record,
        createdAt: new Date().toISOString()
      })
    }
  }
}
