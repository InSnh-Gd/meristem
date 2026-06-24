import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCliRunner } from '../../apps/m-cli/src/cli.ts'

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

describe('meristem CLI node-agent lifecycle', () => {
  it('installs node-agent lifecycle files without printing secret plaintext', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'meristem-node-agent-install-'))
    const configDir = join(workspace, 'etc/meristem/node-agent')
    const runtimeStatePath = join(workspace, 'var/lib/meristem/node-agent/runtime.json')
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      }
    })

    const result = await cli.run([
      'node-agent',
      'install',
      '--kind',
      'leaf',
      '--name',
      'edge-leaf',
      '--join-ticket',
      'join-ticket-1',
      '--config-dir',
      configDir,
      '--runtime-state',
      runtimeStatePath
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"action": "install"')
    expect(result.stdout).toContain('"serviceName": "meristem-node-agent"')
    expect(result.stdout).toContain('"runtimeToken": "staged-empty"')
    expect(result.stdout).not.toContain('join-ticket-1')
    expect(await readFile(join(configDir, 'join-ticket'), 'utf8')).toBe('join-ticket-1\n')
    expect(await readFile(join(configDir, 'node-agent.env'), 'utf8')).toContain(
      'MERISTEM_NODE_AGENT_NAME=edge-leaf'
    )
    expect(await readFile(join(configDir, 'runtime-token'), 'utf8')).toBe('\n')
    expect((await stat(join(configDir, 'runtime-token'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(configDir, 'wg/private.key'))).mode & 0o777).toBe(0o600)
    expect((await readFile(join(configDir, 'wg/private.key'), 'utf8')).startsWith('wg_priv_')).toBe(
      false
    )
    expect((await readFile(join(configDir, 'wg/private.key.pub'), 'utf8')).startsWith('wg_pub_')).toBe(
      false
    )
    expect(await readFile(join(configDir, 'tls/account.key'), 'utf8')).toBe('\n')
  })

  it('rejects symlinked lifecycle paths before writing host files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'meristem-node-agent-symlink-'))
    const configDir = join(workspace, 'etc/meristem/node-agent')
    const targetDir = join(workspace, 'outside-target')
    const runtimeStatePath = join(workspace, 'var/lib/meristem/node-agent/runtime.json')
    await ensureDir(configDir)
    await ensureDir(targetDir)
    await symlink(targetDir, join(configDir, 'wg'))
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      }
    })

    const result = await cli.run([
      'node-agent',
      'install',
      '--kind',
      'leaf',
      '--name',
      'edge-leaf',
      '--config-dir',
      configDir,
      '--runtime-state',
      runtimeStatePath
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('node-agent lifecycle path uses symlink')
  })

  it('upgrades node-agent while preserving node identity and secrets unless rotated', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'meristem-node-agent-upgrade-'))
    const configDir = join(workspace, 'etc/meristem/node-agent')
    const runtimeStatePath = join(workspace, 'var/lib/meristem/node-agent/runtime.json')
    await ensureDir(join(configDir, 'tls'))
    await ensureDir(join(configDir, 'wg'))
    await ensureDir(join(workspace, 'var/lib/meristem/node-agent'))
    await Bun.write(
      join(configDir, 'node-agent.env'),
      [
        'MERISTEM_JOIN_URL=wss://old.example/join/v0/session',
        'MERISTEM_AGENT_VERSION=0.1.0',
        'MERISTEM_WG_BINARY_PATH=wg',
        'MERISTEM_WSTUNNEL_BINARY_PATH=/run/current-system/sw/bin/wstunnel',
        'MERISTEM_ACME_DIRECTORY=https://acme.example/directory',
        `MERISTEM_ACME_ACCOUNT_KEY=${join(configDir, 'tls/account.key')}`,
        `MERISTEM_HOST_PRIVATE_KEY_PATH=${join(configDir, 'wg/private.key')}`,
        'MERISTEM_RELAY_ENDPOINT=wss://relay.old.example:443',
        'MERISTEM_LOG_LEVEL=info',
        'MERISTEM_NODE_AGENT_ROLE=leaf',
        'MERISTEM_NODE_AGENT_NAME=edge-leaf',
        ''
      ].join('\n')
    )
    await Bun.write(join(configDir, 'node-id'), 'node-123\n')
    await Bun.write(join(configDir, 'runtime-token'), 'runtime-token-123\n')
    await Bun.write(join(configDir, 'wg/private.key'), 'wg-private-123\n')
    await Bun.write(join(configDir, 'wg/private.key.pub'), 'wg-public-123\n')
    await Bun.write(
      join(configDir, 'wg/private.key.meta.json'),
      `${JSON.stringify({ keyId: 'wg-1', createdAt: '2026-01-01T00:00:00.000Z' }, null, 2)}\n`
    )
    await Bun.write(join(configDir, 'tls/account.key'), 'acme-key-123\n')
    await Bun.write(
      runtimeStatePath,
      `${JSON.stringify({ nodeId: 'node-123', runtimeToken: 'runtime-token-123', savedAt: '2026-01-01T00:00:00.000Z' }, null, 2)}\n`
    )

    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      }
    })

    const preserve = await cli.run([
      'node-agent',
      'upgrade',
      '--join-url',
      'wss://new.example/join/v0/session',
      '--config-dir',
      configDir,
      '--runtime-state',
      runtimeStatePath
    ])
    const preserveEnv = await readFile(join(configDir, 'node-agent.env'), 'utf8')
    const preservedToken = await readFile(join(configDir, 'runtime-token'), 'utf8')
    const rotate = await cli.run([
      'node-agent',
      'upgrade',
      '--config-dir',
      configDir,
      '--runtime-state',
      runtimeStatePath,
      '--rotate-runtime-token',
      '--rotate-wireguard-key',
      '--rotate-acme-account-key'
    ])
    const rotatedToken = await readFile(join(configDir, 'runtime-token'), 'utf8')
    const rotatedWg = await readFile(join(configDir, 'wg/private.key'), 'utf8')
    const rotatedAcme = await readFile(join(configDir, 'tls/account.key'), 'utf8')

    expect(preserve.exitCode).toBe(0)
    expect(preserve.stdout).toContain('"preservedNodeIdentity": "node-123"')
    expect(preserveEnv).toContain('MERISTEM_JOIN_URL=wss://new.example/join/v0/session')
    expect(preservedToken).toBe('runtime-token-123\n')
    expect(rotate.exitCode).toBe(0)
    expect(rotate.stdout).toContain('"runtimeToken": true')
    expect(rotatedToken).toBe('\n')
    expect(rotatedWg).not.toBe('wg-private-123\n')
    expect(rotatedAcme).toBe('\n')
    expect(await Bun.file(runtimeStatePath).exists()).toBe(false)
  })

  it('uninstalls node-agent config and preserves secrets unless purge is requested', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'meristem-node-agent-uninstall-'))
    const configDir = join(workspace, 'etc/meristem/node-agent')
    const runtimeStatePath = join(workspace, 'var/lib/meristem/node-agent/runtime.json')
    await ensureDir(join(configDir, 'tls'))
    await ensureDir(join(configDir, 'wg'))
    await ensureDir(join(workspace, 'var/lib/meristem/node-agent'))
    await Bun.write(join(configDir, 'node-agent.env'), 'MERISTEM_NODE_AGENT_NAME=edge-leaf\n')
    await Bun.write(join(configDir, 'join-ticket'), 'join-ticket-1\n')
    await Bun.write(join(configDir, 'node-id'), 'node-123\n')
    await Bun.write(join(configDir, 'runtime-token'), 'runtime-token-123\n')
    await Bun.write(join(configDir, 'wg/private.key'), 'wg-private-123\n')
    await Bun.write(join(configDir, 'wg/private.key.pub'), 'wg-public-123\n')
    await Bun.write(join(configDir, 'wg/private.key.meta.json'), '{"keyId":"wg-1"}\n')
    await Bun.write(join(configDir, 'tls/account.key'), 'acme-key-123\n')
    await Bun.write(runtimeStatePath, '{"nodeId":"node-123","runtimeToken":"runtime-token-123"}\n')

    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      }
    })

    const keepSecrets = await cli.run([
      'node-agent',
      'uninstall',
      '--config-dir',
      configDir,
      '--runtime-state',
      runtimeStatePath
    ])

    expect(keepSecrets.exitCode).toBe(0)
    expect(keepSecrets.stdout).toContain('"purgedSecrets": false')
    expect(await Bun.file(join(configDir, 'node-agent.env')).exists()).toBe(false)
    expect(await Bun.file(join(configDir, 'runtime-token')).exists()).toBe(false)
    expect(await Bun.file(join(configDir, 'wg/private.key')).exists()).toBe(true)
    expect(await Bun.file(join(configDir, 'tls/account.key')).exists()).toBe(true)

    await Bun.write(join(configDir, 'node-agent.env'), 'MERISTEM_NODE_AGENT_NAME=edge-leaf\n')
    await Bun.write(join(configDir, 'runtime-token'), 'runtime-token-123\n')
    await Bun.write(join(configDir, 'wg/private.key'), 'wg-private-123\n')
    await Bun.write(join(configDir, 'wg/private.key.pub'), 'wg-public-123\n')
    await Bun.write(join(configDir, 'wg/private.key.meta.json'), '{"keyId":"wg-1"}\n')
    await Bun.write(join(configDir, 'tls/account.key'), 'acme-key-123\n')

    const purgeSecrets = await cli.run([
      'node-agent',
      'uninstall',
      '--config-dir',
      configDir,
      '--runtime-state',
      runtimeStatePath,
      '--purge-secrets'
    ])

    expect(purgeSecrets.exitCode).toBe(0)
    expect(purgeSecrets.stdout).toContain('"purgedSecrets": true')
    expect(await Bun.file(join(configDir, 'wg/private.key')).exists()).toBe(false)
    expect(await Bun.file(join(configDir, 'tls/account.key')).exists()).toBe(false)
  })
})
