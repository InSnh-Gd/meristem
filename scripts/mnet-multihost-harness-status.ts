import type { HarnessStatus } from './mnet-multihost-harness-contract.ts'
import { harnessRuntime } from './mnet-multihost-harness-runtime.ts'

const { controlReadyUrl, fetchJson, isPidAlive, loadState, nodeListUrl, toNodeRecords } =
  harnessRuntime

/** 汇总持久化进程与控制面数据，返回当前多主机 Harness 运行快照。 */
export async function readHarnessStatus(): Promise<HarnessStatus> {
  const state = loadState()
  if (!state) {
    return {
      active: false,
      controlPlane: { ready: false, url: controlReadyUrl },
      issue: {
        ok: false,
        code: 'harness.not_started',
        message: 'multi-host harness state is absent',
        hint: 'Run bun run mnet:harness:start before requesting harness status.'
      },
      leafs: [],
      logFiles: [],
      relay: { endpoint: null, healthUrl: null, ready: false }
    }
  }

  let controlReady = false
  try {
    const ready = await fetchJson(controlReadyUrl)
    controlReady = Boolean(
      ready && typeof ready === 'object' && 'ready' in ready && ready.ready === true
    )
  } catch {
    controlReady = false
  }

  let relayReady = false
  const relayProcessAlive = isPidAlive(state.relay.pid)
  try {
    const relayResponse = await fetch(state.relay.healthUrl)
    relayReady = relayProcessAlive && relayResponse.ok
  } catch {
    relayReady = false
  }

  const serviceProcessesAlive = state.services.every(service => isPidAlive(service.pid))
  let nodeRecords: ReturnType<typeof toNodeRecords> = []
  try {
    const nodes = await fetchJson(nodeListUrl, {
      headers: { authorization: `Bearer ${state.operatorToken}` }
    })
    nodeRecords = toNodeRecords(nodes)
  } catch {
    nodeRecords = []
  }

  const leafs = state.leafs.map(leaf => {
    const found = nodeRecords.find(node => node.name === leaf.leafName)
    return {
      found: found !== undefined,
      id: found?.id ?? null,
      kind: found?.kind ?? null,
      leafName: leaf.leafName,
      logFile: leaf.logFile,
      status: found?.status ?? null
    }
  })

  return {
    active: relayProcessAlive && serviceProcessesAlive,
    controlPlane: { ready: controlReady, url: controlReadyUrl },
    leafs,
    logFiles: [
      state.relay.logFile,
      ...state.services.map(service => service.logFile),
      ...state.leafs.map(leaf => leaf.logFile)
    ],
    relay: {
      endpoint: state.relay.relayEndpoint,
      healthUrl: state.relay.healthUrl,
      ready: relayReady
    }
  }
}
