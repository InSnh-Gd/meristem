import { err, ok } from '../../../../packages/common/src/result.ts'
import type {
  ApprovalReaderPort,
  NetworkProfileReaderPort
} from '../types/approval-profile-readers.ts'
import type { InMemoryCoreTestingHelpers } from './shared.ts'

const now = '2026-06-15T00:00:00.000Z'

const defaultApproval = {
  id: 'approval-core-facade-1',
  policyDecisionId: 'decision-core-facade-1',
  originService: 'm-net' as const,
  operationId: 'operation-core-facade-1',
  requestedBy: 'operator' as const,
  requiredAction: 'manual_review' as const,
  status: 'pending' as const,
  quorumRequired: 1,
  expiresAt: '2026-06-15T01:00:00.000Z',
  createdAt: now,
  updatedAt: now
}

const defaultProfiles = [
  {
    profileVersion: 'm-net-default@0.1.0' as const,
    region: 'default' as const,
    displayName: 'M-Net Default',
    schemaVersion: 'mnet-profile@0.1.0' as const,
    status: 'available' as const,
    rules: {},
    capabilities: {
      realWstunnelRelay: false as const,
      realTcpInterconnect: false as const,
      realUdpPathSwitching: false as const,
      controlPlaneOnly: false
    }
  },
  {
    profileVersion: 'm-net-cn@0.1.0' as const,
    region: 'cn' as const,
    displayName: 'M-Net CN',
    schemaVersion: 'mnet-profile@0.1.0' as const,
    status: 'available' as const,
    rules: { residency: 'cn-only' },
    capabilities: {
      realWstunnelRelay: false as const,
      realTcpInterconnect: false as const,
      realUdpPathSwitching: false as const,
      controlPlaneOnly: true
    }
  }
]

/**
 * 测试审批读取端口提供确定性内存记录，不读取 M-Policy 私有 store。
 */
export function createApprovalReaderPort(helpers: InMemoryCoreTestingHelpers): ApprovalReaderPort {
  return {
    requiredPermission: 'policy:approval-read',
    async list() {
      if (helpers.options.approvalReaderAvailable === false) {
        return err({ code: 'm-policy.unavailable', message: 'M-Policy approval API unavailable' })
      }
      return ok({ approvals: helpers.options.approvals ?? [defaultApproval] })
    },
    async get(id) {
      if (helpers.options.approvalReaderAvailable === false) {
        return err({ code: 'm-policy.unavailable', message: 'M-Policy approval API unavailable' })
      }
      const approval = (helpers.options.approvals ?? [defaultApproval]).find(
        record => record.id === id
      )
      if (!approval) return ok(null)
      return ok({
        ...approval,
        votes: (helpers.options.approvalVotes ?? []).filter(vote => vote.approvalId === id)
      })
    }
  }
}

/**
 * 测试 profile 读取端口提供确定性内存记录，不读取 M-Net 私有 store。
 */
export function createNetworkProfileReaderPort(
  helpers: InMemoryCoreTestingHelpers
): NetworkProfileReaderPort {
  return {
    requiredPermission: 'network:profile-read',
    async list() {
      if (helpers.options.networkProfileReaderAvailable === false) {
        return err({ code: 'mnet.unavailable', message: 'M-Net profile API unavailable' })
      }
      return ok({ profiles: helpers.options.networkProfiles ?? defaultProfiles })
    },
    async get(profileVersion) {
      if (helpers.options.networkProfileReaderAvailable === false) {
        return err({ code: 'mnet.unavailable', message: 'M-Net profile API unavailable' })
      }
      return ok(
        (helpers.options.networkProfiles ?? defaultProfiles).find(
          profile => profile.profileVersion === profileVersion
        ) ?? null
      )
    }
  }
}
