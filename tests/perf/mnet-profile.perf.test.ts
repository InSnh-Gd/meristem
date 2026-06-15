import { describe, it } from 'bun:test'

import { runBenchmark, aggregateRounds, type BenchmarkResult } from './helpers/perf-utils.ts'
import {
  canDisable,
  canRequestEnable,
  canResume,
  nextProfileState,
  type ProfileAction,
  type ProfileState
} from '../../services/m-net/src/profile-state-machine.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'

function logBenchmark(name: string, aggregated: BenchmarkResult): void {
  console.info(
    `[perf] ${name}: median=${aggregated.medianOpsPerSecond.toFixed(0)} ops/s, CV=${aggregated.coefficientOfVariation.toFixed(4)}`
  )
}

function assertPositiveMedian(aggregated: BenchmarkResult): void {
  if (aggregated.medianOpsPerSecond <= 0) {
    throw new Error(`${aggregated.name} median ops/s must be positive`)
  }
}

describe('M-Net Profile performance', () => {
  it('profile state machine transition throughput', async () => {
    const name = 'profile-state-machine'
    const transitions: Array<[ProfileState, ProfileAction]> = [
      ['disabled', 'enable_request'],
      ['enabling', 'enable_success'],
      ['enabled', 'disable_request'],
      ['disabling', 'disable_success'],
      ['enabling', 'enable_fail'],
      ['failed', 'disable_request'],
      ['disabling', 'disable_fail'],
      ['failed', 'enable_request']
    ]

    const rounds = await runBenchmark({
      name,
      warmupRounds: 2,
      measuredRounds: 5,
      iterationsPerRound: 50000,
      fn: () => {
        for (const [state, action] of transitions) {
          nextProfileState(state, action)
        }
      }
    })

    const aggregated = aggregateRounds(name, rounds)
    logBenchmark(name, aggregated)
    assertPositiveMedian(aggregated)
  })

  it('profile guard predicates throughput', async () => {
    const name = 'profile-guard-predicates'
    const state: ProfileState = 'enabled'

    const rounds = await runBenchmark({
      name,
      warmupRounds: 1,
      measuredRounds: 3,
      iterationsPerRound: 100000,
      fn: () => {
        canDisable(state)
        canRequestEnable(state)
        canResume(state)
      }
    })

    const aggregated = aggregateRounds(name, rounds)
    logBenchmark(name, aggregated)
    assertPositiveMedian(aggregated)
  })

  it('profile store operation throughput', async () => {
    const name = 'profile-store-operations'
    const store = createInMemoryProfileStore()
    let counter = 0

    const rounds = await runBenchmark({
      name,
      warmupRounds: 1,
      measuredRounds: 3,
      iterationsPerRound: 10000,
      fn: async () => {
        const networkId = `perf-network-${counter++}`
        await store.getDefinition('m-net-default@0.1.0')
        await store.setNetworkState(networkId, {
          profileVersion: 'm-net-default@0.1.0',
          status: 'enabled'
        })
        await store.getNetworkState(networkId)
        await store.recordTransition({
          networkId,
          fromVersion: 'm-net-cn@0.1.0',
          toVersion: 'm-net-default@0.1.0',
          fromStatus: 'disabled',
          toStatus: 'enabled',
          actor: 'perf-test',
          reason: 'profile store benchmark'
        })
      }
    })

    const aggregated = aggregateRounds(name, rounds)
    logBenchmark(name, aggregated)
    assertPositiveMedian(aggregated)
  })

  it('suspended profile operation throughput', async () => {
    const name = 'profile-suspended-operations'
    const store = createInMemoryProfileStore()
    let counter = 0

    const rounds = await runBenchmark({
      name,
      warmupRounds: 1,
      measuredRounds: 3,
      iterationsPerRound: 10000,
      fn: async () => {
        const networkId = `perf-suspended-network-${counter++}`
        await store.setNetworkState(networkId, {
          profileVersion: 'm-net-cn@0.1.0',
          status: 'suspended'
        })
        await store.getNetworkState(networkId)
        canResume('enabling')
        nextProfileState('enabling', 'enable_request')
      }
    })

    const aggregated = aggregateRounds(name, rounds)
    logBenchmark(name, aggregated)
    assertPositiveMedian(aggregated)
  })
})
