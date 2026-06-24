import { join } from 'node:path'

export const DEFAULT_JOIN_URL = 'wss://localhost:8443/join/v0/session'
export const DEFAULT_RELAY_ENDPOINT = 'wss://relay.control-plane.example.com:443'
export const DEFAULT_ACME_DIRECTORY = 'https://acme-v02.api.letsencrypt.org/directory'
export const DEFAULT_CONFIG_DIR = '/etc/meristem/node-agent'
export const DEFAULT_RUNTIME_STATE_PATH = '/var/lib/meristem/node-agent/runtime.json'
export const DEFAULT_WG_BINARY_PATH = 'wg'
export const DEFAULT_WSTUNNEL_BINARY_PATH = '/run/current-system/sw/bin/wstunnel'
export const DEFAULT_SERVICE_UNIT = 'meristem-node-agent.service'
export const DEFAULT_SERVICE_NAME = 'meristem-node-agent'
export const DEFAULT_AGENT_VERSION = '0.1.0'

const ENV_FILE_NAME = 'node-agent.env'
const JOIN_TICKET_FILE_NAME = 'join-ticket'
const NODE_ID_FILE_NAME = 'node-id'
const RUNTIME_TOKEN_FILE_NAME = 'runtime-token'
const ACME_ACCOUNT_KEY_FILE_NAME = 'tls/account.key'
const WIREGUARD_PRIVATE_KEY_FILE_NAME = 'wg/private.key'
const WIREGUARD_PUBLIC_KEY_FILE_NAME = 'wg/private.key.pub'
const WIREGUARD_METADATA_FILE_NAME = 'wg/private.key.meta.json'

export type NodeRole = 'stem' | 'leaf'

export type FileUpdate = {
  readonly path: string
  readonly action: 'created' | 'updated' | 'removed' | 'kept'
}

export type LifecycleConfig = {
  readonly configDir: string
  readonly runtimeStatePath: string
  readonly serviceName: string
  readonly serviceUnitPath: string
  readonly joinTicketPath: string
  readonly nodeIdPath: string
  readonly runtimeTokenPath: string
  readonly envFilePath: string
  readonly acmeAccountKeyPath: string
  readonly wireGuardPrivateKeyPath: string
  readonly wireGuardPublicKeyPath: string
  readonly wireGuardMetadataPath: string
}

export type InstallInput = {
  readonly kind: NodeRole
  readonly name: string
  readonly joinUrl: string
  readonly relayEndpoint: string
  readonly wgBinaryPath: string
  readonly wstunnelBinaryPath: string
  readonly acmeDirectory: string
  readonly joinTicket?: string | undefined
  readonly rotateWireGuardKey: boolean
  readonly rotateAcmeAccountKey: boolean
}

export type UpgradeInput = {
  readonly joinUrl?: string | undefined
  readonly relayEndpoint?: string | undefined
  readonly wgBinaryPath?: string | undefined
  readonly wstunnelBinaryPath?: string | undefined
  readonly acmeDirectory?: string | undefined
  readonly joinTicket?: string | undefined
  readonly rotateRuntimeToken: boolean
  readonly rotateWireGuardKey: boolean
  readonly rotateAcmeAccountKey: boolean
}

export function requireNodeRole(value: string): NodeRole {
  if (value !== 'stem' && value !== 'leaf') {
    throw new Error('--kind must be stem or leaf')
  }
  return value
}

export function resolveLifecycleConfig(configDir: string, runtimeStatePath: string): LifecycleConfig {
  const normalizedConfigDir = configDir.replace(/\/$/, '') || '/'
  return {
    configDir: normalizedConfigDir,
    runtimeStatePath,
    serviceName: DEFAULT_SERVICE_NAME,
    serviceUnitPath: `/etc/systemd/system/${DEFAULT_SERVICE_UNIT}`,
    joinTicketPath: join(normalizedConfigDir, JOIN_TICKET_FILE_NAME),
    nodeIdPath: join(normalizedConfigDir, NODE_ID_FILE_NAME),
    runtimeTokenPath: join(normalizedConfigDir, RUNTIME_TOKEN_FILE_NAME),
    envFilePath: join(normalizedConfigDir, ENV_FILE_NAME),
    acmeAccountKeyPath: join(normalizedConfigDir, ACME_ACCOUNT_KEY_FILE_NAME),
    wireGuardPrivateKeyPath: join(normalizedConfigDir, WIREGUARD_PRIVATE_KEY_FILE_NAME),
    wireGuardPublicKeyPath: join(normalizedConfigDir, WIREGUARD_PUBLIC_KEY_FILE_NAME),
    wireGuardMetadataPath: join(normalizedConfigDir, WIREGUARD_METADATA_FILE_NAME)
  }
}
