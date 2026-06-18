import { describe, expect, it } from 'bun:test'
import { createCliRunner } from '../../apps/m-cli/src/cli.ts'
import {
  extensionPermission,
  type MExtensionManifestV01,
  mExtensionManifestVersion
} from '../../packages/contracts/src/index.ts'

const manifest: MExtensionManifestV01 = {
  id: 'extension-cli-demo',
  manifestVersion: mExtensionManifestVersion,
  displayName: 'CLI Demo',
  kind: 'metadata-only',
  owner: 'meristem',
  license: 'Apache-2.0',
  declaredCapabilities: ['metadata.registry'],
  requestedPermissions: [extensionPermission.read],
  riskClass: 'low',
  lifecycleStatus: 'active',
  controlPlaneOnly: true
}

describe('extension CLI commands', () => {
  it('routes list/show/enable/disable to M-Extension client methods', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async listExtensions() {
        calls.push('extension:list')
        return { extensions: [] }
      },
      async getExtension(id) {
        calls.push(`extension:show:${id}`)
        return { definition: { id } } as never
      },
      async enableExtension(id) {
        calls.push(`extension:enable:${id}`)
        return { instance: { status: 'enabled' } } as never
      },
      async disableExtension(id) {
        calls.push(`extension:disable:${id}`)
        return { instance: { status: 'disabled' } } as never
      }
    })

    expect((await cli.run(['extension', 'list'])).exitCode).toBe(0)
    expect((await cli.run(['extension', 'show', 'extension-cli-demo'])).stdout).toContain(
      'extension-cli-demo'
    )
    expect((await cli.run(['extension', 'enable', 'extension-cli-demo'])).stdout).toContain(
      'enabled'
    )
    expect((await cli.run(['extension', 'disable', 'extension-cli-demo'])).stdout).toContain(
      'disabled'
    )
    expect(calls).toEqual([
      'extension:list',
      'extension:show:extension-cli-demo',
      'extension:enable:extension-cli-demo',
      'extension:disable:extension-cli-demo'
    ])
  })

  it('register reads a manifest file and forwards it to M-Extension', async () => {
    const filePath = `/tmp/extension-cli-${crypto.randomUUID()}.json`
    await Bun.write(filePath, JSON.stringify(manifest))
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async registerExtension(input) {
        calls.push(`extension:register:${input.manifest.id}:${input.reason ?? ''}`)
        return { definition: { id: input.manifest.id } } as never
      }
    })

    const result = await cli.run(['extension', 'register', filePath, '--reason', 'cli-smoke'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('extension-cli-demo')
    expect(calls).toEqual(['extension:register:extension-cli-demo:cli-smoke'])
  })

  it('missing extension command args return usage errors', async () => {
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      }
    })

    expect((await cli.run(['extension', 'show'])).stderr).toContain(
      'usage: meristem extension show <id>'
    )
    expect((await cli.run(['extension', 'register'])).stderr).toContain(
      'usage: meristem extension register <manifest-file>'
    )
    expect((await cli.run(['extension', 'enable'])).stderr).toContain(
      'usage: meristem extension enable <id>'
    )
    expect((await cli.run(['extension', 'disable'])).stderr).toContain(
      'usage: meristem extension disable <id>'
    )
  })

  it('top-level usage lists extension commands', async () => {
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      }
    })

    const result = await cli.run(['--help'])

    expect(result.stdout).toContain('extension')
    expect(result.exitCode).toBe(0)
  })
})
