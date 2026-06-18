import type { CliClient } from '../../../apps/m-cli/src/commands/types.ts'
import { createCliStatusMock } from './cli-status-mock.ts'

/**
 * 创建聚焦 mock CliClient：以共享健康 status mock 为底座，合并部分覆盖。
 * 用 `satisfies CliClient` 校验形状，避免 `as unknown as CliClient` 双重断言。
 */
export function createFocusedCliClient(overrides: Partial<CliClient> = {}): CliClient {
  return { status: createCliStatusMock, ...overrides } satisfies CliClient
}
