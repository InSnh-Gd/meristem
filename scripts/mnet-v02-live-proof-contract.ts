import type { DeployProofReport } from './v02-deploy-proof.ts'

export type LiveProofVerdict = 'pass' | 'prerequisite-missing' | 'failure'
export type ProbeKind = 'tcp' | 'icmp'
export type ProofResult =
  | { readonly status: 'success'; readonly step: string; readonly detail: string }
  | {
      readonly status: 'prerequisite-missing'
      readonly step: string
      readonly code: string
      readonly message: string
      readonly detail?: string
    }
  | {
      readonly status: 'failure'
      readonly step: string
      readonly code: string
      readonly message: string
      readonly detail?: string
    }

export type HostCapabilities = {
  readonly docker: boolean
  readonly netbird: boolean
  readonly netAdmin: boolean
  readonly tcpProbe: boolean
  readonly icmpProbe: boolean
}

export type StartedNodeAgent = {
  readonly host: 'node-a' | 'node-b'
  readonly nodeId: string
  readonly pid: number
}

export type PacketReachabilityEvidence =
  | {
      readonly status: 'success'
      readonly probe: ProbeKind
      readonly source: 'node-a'
      readonly target: 'node-b'
      readonly targetOverlayIp: string
      readonly detail: string
    }
  | {
      readonly status: 'failure'
      readonly probe?: ProbeKind
      readonly source: 'node-a'
      readonly target: 'node-b'
      readonly targetOverlayIp?: string
      readonly detail: string
    }
  | { readonly status: 'not-run'; readonly detail: string }

export type MNetV02LiveProofReport = {
  readonly proof: 'mnet-v02-live-proof'
  readonly topology: ['control', 'node-a', 'node-b']
  readonly oidc: 'keycloak'
  readonly profileVersion: 'm-net@0.3.0'
  readonly deployProof?: DeployProofReport
  readonly keycloakTokenVerification: {
    readonly status: 'success' | 'failure' | 'not-run'
    readonly detail: string
  }
  readonly profileEnable: {
    readonly status: 'success' | 'failure' | 'not-run'
    readonly detail: string
    readonly networkId?: string
  }
  readonly nodeAgentJoin: ReadonlyArray<{
    readonly host: 'node-a' | 'node-b'
    readonly status: 'success' | 'failure' | 'not-run'
    readonly detail: string
    readonly nodeId?: string
  }>
  readonly netbirdProcessHealth: ReadonlyArray<{
    readonly host: 'node-a' | 'node-b'
    readonly status: 'healthy' | 'degraded' | 'not-run'
    readonly detail: string
  }>
  readonly packetReachability: PacketReachabilityEvidence
  readonly results: readonly ProofResult[]
  readonly releaseSuccess: boolean
  readonly verdict: LiveProofVerdict
}
