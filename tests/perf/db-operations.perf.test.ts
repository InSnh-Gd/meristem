import { describe, it } from 'bun:test'
import { aggregateRounds, runBenchmark } from './helpers/perf-utils.ts'
import * as schemaDefinitions from '../../packages/db/src/schema.ts'

const benchmarkRounds = {
  warmupRounds: 1,
  measuredRounds: 3
} as const

const seedDataTemplate = {
  users: [
    { id: 'viewer', displayName: 'Viewer' },
    { id: 'operator', displayName: 'Operator' },
    { id: 'admin', displayName: 'Admin' },
    { id: 'security-admin', displayName: 'Security Admin' }
  ],
  roles: [
    { id: 'viewer', description: 'read-only operational visibility' },
    { id: 'operator', description: 'routine operations' },
    { id: 'admin', description: 'privileged administration' },
    { id: 'security-admin', description: 'audit and secret governance' }
  ],
  permissions: ['core:read', 'node:register', 'task:submit', 'timeline:read', 'audit:read'],
  profile: {
    profileVersion: 'm-net-default@0.1.0',
    region: 'global',
    schemaVersion: 'mnet-profile@0.1.0',
    status: 'available'
  }
} as const

const selectNodeTemplate =
  "SELECT * FROM meristem.nodes WHERE kind = '{kind}' AND status = '{status}' ORDER BY {orderColumn} DESC"

let benchmarkSink = 0

function recordBenchmark(name: string, opsPerSecond: number): void {
  if (!Number.isFinite(opsPerSecond) || opsPerSecond <= 0) {
    throw new Error(`${name} did not produce a positive throughput result`)
  }
  benchmarkSink += Math.trunc(opsPerSecond)
}

describe('Database operations performance', () => {
  it('schema definition loading throughput', async () => {
    const schemaEntries = Object.entries(schemaDefinitions)

    const rounds = await runBenchmark({
      name: 'schema definition loading throughput',
      ...benchmarkRounds,
      iterationsPerRound: 10000,
      fn: () => {
        // Drizzle 表定义是静态对象；这里只遍历导出元数据，避免触发任何数据库连接。
        for (const [name, definition] of schemaEntries) {
          benchmarkSink += name.length
          if (typeof definition === 'object' && definition !== null) {
            benchmarkSink += Object.keys(definition).length
          }
        }
      }
    })

    recordBenchmark(
      'schema definition loading throughput',
      aggregateRounds('schema definition loading throughput', rounds).medianOpsPerSecond
    )
  })

  it('seed data generation throughput', async () => {
    const rounds = await runBenchmark({
      name: 'seed data generation throughput',
      ...benchmarkRounds,
      iterationsPerRound: 5000,
      fn: () => {
        // seed.ts 没有导出生成函数且含顶层数据库写入；使用等价的种子对象序列化吞吐作为纯 JS 替代。
        const serializedSeed = JSON.stringify(seedDataTemplate)
        const parsedSeed = JSON.parse(serializedSeed) as typeof seedDataTemplate
        benchmarkSink += parsedSeed.users.length + parsedSeed.permissions.length
      }
    })

    recordBenchmark(
      'seed data generation throughput',
      aggregateRounds('seed data generation throughput', rounds).medianOpsPerSecond
    )
  })

  it('SQL template construction throughput', async () => {
    const rounds = await runBenchmark({
      name: 'SQL template construction throughput',
      ...benchmarkRounds,
      iterationsPerRound: 10000,
      fn: () => {
        const query = selectNodeTemplate
          .replace('{kind}', 'stem')
          .replace('{status}', 'online')
          .replace('{orderColumn}', 'created_at')
        benchmarkSink += query.length
      }
    })

    recordBenchmark(
      'SQL template construction throughput',
      aggregateRounds('SQL template construction throughput', rounds).medianOpsPerSecond
    )
  })
})
