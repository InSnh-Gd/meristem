import type { StatusResponse } from '../../contracts/src/types.ts'

/**
 * 返回与 CLI status 命令契约对齐的固定 mock 响应。
 *
 * 该响应在 tests/cli/cli.test.ts 与 tests/cli/cli-identity.test.ts 中被重复使用，
 * 提取到此处避免漂移。
 */
export async function createCliStatusMock(): Promise<StatusResponse> {
  return {
    core: { id: 'meristem-core', version: '0.1.0', mode: 'normal' },
    dependencies: {
      postgres: 'ready',
      nats: 'ready',
      'm-policy': 'ready',
      'm-log': 'ready',
      'm-eventbus': 'ready',
      'm-net': 'ready'
    },
    counts: { services: 1, nodes: 2, tasks: 3 }
  }
}
