import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { NetworkMapFromSchema } from '../../../packages/contracts/src/schemas/mnet-profile.ts'
import { DEFAULT_NETWORK_MAP_SIGNING_KEY_ID } from '../../m-net/src/network-map-signing.ts'
import type { WireGuardKeyMaterial } from './node-agent-wireguard-keys.ts'
import {
  applyEnforcementDecision,
  type AgentEnforcementState,
  evaluateNetworkMap
} from './node-agent-map-enforcement.ts'
import {
  DEFAULT_WG_LISTEN_PORT,
  DEFAULT_WG_PRIVATE_KEY_PATH,
  DEFAULT_WSTUNNEL_UDP_BIND_HOST,
  DEFAULT_WSTUNNEL_UDP_BIND_PORT,
  computeConfigHash,
  renderWireGuardConfig
} from './node-agent-wg-config.ts'

export const DEFAULT_WG_INTERFACE_NAME = 'meristem-wg0'
export const DEFAULT_WG_CONFIG_PATH = '/run/meristem/wireguard/meristem-wg0.conf'
export const DEFAULT_WG_STATE_PATH = '/run/meristem/wireguard/state.json'

type CommandRunner = (command: readonly string[]) => Promise<void>

export type LocalOverlayPaths = {
  privateKeyPath: string
  configPath: string
  statePath: string
}

export type LocalOverlayEnv = {
  interfaceName: string
  listenPort: number
  localRelayEndpoint: string
  expectedSigningKeyId: string
  expectedSigningPublicKey?: string
  paths: LocalOverlayPaths
  commandRunner: CommandRunner
}

export type LocalOverlayApplied = {
  kind: 'applied'
  state: AgentEnforcementState
  configPath: string
  statePath: string
  configHash: string
  mapVersion: number
  localTunnelIp?: string
}

export type LocalOverlayTornDown = {
  kind: 'torn_down'
  state: AgentEnforcementState
  reason: string
}

export type LocalOverlayResult = LocalOverlayApplied | LocalOverlayTornDown

export function createInitialEnforcementState(networkId: string): AgentEnforcementState {
  return {
    status: 'idle',
    knownPeers: [],
    allowedPeers: [],
    partition: {
      networkId,
      state: 'connected',
      reason: { code: 'initial.connect', detail: 'node-agent bootstrapped local overlay state' },
      transitionedAt: new Date(0).toISOString(),
      previousState: null
    }
  }
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function loadLocalOverlayEnv(env: NodeJS.ProcessEnv = process.env): LocalOverlayEnv {
  const privateKeyPath = env.MERISTEM_HOST_PRIVATE_KEY_PATH ?? DEFAULT_WG_PRIVATE_KEY_PATH
  return {
    interfaceName: env.MERISTEM_WG_INTERFACE_NAME ?? DEFAULT_WG_INTERFACE_NAME,
    listenPort: parseNumberEnv(env.MERISTEM_WG_LISTEN_PORT, DEFAULT_WG_LISTEN_PORT),
    localRelayEndpoint:
      env.MERISTEM_WSTUNNEL_LOCAL_ENDPOINT ??
      `${DEFAULT_WSTUNNEL_UDP_BIND_HOST}:${parseNumberEnv(env.MERISTEM_WSTUNNEL_UDP_BIND_PORT, DEFAULT_WSTUNNEL_UDP_BIND_PORT)}`,
    expectedSigningKeyId: env.MERISTEM_MNET_SIGNING_KEY_ID ?? DEFAULT_NETWORK_MAP_SIGNING_KEY_ID,
    ...(env.MERISTEM_MNET_SIGNING_PUBLIC_KEY
      ? { expectedSigningPublicKey: env.MERISTEM_MNET_SIGNING_PUBLIC_KEY }
      : {}),
    paths: {
      privateKeyPath,
      configPath: env.MERISTEM_WG_CONFIG_PATH ?? DEFAULT_WG_CONFIG_PATH,
      statePath: env.MERISTEM_WG_STATE_PATH ?? DEFAULT_WG_STATE_PATH
    },
    commandRunner: async command => {
      const result = Bun.spawnSync([...command], { stdout: 'pipe', stderr: 'pipe' })
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString().trim()
        throw new Error(stderr.length > 0 ? stderr : `${command.join(' ')} failed`)
      }
    }
  }
}

async function writeOverlayState(
  paths: LocalOverlayPaths,
  keyMaterial: WireGuardKeyMaterial,
  config: string,
  state: AgentEnforcementState,
  configHash: string
): Promise<void> {
  await mkdir(dirname(paths.privateKeyPath), { recursive: true })
  await mkdir(dirname(paths.configPath), { recursive: true })
  await mkdir(dirname(paths.statePath), { recursive: true })
  await Promise.all([
    writeFile(paths.privateKeyPath, `${keyMaterial.privateKey}\n`, { mode: 0o600 }),
    writeFile(paths.configPath, `${config}\n`, { mode: 0o600 }),
    writeFile(
      paths.statePath,
      `${JSON.stringify(
        {
          currentMapVersion: state.currentMapVersion ?? null,
          currentSigningKeyId: state.currentSigningKeyId ?? null,
          localTunnelIp: state.localTunnelIp ?? null,
          knownPeers: state.knownPeers,
          allowedPeers: state.allowedPeers,
          relayAssignment: state.relayAssignment ?? null,
          status: state.status,
          partition: state.partition,
          configHash,
          keyId: keyMaterial.keyId,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    )
  ])
}

async function ensureWireGuardInterface(
  env: LocalOverlayEnv,
  localTunnelIp: string,
  configPath: string
): Promise<void> {
  try {
    await env.commandRunner(['ip', 'link', 'show', 'dev', env.interfaceName])
  } catch {
    await env.commandRunner(['ip', 'link', 'add', 'dev', env.interfaceName, 'type', 'wireguard'])
  }

  await env.commandRunner(['wg', 'setconf', env.interfaceName, configPath])
  await env.commandRunner([
    'ip',
    'address',
    'replace',
    `${localTunnelIp}/32`,
    'dev',
    env.interfaceName
  ])
  await env.commandRunner(['ip', 'link', 'set', 'up', 'dev', env.interfaceName])
}

async function tearDownWireGuardInterface(env: LocalOverlayEnv): Promise<void> {
  try {
    await env.commandRunner(['ip', 'link', 'delete', 'dev', env.interfaceName])
  } catch {
    // interface already absent: fail-closed teardown is satisfied
  }

  await Promise.allSettled([
    rm(env.paths.configPath, { force: true }),
    rm(env.paths.statePath, { force: true })
  ])
}

export async function reconcileLocalOverlay(input: {
  env: LocalOverlayEnv
  map: NetworkMapFromSchema
  agentNodeId: string
  keyMaterial: WireGuardKeyMaterial
  currentState: AgentEnforcementState
  nowMs?: number
  serverTime?: string
}): Promise<LocalOverlayResult> {
  const evaluation = evaluateNetworkMap({
    map: input.map,
    agentNodeId: input.agentNodeId,
    expectedSigningKeyId: input.env.expectedSigningKeyId,
    ...(input.env.expectedSigningPublicKey
      ? { expectedSigningPublicKey: input.env.expectedSigningPublicKey }
      : {}),
    nowMs: input.nowMs ?? Date.now(),
    serverTime: input.serverTime ?? new Date().toISOString(),
    ...(input.currentState.currentMapVersion === undefined
      ? {}
      : { previousMapVersion: input.currentState.currentMapVersion })
  })

  const nextState = applyEnforcementDecision(evaluation, input.currentState)
  if (evaluation.decision !== 'apply' || !nextState.localTunnelIp) {
    await tearDownWireGuardInterface(input.env)
    return {
      kind: 'torn_down',
      state: nextState,
      reason:
        evaluation.decision === 'apply' ? 'network_map.local_member_missing' : evaluation.reason
    }
  }

  const rendered = renderWireGuardConfig({
    map: input.map,
    agentNodeId: input.agentNodeId,
    listenPort: input.env.listenPort,
    privateKeyPath: input.env.paths.privateKeyPath,
    localRelayEndpoint: input.env.localRelayEndpoint
  })
  if (!rendered.ok) {
    await tearDownWireGuardInterface(input.env)
    return {
      kind: 'torn_down',
      state: nextState,
      reason: rendered.error.kind
    }
  }

  const configHash = computeConfigHash(rendered.value.config)
  await writeOverlayState(
    input.env.paths,
    input.keyMaterial,
    rendered.value.config,
    nextState,
    configHash
  )
  await ensureWireGuardInterface(input.env, nextState.localTunnelIp, input.env.paths.configPath)

  return {
    kind: 'applied',
    state: nextState,
    configPath: input.env.paths.configPath,
    statePath: input.env.paths.statePath,
    configHash,
    mapVersion: evaluation.mapVersion,
    localTunnelIp: nextState.localTunnelIp
  }
}
