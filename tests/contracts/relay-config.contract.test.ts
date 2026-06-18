import { beforeAll, describe, expect, it } from 'bun:test'

const MODULE_PATH = 'ops/nixos/module.nix'
const PROFILE_PATH = 'ops/nixos/profiles/meristem-full.nix'
const RUNBOOK_PATH = 'docs/operations/RUNBOOK.md'
const APISIX_PATH = 'ops/apisix/apisix.yaml'
const NIX_ENV_PATH = 'ops/nixos/meristem.env.example'
const ROOT_ENV_PATH = '.env.example'

type DocsFixture = {
  apisix: string
  module: string
  nixEnv: string
  profile: string
  rootEnv: string
  runbook: string
}

async function readText(path: string): Promise<string> {
  return Bun.file(path).text()
}

describe('relay deployment contract', () => {
  let fixture: DocsFixture

  beforeAll(async () => {
    const [module, profile, runbook, apisix, nixEnv, rootEnv] = await Promise.all([
      readText(MODULE_PATH),
      readText(PROFILE_PATH),
      readText(RUNBOOK_PATH),
      readText(APISIX_PATH),
      readText(NIX_ENV_PATH),
      readText(ROOT_ENV_PATH)
    ])

    fixture = { apisix, module, nixEnv, profile, rootEnv, runbook }
  })

  it('requires a public ACME hostname for the production relay host profile', () => {
    expect(fixture.profile).toMatch(/mode\s*=\s*"acme";/)
    expect(fixture.profile).toMatch(/publicHostname\s*=\s*"relay\.control-plane\.example\.com";/)
    expect(fixture.profile).not.toMatch(/publicHostname\s*=\s*"(?:localhost|127\.0\.0\.1|::1)";/)
    expect(fixture.module).toContain('relay.publicHostname must be a public ACME hostname')
    expect(fixture.module).toContain('[ "localhost" "127.0.0.1" "::1" ]')
  })

  it('pins the upstream wstunnel version and forbids floating latest references', () => {
    const pinnedVersionMatches = fixture.module.match(/relayWstunnelVersion = "(v\d+\.\d+\.\d+)";/)
    expect(pinnedVersionMatches?.[1]).toBe('v10.5.5')
    expect(fixture.profile).toContain('versionPin = "v10.5.5";')
    expect(fixture.runbook).toContain('pinned version | `v10.5.5`')
    expect(fixture.module).not.toContain('ghcr.io/erebe/wstunnel:latest')
    expect(fixture.profile).not.toContain('latest')
    expect(fixture.runbook).not.toContain('ghcr.io/erebe/wstunnel:latest')
  })

  it('includes the UDP-over-WSS relay command args for local WireGuard 51820', () => {
    expect(fixture.module).toContain(
      'wstunnel server wss://${relayCfg.listenAddress}:${toString relayCfg.publicPort}'
    )
    expect(fixture.module).toContain(
      '--restrict-to ${relayCfg.restrictHost}:${toString relayCfg.wireGuardPort}'
    )
    expect(fixture.module).toContain('protocol:')
    expect(fixture.module).toContain('- Udp')
    expect(fixture.module).toContain('wireGuardPort = lib.mkOption')
    expect(fixture.module).toContain('default = 51820;')
    expect(fixture.runbook).toContain('wstunnel server wss://[::]:443')
    expect(fixture.runbook).toContain('--restrict-to localhost:51820')
  })

  it('documents a local-development fallback with loopback-friendly defaults', () => {
    expect(fixture.module).toMatch(/type = lib\.types\.enum \[ "acme" "local-dev" \];/)
    expect(fixture.module).toMatch(/default = "local-dev";/)
    expect(fixture.module).toContain('/var/lib/meristem/certs/join-ingress-cert.pem')
    expect(fixture.module).toContain('/var/lib/meristem/certs/join-ingress-key.pem')
    expect(fixture.rootEnv).toContain('MERISTEM_RELAY_PUBLIC_HOSTNAME=localhost')
    expect(fixture.rootEnv).toContain('MERISTEM_RELAY_ENDPOINT=wss://localhost:443')
    expect(fixture.nixEnv).toContain('MERISTEM_RELAY_HEALTH_URL=http://127.0.0.1:19090/health')
  })

  it('keeps internal APIs private while exposing only join and relay public endpoints', () => {
    expect(fixture.apisix).toContain('uri: /join/v0/*')
    expect(fixture.apisix).toContain('# - /internal/v0/*')
    expect(fixture.apisix).not.toMatch(/^\s*uri:\s*\/internal\/v0\//m)
    expect(fixture.runbook).toContain('it must not expose `/internal/v0/*`')
    expect(fixture.runbook).toContain(
      'public deployment exposes `8443` for join ingress and `443` for the fallback relay'
    )
  })
})
