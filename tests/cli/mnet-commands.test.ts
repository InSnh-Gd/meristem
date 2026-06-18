import { describe, expect, it } from 'bun:test'
import { createCliRunner } from '../../apps/m-cli/src/cli.ts'

describe('mnet migration CLI commands', () => {
  it('mnet migration status returns global state without operation', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async getMigrationStatus(operationId) {
        calls.push(`getMigrationStatus:${operationId ?? 'global'}`)
        return {
          defaultProfileVersion: 'm-net-default@0.1.0',
          globalSwitchState: 'idle',
          updatedAt: '2025-01-01T00:00:00Z'
        }
      }
    })

    const result = await cli.run(['mnet', 'migration', 'status'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('m-net-default@0.1.0')
    expect(result.stdout).toContain('idle')
    expect(calls).toEqual(['getMigrationStatus:global'])
  })

  it('mnet migration status --operation returns specific operation status', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async getMigrationStatus(operationId) {
        calls.push(`getMigrationStatus:${operationId}`)
        return { operationId, state: 'planned', candidateCount: 5 }
      }
    })

    const result = await cli.run(['mnet', 'migration', 'status', '--operation', 'op-123'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('op-123')
    expect(result.stdout).toContain('planned')
    expect(calls).toEqual(['getMigrationStatus:op-123'])
  })

  it('mnet migration dry-run calls planMigration with flags', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async planMigration(targetVersion, batchSize, reason) {
        calls.push(`planMigration:${targetVersion}:${batchSize}:${reason}`)
        return { operationId: 'plan-1', candidateCount: 3, globalSwitchState: 'planned' }
      }
    })

    const result = await cli.run([
      'mnet',
      'migration',
      'dry-run',
      '--target-version',
      'm-net-cn@0.2.0',
      '--reason',
      'canary-test',
      '--batch-size',
      '5'
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('plan-1')
    expect(result.stdout).toContain('planned')
    expect(calls).toEqual(['planMigration:m-net-cn@0.2.0:5:canary-test'])
  })

  it('mnet migration dry-run without batch-size works', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async planMigration(targetVersion, _batchSize, reason) {
        calls.push(`planMigration:${targetVersion}:undefined:${reason}`)
        return { operationId: 'plan-2', candidateCount: 1 }
      }
    })

    const result = await cli.run([
      'mnet',
      'migration',
      'dry-run',
      '--target-version',
      'm-net-cn@0.2.0',
      '--reason',
      'test'
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('plan-2')
    expect(calls).toEqual(['planMigration:m-net-cn@0.2.0:undefined:test'])
  })

  it('mnet migration apply --operation calls applyMigration', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async applyMigration(operationId) {
        calls.push(`applyMigration:${operationId}`)
        return { operationId, batchId: 'batch-1', globalSwitchState: 'applied' }
      }
    })

    const result = await cli.run(['mnet', 'migration', 'apply', '--operation', 'op-1'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('applied')
    expect(calls).toEqual(['applyMigration:op-1'])
  })

  it('mnet migration resume --operation calls resumeMigration', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async resumeMigration(operationId) {
        calls.push(`resumeMigration:${operationId}`)
        return { operationId, nextBatchId: 'batch-2', globalSwitchState: 'applying' }
      }
    })

    const result = await cli.run(['mnet', 'migration', 'resume', '--operation', 'op-1'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('applying')
    expect(calls).toEqual(['resumeMigration:op-1'])
  })

  it('mnet migration rollback --operation --reason calls rollbackMigration', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async rollbackMigration(operationId, reason) {
        calls.push(`rollbackMigration:${operationId}:${reason}`)
        return { operationId, globalSwitchState: 'rolled_back' }
      }
    })

    const result = await cli.run([
      'mnet',
      'migration',
      'rollback',
      '--operation',
      'op-1',
      '--reason',
      'unexpected-behavior'
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('rolled_back')
    expect(calls).toEqual(['rollbackMigration:op-1:unexpected-behavior'])
  })

  it('mnet migration rollback missing --reason returns error', async () => {
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async rollbackMigration() {
        throw new Error('should not be called')
      }
    })

    const result = await cli.run(['mnet', 'migration', 'rollback', '--operation', 'op-1'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('missing --reason')
  })

  it('mnet health --network returns data-plane health', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async getDataplaneHealth(networkId) {
        calls.push(`getDataplaneHealth:${networkId}`)
        return { networkId, status: 'healthy', nodeCount: 5 }
      }
    })

    const result = await cli.run(['mnet', 'health', '--network', 'net-1'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('healthy')
    expect(result.stdout).toContain('net-1')
    expect(calls).toEqual(['getDataplaneHealth:net-1'])
  })

  it('mnet relay --network returns relay assignment', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async getRelayAssignment(networkId) {
        calls.push(`getRelayAssignment:${networkId}`)
        return {
          networkId,
          relayEndpoint: 'turn://relay.example.com:3478',
          nodeIds: ['node-a', 'node-b']
        }
      }
    })

    const result = await cli.run(['mnet', 'relay', '--network', 'net-1'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('relay.example.com')
    expect(result.stdout).toContain('node-a')
    expect(calls).toEqual(['getRelayAssignment:net-1'])
  })

  it('mnet map inspect --network returns network map', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async getNetworkMap(networkId) {
        calls.push(`getNetworkMap:${networkId}`)
        return { networkId, members: [{ nodeId: 'node-a', tunnelIp: '10.0.0.1' }], mapVersion: 3 }
      }
    })

    const result = await cli.run(['mnet', 'map', 'inspect', '--network', 'net-1'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('node-a')
    expect(result.stdout).toContain('10.0.0.1')
    expect(calls).toEqual(['getNetworkMap:net-1'])
  })

  it('mnet break-glass --network --reason --confirm-break-glass calls breakGlass', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async breakGlass(networkId, reason) {
        calls.push(`breakGlass:${networkId}:${reason}`)
        return { operationId: 'bg-1', profileVersion: 'm-net-default@0.1.0', status: 'disabled' }
      }
    })

    const result = await cli.run([
      'mnet',
      'break-glass',
      '--network',
      'net-1',
      '--reason',
      'emergency-security-incident',
      '--confirm-break-glass'
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('disabled')
    expect(result.stdout).toContain('m-net-default@0.1.0')
    expect(calls).toEqual(['breakGlass:net-1:emergency-security-incident'])
  })

  it('mnet break-glass without --confirm-break-glass returns error', async () => {
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async breakGlass() {
        throw new Error('should not be called')
      }
    })

    const result = await cli.run([
      'mnet',
      'break-glass',
      '--network',
      'net-1',
      '--reason',
      'emergency'
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--confirm-break-glass')
  })

  it('mnet break-glass without --reason returns error', async () => {
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async breakGlass() {
        throw new Error('should not be called')
      }
    })

    const result = await cli.run([
      'mnet',
      'break-glass',
      '--network',
      'net-1',
      '--confirm-break-glass'
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('missing --reason')
  })

  it('mnet break-glass without --network returns error', async () => {
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async breakGlass() {
        throw new Error('should not be called')
      }
    })

    const result = await cli.run([
      'mnet',
      'break-glass',
      '--reason',
      'emergency',
      '--confirm-break-glass'
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('missing --network')
  })

  it('unknown mnet subcommand shows usage', async () => {
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      }
    })

    const result = await cli.run(['mnet', 'unknown', 'command'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('usage:')
    expect(result.stderr).toContain('mnet')
  })
})
