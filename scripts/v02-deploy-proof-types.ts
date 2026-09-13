/**
 * v02 deploy proof 的共享类型与端口契约（从 v02-deploy-proof.ts 拆出，行为不变）。
 */
import type {
  loadRuntimeDeploymentConfig,
  RuntimeDeploymentConfig
} from '../packages/config/src/index.ts'
import type { KeycloakDevRealmResult, KeycloakRealmState } from './keycloak-dev-realm.ts'
export type DeployTarget = 'nixos' | 'oci'
export type DeployAuthMode = 'oidc' | 'local-dev'
export type DeployVerdict = 'pass' | 'prerequisite-missing' | 'failure'

export type SuccessResult = {
  readonly status: 'success'
  readonly step: string
  readonly detail: string
}

export type PrerequisiteMissingResult = {
  readonly status: 'prerequisite-missing'
  readonly step: string
  readonly code: string
  readonly message: string
  readonly detail?: string
}

export type FailureResult = {
  readonly status: 'failure'
  readonly step: string
  readonly code: string
  readonly message: string
  readonly detail?: string
}

export type DeployProofResult = SuccessResult | PrerequisiteMissingResult | FailureResult

export type ServiceEvidence = {
  readonly status: 'ready' | 'reused' | 'started' | 'restarted' | 'prerequisite-missing' | 'failure'
  readonly detail: string
  readonly endpoint?: string
  readonly logFile?: string
  readonly pid?: number
}

export type ManagedServiceName =
  | 'postgres'
  | 'nats'
  | 'keycloak'
  | 'm-eventbus'
  | 'm-policy'
  | 'm-log'
  | 'm-net'
  | 'm-task'
  | 'm-extension'
  | 'core'
  | 'm-ui-bff'
  | 'node-agent'

export type ManagedServiceState = {
  readonly logFile: string
  readonly pid: number
  readonly startedAt: string
}

export type StoredState = {
  readonly services: Partial<Record<ManagedServiceName, ManagedServiceState>>
}

export type ManagedServiceDefinition = {
  readonly name: Exclude<ManagedServiceName, 'postgres' | 'nats' | 'keycloak' | 'node-agent'>
  readonly command: readonly string[]
  readonly readinessKey: keyof RuntimeDeploymentConfig['raw']['readiness']
}

export type JoinTicketResult =
  | { readonly ok: true; readonly ticket: string }
  | { readonly ok: false; readonly result: FailureResult }

export type ProofPaths = {
  readonly deploymentConfigPath: string
  readonly logDir: string
  readonly runtimeStatePath: string
  readonly stateFile: string
  readonly workspaceDir: string
}

export type PreparedContext = {
  readonly authMode: DeployAuthMode
  readonly keycloakRealm: KeycloakRealmState
  readonly paths: ProofPaths
  readonly runtimeConfig: RuntimeDeploymentConfig
  readonly sharedEnv: Record<string, string>
  readonly target: DeployTarget
}

export type DeployProofReport = {
  readonly auth: {
    readonly mode: DeployAuthMode
    readonly keycloakDiscoveryUrl: string
    readonly keycloakJwksUrl: string
    readonly provider: RuntimeDeploymentConfig['auth']['provider']
  }
  readonly deploymentConfigPath: string
  readonly proof: string
  readonly results: readonly DeployProofResult[]
  readonly secretProvider: {
    readonly backend: RuntimeDeploymentConfig['secretProvider']['backend']
    readonly providerName: string
  }
  readonly services: Partial<Record<ManagedServiceName, ServiceEvidence>>
  readonly target: DeployTarget
  readonly verdict: DeployVerdict
}

export type DeployProofDeps = {
  ensureKeycloakDevRealm: () => Promise<KeycloakDevRealmResult>
  hasCapNetAdmin: () => boolean
  isPidAlive: (pid: number) => boolean
  killPid: (pid: number) => void
  loadRuntimeDeploymentConfig: (
    env: NodeJS.ProcessEnv,
    readTextFile: (path: string) => Promise<string>
  ) => ReturnType<typeof loadRuntimeDeploymentConfig>
  now: () => Date
  postgresReady: (databaseUrl: string) => Promise<boolean>
  prepareInfra: () => Promise<void>
  prepareWorkspace: () => Promise<void>
  probeReadyEndpoint: (url: string, internalToken?: string) => Promise<boolean>
  readTextFile: (path: string) => Promise<string>
  runVersionCommand: (command: readonly string[]) => {
    readonly exitCode: number
    readonly stderr: string
    readonly stdout: string
  }
  sleep: (ms: number) => Promise<void>
  startDetached: (
    command: readonly string[],
    logFile: string,
    env: Record<string, string>
  ) => number
  writeTextFile: (path: string, contents: string) => Promise<void>
  natsReady: (natsUrl: string) => Promise<boolean>
}
