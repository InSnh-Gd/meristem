import { describe, expect, it } from 'bun:test'
import { runMNetV02LiveProof } from '../../scripts/mnet-v02-live-proof.ts'

async function readText(path: string): Promise<string> {
  return await Bun.file(path).text()
}

describe('m-net v0.2 live proof harness contract', () => {
  it('publishes the three-host live proof CLI through package.json', async () => {
    const [script, packageJson] = await Promise.all([
      readText('scripts/mnet-v02-live-proof.ts'),
      readText('package.json')
    ])

    expect(script).toContain("topology: ['control', 'node-a', 'node-b']")
    expect(script).toContain("profileVersion: 'm-net@0.3.0'")
    expect(script).toContain('packetReachability')
    expect(script).toContain('prerequisite-missing')
    expect(script).toContain('runV02DeployProof')
    expect(script).not.toContain('NetBird Management')
    expect(packageJson).toContain('"mnet:v02:live-proof": "bun run scripts/mnet-v02-live-proof.ts"')
  })

  it('returns typed prerequisite-missing when live host capabilities are unavailable', async () => {
    const report = await runMNetV02LiveProof(
      {
        argv: ['bun', 'scripts/mnet-v02-live-proof.ts', '--topology=three-host', '--oidc=keycloak']
      },
      {
        detectHostCapabilities: async () => ({
          docker: false,
          netbird: false,
          netAdmin: false,
          tcpProbe: false,
          icmpProbe: false
        })
      }
    )

    expect(report.verdict).toBe('prerequisite-missing')
    expect(report.releaseSuccess).toBe(false)
    expect(report.topology).toEqual(['control', 'node-a', 'node-b'])
    expect(report.results.some(result => result.status === 'prerequisite-missing')).toBe(true)
    expect(report.packetReachability.status).toBe('not-run')
  })

  it('rejects unsupported topology or OIDC mode as failure rather than prerequisite success', async () => {
    const report = await runMNetV02LiveProof({
      argv: ['bun', 'scripts/mnet-v02-live-proof.ts', '--topology=two-host', '--oidc=local-dev']
    })

    expect(report.verdict).toBe('failure')
    expect(report.releaseSuccess).toBe(false)
    expect(report.results.map(result => result.status)).toEqual(['failure', 'failure'])
  })
})
