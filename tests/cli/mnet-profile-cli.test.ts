import { describe, expect, it } from 'bun:test'
import { createCliRunner } from '../../apps/m-cli/src/cli.ts'

describe('mnet profile CLI commands', () => {
  it('network profile list calls listNetworkProfiles and returns JSON', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async listNetworkProfiles() {
        calls.push('network:profile:list')
        return { profiles: [{ version: 'm-net-default@0.1.0', status: 'active' }] }
      }
    })

    const result = await cli.run(['network', 'profile', 'list'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"m-net-default@0.1.0"')
    expect(calls).toEqual(['network:profile:list'])
  })

  it('network profile show <version> calls getNetworkProfile', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async getNetworkProfile(profileVersion) {
        calls.push(`network:profile:show:${profileVersion}`)
        return { profile: { version: profileVersion, policyMode: 'balanced' } }
      }
    })

    const result = await cli.run(['network', 'profile', 'show', 'm-net-default@0.1.0'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"policyMode": "balanced"')
    expect(calls).toEqual(['network:profile:show:m-net-default@0.1.0'])
  })

  it('network profile enable calls enableNetworkProfile with required flags', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async enableNetworkProfile(networkId, profileVersion, reason) {
        calls.push(`network:profile:enable:${networkId}:${profileVersion}:${reason}`)
        return { networkId, profileVersion, reason, accepted: true }
      }
    })

    const result = await cli.run([
      'network',
      'profile',
      'enable',
      '--network',
      'net-1',
      '--profile',
      'm-net-canary@0.2.0',
      '--reason',
      'm-net-cn-rollout'
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"accepted": true')
    expect(calls).toEqual(['network:profile:enable:net-1:m-net-canary@0.2.0:m-net-cn-rollout'])
  })

  it('network profile disable calls disableNetworkProfile with required flags', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async disableNetworkProfile(networkId, reason) {
        calls.push(`network:profile:disable:${networkId}:${reason}`)
        return { networkId, reason, accepted: true }
      }
    })

    const result = await cli.run([
      'network',
      'profile',
      'disable',
      '--network',
      'net-1',
      '--reason',
      'rollback-to-default'
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"networkId": "net-1"')
    expect(calls).toEqual(['network:profile:disable:net-1:rollback-to-default'])
  })

  it('missing required args returns error', async () => {
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async enableNetworkProfile() {
        throw new Error('should not be called')
      },
      async disableNetworkProfile() {
        throw new Error('should not be called')
      }
    })

    const missingEnableProfile = await cli.run(['network', 'profile', 'enable', '--network', 'net-1', '--reason', 'x'])
    const missingDisableReason = await cli.run(['network', 'profile', 'disable', '--network', 'net-1'])
    const missingShowVersion = await cli.run(['network', 'profile', 'show'])

    expect(missingEnableProfile.exitCode).toBe(1)
    expect(missingEnableProfile.stderr).toContain('missing --profile')
    expect(missingDisableReason.exitCode).toBe(1)
    expect(missingDisableReason.stderr).toContain('missing --reason')
    expect(missingShowVersion.exitCode).toBe(1)
    expect(missingShowVersion.stderr).toContain('usage: meristem network profile show <profile-version>')
  })
})
