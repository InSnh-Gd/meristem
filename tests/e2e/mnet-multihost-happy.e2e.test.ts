import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { internalServicePorts, internalTokenHeaderName } from '../../packages/internal-http/src/index.ts'
import { loadState } from '../../scripts/mnet-multihost-harness-support.ts'
import { startProcess } from '../helpers/process.ts'

type HarnessStatus = {
  readonly active: boolean
  readonly leafs: ReadonlyArray<{
    readonly id: string | null
    readonly leafName: string
    readonly status: string | null
  }>
}

type NetworkSummary = {
  readonly id: string
  readonly memberCount: number
}

type NetworkMember = {
  readonly nodeId: string
}

type NetworkMapResponse = {
  readonly map: {
    readonly members: ReadonlyArray<{
      readonly nodeId: string
      readonly tunnelIp: string
    }>
    readonly relayAssignment?: {
      readonly nodeIds: ReadonlyArray<string>
      readonly relayEndpoint: string
    }
    readonly signatureMetadata: {
      readonly algorithm: string
      readonly keyId: string
      readonly publicKey: string
      readonly value: string
    }
  }
}

type TaskSubmitResponse = {
  readonly task: {
    readonly id: string
    readonly nodeId: string
    readonly status: string
  }
}

// 检测三主机能力：Docker + WireGuard
async function checkCapability(): Promise<boolean> {
  try {
    const proc = startProcess(['bun', 'run', 'scripts/mnet-multihost-harness.ts', 'preflight'])
    const exitCode = await proc.exited
    return exitCode === 0
  } catch {
    return false
  }
}

const reusingActiveHarness = loadState() !== null
const capable = reusingActiveHarness || (await checkCapability())
const harnessInternalToken =
  process.env.MERISTEM_INTERNAL_TOKEN ?? 'mnet-multihost-harness-internal-token'
const mNetBaseUrl = `http://127.0.0.1:${internalServicePorts['m-net']}`
const mTaskBaseUrl = `http://127.0.0.1:${internalServicePorts['m-task']}`

async function runHarnessJson<T>(args: readonly string[]): Promise<T> {
  const proc = startProcess(['bun', 'run', 'scripts/mnet-multihost-harness.ts', ...args])
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`harness command ${args.join(' ')} failed:\n${proc.stderr || proc.stdout}`)
  }
  return JSON.parse(proc.stdout) as T
}

async function fetchJson<T>(input: string | URL | Request, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  if (!response.ok) {
    throw new Error(`request failed ${response.status} ${response.statusText}: ${await response.text()}`)
  }
  return (await response.json()) as T
}

function requireOperatorToken(): string {
  const operatorToken = loadState()?.operatorToken
  if (!operatorToken) {
    throw new Error('multi-host harness state missing operator token')
  }
  return operatorToken
}

async function fetchActiveHarnessStatus(): Promise<HarnessStatus> {
  const status = await runHarnessJson<HarnessStatus>(['status'])
  expect(status.active).toBe(true)
  expect(status.leafs.length).toBeGreaterThanOrEqual(2)
  expect(status.leafs.every(leaf => leaf.status === 'healthy')).toBe(true)
  return status
}

async function fetchPrimaryNetworkId(joinedLeafIds: readonly string[]): Promise<string> {
  const body = await fetchJson<{ networks: NetworkSummary[] }>(`${mNetBaseUrl}/internal/v0/networks`, {
    headers: { [internalTokenHeaderName]: harnessInternalToken }
  })

  for (const network of body.networks) {
    const members = await fetchJson<{ members: NetworkMember[] }>(
      `${mNetBaseUrl}/internal/v0/networks/${encodeURIComponent(network.id)}/members`,
      { headers: { [internalTokenHeaderName]: harnessInternalToken } }
    )
    const memberIds = members.members.map(member => member.nodeId)
    if (joinedLeafIds.every(nodeId => memberIds.includes(nodeId))) {
      return network.id
    }
  }

  const target = body.networks.find(network => network.memberCount >= 2) ?? body.networks[0]
  if (!target) {
    throw new Error('no M-Net network found during multi-host harness run')
  }
  return target.id
}

describe('M-Net multi-host happy path e2e', () => {
  beforeAll(async () => {
    if (!capable || reusingActiveHarness) return
    const startProc = startProcess(['bun', 'run', 'scripts/mnet-multihost-harness.ts', 'start'])
    const startExit = await startProc.exited
    expect(startExit).toBe(0)
  }, 120_000)

  test.skipIf(!capable)(
    'publishes a signed network map covering the joined leaf nodes',
    async () => {
      const status = await fetchActiveHarnessStatus()
      const joinedLeafIds = status.leafs.flatMap(leaf => (leaf.id ? [leaf.id] : []))
      const networkId = await fetchPrimaryNetworkId(joinedLeafIds)
      const members = await fetchJson<{ members: NetworkMember[] }>(
        `${mNetBaseUrl}/internal/v0/networks/${encodeURIComponent(networkId)}/members`,
        { headers: { [internalTokenHeaderName]: harnessInternalToken } }
      )
      const map = await fetchJson<NetworkMapResponse>(
        `${mNetBaseUrl}/internal/v0/networks/${encodeURIComponent(networkId)}/network-map`,
        { headers: { [internalTokenHeaderName]: harnessInternalToken } }
      )

      expect(joinedLeafIds.length).toBeGreaterThanOrEqual(2)
      expect(members.members.map(member => member.nodeId)).toEqual(
        expect.arrayContaining(joinedLeafIds)
      )
      expect(map.map.members.map(member => member.nodeId)).toEqual(
        expect.arrayContaining(joinedLeafIds)
      )
      expect(map.map.members.every(member => member.tunnelIp.startsWith('100.'))).toBe(true)
      expect(map.map.relayAssignment?.nodeIds ?? []).toEqual(expect.arrayContaining(joinedLeafIds))
      expect(map.map.relayAssignment?.relayEndpoint).toMatch(/^https:\/\//)
      expect(map.map.signatureMetadata.algorithm).toBe('ed25519')
      expect(map.map.signatureMetadata.keyId.length).toBeGreaterThan(0)
      expect(map.map.signatureMetadata.publicKey.length).toBeGreaterThan(0)
      expect(map.map.signatureMetadata.value.length).toBeGreaterThan(20)
    },
    120_000
  )

  test.skipIf(!capable)(
    'M-Task noop dispatch reaches active leaf agent',
    async () => {
      const status = await fetchActiveHarnessStatus()
      const operatorToken = requireOperatorToken()
      const targetLeafId = status.leafs.find(leaf => leaf.id && leaf.status === 'healthy')?.id

      if (!targetLeafId) {
        throw new Error('no healthy joined leaf available for noop dispatch')
      }

      const submitted = await fetchJson<TaskSubmitResponse>(`${mTaskBaseUrl}/api/v0/tasks`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${operatorToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ nodeId: targetLeafId, type: 'noop' })
      })

      expect(submitted.task.nodeId).toBe(targetLeafId)
      expect(submitted.task.status).toBe('completed')

      const fetched = await fetchJson<TaskSubmitResponse>(
        `${mTaskBaseUrl}/api/v0/tasks/${encodeURIComponent(submitted.task.id)}`,
        {
          headers: { authorization: `Bearer ${operatorToken}` }
        }
      )
      expect(fetched.task.id).toBe(submitted.task.id)
      expect(fetched.task.status).toBe('completed')
    },
    60_000
  )

  test.skipIf(capable)(
    'skipped: three-host capability unavailable (requires Docker + WireGuard/CAP_NET_ADMIN)',
    () => {
      expect(true).toBe(true)
    }
  )

  afterAll(async () => {
    if (!capable || reusingActiveHarness) return
    const resetProc = startProcess(['bun', 'run', 'scripts/mnet-multihost-harness.ts', 'reset'])
    await resetProc.exited
  })
})
