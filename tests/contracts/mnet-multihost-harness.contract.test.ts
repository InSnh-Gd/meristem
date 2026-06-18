import { beforeAll, describe, expect, it } from 'bun:test'

type ContractFixture = {
  readonly flake: string
  readonly nodeAgentDoc: string
  readonly optionalPack: string
  readonly packageJson: string
  readonly runbook: string
}

async function readText(path: string): Promise<string> {
  return await Bun.file(path).text()
}

describe('multi-host harness contract', () => {
  let fixture: ContractFixture

  beforeAll(async () => {
    const [flake, nodeAgentDoc, optionalPack, packageJson, runbook] = await Promise.all([
      readText('flake.nix'),
      readText('docs/services/node-agent.md'),
      readText('docs/operations/OPTIONAL-DEPLOYMENT-PACK.md'),
      readText('package.json'),
      readText('docs/operations/RUNBOOK.md')
    ])

    fixture = { flake, nodeAgentDoc, optionalPack, packageJson, runbook }
  })

  it('exports the node-agent NixOS module and profile through the root flake', () => {
    expect(fixture.flake).toContain(
      'nixosModules.meristem-node-agent = import ./ops/nixos/node-agent-module.nix;'
    )
    expect(fixture.flake).toContain(
      'nixosModules.meristem-node-agent-profile = import ./ops/nixos/profiles/meristem-node-agent.nix;'
    )
  })

  it('documents node-agent file paths under /etc/meristem/node-agent', () => {
    expect(fixture.nodeAgentDoc).toContain('/etc/meristem/node-agent/node-agent.env')
    expect(fixture.nodeAgentDoc).toContain('/etc/meristem/node-agent/join-ticket')
    expect(fixture.nodeAgentDoc).toContain('/etc/meristem/node-agent/runtime-token')
    expect(fixture.nodeAgentDoc).toContain('/etc/meristem/node-agent/wg/private.key')
  })

  it('documents the reduced capability set and WireGuard preflight behavior', () => {
    expect(fixture.nodeAgentDoc).toContain('CAP_NET_ADMIN')
    expect(fixture.nodeAgentDoc).toContain('/sys/module/wireguard')
    expect(fixture.nodeAgentDoc).toContain('ip link add ... type wireguard')
    expect(fixture.nodeAgentDoc).not.toContain('| `CAP_SYS_ADMIN` |')
  })

  it('publishes exact multi-host harness scripts through package.json and the runbook', () => {
    expect(fixture.packageJson).toContain(
      '"mnet:harness:preflight": "bun run scripts/mnet-multihost-harness.ts preflight"'
    )
    expect(fixture.packageJson).toContain(
      '"mnet:harness:start": "bun run scripts/mnet-multihost-harness.ts start"'
    )
    expect(fixture.packageJson).toContain(
      '"mnet:harness:reset": "bun run scripts/mnet-multihost-harness.ts reset"'
    )
    expect(fixture.runbook).toContain('bun run mnet:harness:preflight')
    expect(fixture.runbook).toContain('bun run mnet:harness:start')
  })

  it('documents the local leaf-container limitation instead of claiming split M-* runtime', () => {
    expect(fixture.runbook).toContain('control host still runs on the local machine')
    expect(fixture.runbook).toContain(
      'isolates only the two Leaf hosts with Docker bridge networking'
    )
    expect(fixture.optionalPack).toContain(
      'control-plane and relay stay co-located on the local control host'
    )
  })
})
