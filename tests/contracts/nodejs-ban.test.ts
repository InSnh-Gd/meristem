import { describe, expect, it } from 'bun:test'
import { collectNodeJsUsageFindings } from '../../scripts/nodejs-ban.ts'

describe('nodejs ban', () => {
  it('finds no Node.js runtime or node:* API usage in tracked source', async () => {
    const findings = await collectNodeJsUsageFindings(process.cwd())
    expect(findings).toEqual([])
  })

  it('does not declare the Node/Bun TCP transport package anymore', async () => {
    const packageJson = await Bun.file('package.json').json() as {
      dependencies?: Record<string, string>
    }
    expect(packageJson.dependencies?.['@nats-io/transport-node']).toBeUndefined()
  })
})
