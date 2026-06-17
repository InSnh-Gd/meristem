import type { InMemoryOptions } from '../../../apps/core/src/testing/shared.ts'
import { createInMemoryCoreDeps } from '../../../apps/core/src/testing.ts'
import type { CoreDeps } from '../../../apps/core/src/types.ts'
import type {
  ApprovalWriterPort,
  NetworkProfileWriterPort
} from '../../../apps/core/src/types/approval-profile-writers.ts'
import {
  createApprovalWriterPort,
  createNetworkProfileWriterPort,
  type WriterMockOptions
} from '../../../apps/core/src/testing/approval-profile-writers.ts'

// 从 Core types 重新导出，避免测试辅助文件重复定义
export type {
  WriterContext,
  ProfileWriteRequest,
  ProfileWriteResponse,
  ApprovalWriterPort,
  NetworkProfileWriterPort
} from '../../../apps/core/src/types/approval-profile-writers.ts'

/**
 * TrackedCall records an HTTP call made by a mock writer port
 * for verification in tests.
 */
export type TrackedCall = {
  method: string
  path: string
  authorization: string | null
  correlationId: string | null
  body: unknown
}

/**
 * MockResponse is a utility to build a fetch Response in tests
 * without pulling in actual HTTP infrastructure.
 */
export type MockResponse = {
  ok: boolean
  status: number
  body: unknown
  headers?: Record<string, string>
}

// ---- Mock writer port wrappers (add call tracking to testing adapters) ----

function createTrackedApprovalWriter(
  calls: TrackedCall[],
  opts: WriterMockOptions = {}
): ApprovalWriterPort {
  const inner = createApprovalWriterPort(opts)
  return {
    async approve(id, body, context) {
      calls.push({
        method: 'POST',
        path: `/api/v0/policy/approvals/${id}/approve`,
        authorization: `Bearer ${context.bearerToken}`,
        correlationId: context.correlationId,
        body
      })
      return inner.approve(id, body, context)
    },
    async reject(id, body, context) {
      calls.push({
        method: 'POST',
        path: `/api/v0/policy/approvals/${id}/reject`,
        authorization: `Bearer ${context.bearerToken}`,
        correlationId: context.correlationId,
        body
      })
      return inner.reject(id, body, context)
    }
  }
}

function createTrackedNetworkProfileWriter(
  calls: TrackedCall[],
  opts: WriterMockOptions = {}
): NetworkProfileWriterPort {
  const inner = createNetworkProfileWriterPort(opts)
  return {
    async setProfile(networkId, body, context) {
      calls.push({
        method: 'POST',
        path: `/api/v0/networks/${networkId}/profile`,
        authorization: `Bearer ${context.bearerToken}`,
        correlationId: context.correlationId,
        body
      })
      return inner.setProfile(networkId, body, context)
    }
  }
}

/**
 * createCoreDepsWithWriters builds CoreDeps with deterministic mock writer ports
 * that record HTTP calls for test verification.
 * The returned deps include approvalWriter and networkProfileWriter so that
 * createCoreApp can use them directly.
 */
export function createCoreDepsWithWriters(
  opts: InMemoryOptions = {},
  mockWriterOpts: WriterMockOptions = {}
): { deps: CoreDeps; calls: TrackedCall[] } {
  const calls: TrackedCall[] = []
  const base = createInMemoryCoreDeps(opts) as Record<string, unknown>
  base.approvalWriter = createTrackedApprovalWriter(calls, mockWriterOpts)
  base.networkProfileWriter = createTrackedNetworkProfileWriter(calls, mockWriterOpts)
  return { deps: base as unknown as CoreDeps, calls }
}
