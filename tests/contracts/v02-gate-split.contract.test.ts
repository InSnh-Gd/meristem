import { describe, expect, it } from 'bun:test'

async function readText(path: string): Promise<string> {
  return await Bun.file(path).text()
}

type PackageScripts = {
  readonly scripts?: Record<string, string>
}

describe('v0.2 gate split contract', () => {
  it('keeps deterministic gates separate from the release live proof path', async () => {
    const packageJson = await readText('package.json')
    const releaseNotes = await readText('docs/releases/MERISTEM-V02-RELEASE-NOTES.md')
    const parsed = JSON.parse(packageJson) as PackageScripts
    const gateScript = parsed.scripts?.['test:v02-gates']
    const releaseScript = parsed.scripts?.['test:v02-release']

    expect(gateScript).toBeDefined()
    expect(releaseScript).toBeDefined()
    expect(gateScript).toContain('bun install --frozen-lockfile')
    expect(gateScript).toContain('bun run test:agent-submit')
    expect(gateScript).not.toContain('mnet:v02:live-proof')
    expect(releaseScript).toContain('bun run test:v02-gates')
    expect(releaseScript).toContain('bun run mnet:v02:live-proof --topology=three-host --oidc=keycloak')

    expect(releaseNotes).toContain('bun run test:v02-gates')
    expect(releaseNotes).toContain('bun run test:v02-release')
    expect(releaseNotes).toContain('bun run mnet:v02:live-proof --topology=three-host --oidc=keycloak')
    expect(releaseNotes).toContain('Typed `prerequisite-missing` is not release success')
  })
})
