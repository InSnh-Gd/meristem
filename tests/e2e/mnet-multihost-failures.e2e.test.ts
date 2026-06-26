import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mintLocalToken } from '../../packages/auth/src/index.ts'
import type { NetworkMapFromSchema } from '../../packages/contracts/src/schemas/mnet-profile.ts'
import {
  internalServicePorts,
  internalTokenHeaderName
} from '../../packages/internal-http/src/index.ts'
import { loadState } from '../../scripts/mnet-multihost-harness-support.ts'
import { DEFAULT_NETWORK_MAP_STALE_TTL_MS } from '../../services/m-net/src/network-map-renderer.ts'
import { evaluateNetworkMap } from '../../services/node-agent/src/node-agent-map-enforcement.ts'
import { startProcess } from '../helpers/process.ts'

type HarnessStatus = {
  readonly active: boolean
  readonly leafs: ReadonlyArray<{
    readonly id: string | null
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
  readonly map: NetworkMapFromSchema
}

type TaskSubmitResponse = {
  readonly task: {
    readonly id: string
    readonly status: string
  }
}

// 检测三主机能力
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
const harnessJwtSecret =
  process.env.MERISTEM_JWT_SECRET ?? 'mnet-multihost-harness-jwt-secret-32-chars'
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
    throw new Error(
      `request failed ${response.status} ${response.statusText}: ${await response.text()}`
    )
  }
  return (await response.json()) as T
}

async function fetchHarnessStatus(): Promise<HarnessStatus> {
  const status = await runHarnessJson<HarnessStatus>(['status'])
  expect(status.active).toBe(true)
  expect(status.leafs.length).toBeGreaterThanOrEqual(2)
  return status
}

async function fetchPrimaryNetworkId(joinedLeafIds: readonly string[]): Promise<string> {
  const body = await fetchJson<{ networks: NetworkSummary[] }>(
    `${mNetBaseUrl}/internal/v0/networks`,
    {
      headers: { [internalTokenHeaderName]: harnessInternalToken }
    }
  )

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

describe('M-Net multi-host failure and recovery e2e', () => {
  beforeAll(async () => {
    if (!capable || reusingActiveHarness) return
    const startProc = startProcess(['bun', 'run', 'scripts/mnet-multihost-harness.ts', 'start'])
    const startExit = await startProc.exited
    expect(startExit).toBe(0)
  }, 120_000)

  test.skipIf(!capable)(
    'stale signed network map evaluates fail-closed and fresh map evaluates apply',
    async () => {
      const status = await fetchHarnessStatus()
      const targetLeafId = status.leafs.find(leaf => leaf.id)?.id
      const joinedLeafIds = status.leafs.flatMap(leaf => (leaf.id ? [leaf.id] : []))
      const networkId = await fetchPrimaryNetworkId(joinedLeafIds)
      const mapBody = await fetchJson<NetworkMapResponse>(
        `${mNetBaseUrl}/internal/v0/networks/${encodeURIComponent(networkId)}/network-map`,
        { headers: { [internalTokenHeaderName]: harnessInternalToken } }
      )

      if (!targetLeafId) {
        throw new Error('no joined leaf node available for network map evaluation')
      }

      const freshDecision = evaluateNetworkMap({
        map: mapBody.map,
        agentNodeId: targetLeafId,
        expectedSigningKeyId: mapBody.map.signatureMetadata.keyId,
        expectedSigningPublicKey: mapBody.map.signatureMetadata.publicKey,
        nowMs: mapBody.map.expiresAt - 1,
        serverTime: new Date(mapBody.map.expiresAt - 1).toISOString()
      })
      expect(freshDecision.decision).toBe('apply')

      const staleDecision = evaluateNetworkMap({
        map: mapBody.map,
        agentNodeId: targetLeafId,
        expectedSigningKeyId: mapBody.map.signatureMetadata.keyId,
        expectedSigningPublicKey: mapBody.map.signatureMetadata.publicKey,
        nowMs: mapBody.map.expiresAt + DEFAULT_NETWORK_MAP_STALE_TTL_MS + 1,
        serverTime: new Date(
          mapBody.map.expiresAt + DEFAULT_NETWORK_MAP_STALE_TTL_MS + 1
        ).toISOString()
      })
      expect(staleDecision.decision).toBe('fail_closed')
      if (staleDecision.decision === 'fail_closed') {
        expect(staleDecision.reason).toBe('network_map.stale')
      }
    },
    120_000
  )

  test.skipIf(!capable)(
    'noop dispatch to an unknown node is rejected before execution',
    async () => {
      const securityAdminToken = await mintLocalToken({
        actor: 'security-admin',
        secret: harnessJwtSecret
      })

      await expect(
        fetchJson<TaskSubmitResponse>(`${mTaskBaseUrl}/api/v0/tasks`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${securityAdminToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ nodeId: 'missing-harness-node', type: 'noop' })
        })
      ).rejects.toThrow('request failed 500 Internal Server Error')
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
