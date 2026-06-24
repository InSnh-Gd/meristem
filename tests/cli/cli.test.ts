import { describe, expect, it } from 'bun:test'
import { createCliRunner } from '../../apps/m-cli/src/cli.ts'
import { createCliStatusMock } from '@meristem/testing'

describe('meristem CLI', () => {
  it('uses the typed Core client for status', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        calls.push('status')
        return createCliStatusMock()
      }
    })

    const result = await cli.run(['status'])

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual(['status'])
    expect(result.stdout).toContain('"mode": "normal"')
  })

  it('returns a non-zero exit code for invalid arguments', async () => {
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      }
    })

    const result = await cli.run(['network', 'join', '--network', 'missing-node'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('missing --node')
  })

  it('lists services and reloads m-log through the typed Core client', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async listServices() {
        calls.push('service:list')
        return {
          services: [
            {
              id: 'm-log',
              version: '0.1.0',
              domain: 'm-log',
              kind: 'internal',
              lifecycle: { reloadable: true, rollbackable: false, degradable: true },
              runtime: { liveness: true, readiness: true, mode: 'normal' }
            }
          ]
        }
      },
      async reloadService(serviceId) {
        calls.push(`service:reload:${serviceId}`)
        return {
          serviceId,
          accepted: true,
          reloadedAt: '2026-05-05T00:00:00.000Z',
          policyDecisionId: 'decision-1',
          correlationId: 'corr-1'
        }
      }
    })

    const list = await cli.run(['service', 'list'])
    const reload = await cli.run(['service', 'reload', '--service', 'm-log'])

    expect(list.exitCode).toBe(0)
    expect(list.stdout).toContain('"id": "m-log"')
    expect(reload.exitCode).toBe(0)
    expect(reload.stdout).toContain('"serviceId": "m-log"')
    expect(calls).toEqual(['service:list', 'service:reload:m-log'])
  })

  it('creates join tickets and rejects agent mode on node register', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async registerNode(input) {
        calls.push(
          `node:register:${input.kind}:${input.name}:${'mode' in input ? String((input as { mode?: string }).mode) : 'missing'}`
        )
        return {
          node: {
            id: 'node-1',
            kind: input.kind,
            name: input.name,
            status: 'healthy',
            mode: 'simulated',
            reachability: 'reachable',
            capabilities: [],
            createdAt: '2026-05-05T00:00:00.000Z'
          },
          policyDecisionId: 'decision-1',
          correlationId: 'corr-1'
        }
      },
      async createNodeTicket(input) {
        calls.push(
          `node:ticket:${input.kind}:${input.name}:${String(input.expiresInSeconds ?? 'default')}`
        )
        return {
          ticketId: 'ticket-1',
          ticket: 'mjt_ticket',
          expiresAt: '2026-05-05T00:10:00.000Z',
          joinUrl: 'wss://localhost:8443/join/v0/session',
          policyDecisionId: 'decision-2',
          correlationId: 'corr-2'
        }
      }
    })

    const register = await cli.run(['node', 'register', '--kind', 'leaf', '--name', 'sim-leaf'])
    const ticket = await cli.run([
      'node',
      'ticket',
      'create',
      '--kind',
      'leaf',
      '--name',
      'agent-leaf',
      '--expires',
      '90'
    ])
    const rejected = await cli.run([
      'node',
      'register',
      '--kind',
      'leaf',
      '--name',
      'agent-leaf',
      '--mode',
      'agent'
    ])

    expect(register.exitCode).toBe(0)
    expect(register.stdout).toContain('"mode": "simulated"')
    expect(ticket.exitCode).toBe(0)
    expect(ticket.stdout).toContain('"ticket": "mjt_ticket"')
    expect(ticket.stdout).toContain('"joinUrl": "wss://localhost:8443/join/v0/session"')
    expect(rejected.exitCode).toBe(1)
    expect(rejected.stderr).toContain('node ticket create')
    expect(calls).toEqual(['node:register:leaf:sim-leaf:missing', 'node:ticket:leaf:agent-leaf:90'])
  })

  it('rotates and revokes node runtime tokens through the typed Core client', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async issueNodeToken(nodeId) {
        calls.push(`node:issue-token:${nodeId}`)
        return {
          nodeId,
          token: 'mnt_runtime_token',
          issuedAt: '2026-05-05T00:00:00.000Z',
          policyDecisionId: 'decision-3',
          correlationId: 'corr-3'
        }
      },
      async revokeNodeToken(nodeId) {
        calls.push(`node:revoke-token:${nodeId}`)
        return {
          nodeId,
          revokedAt: '2026-05-05T00:05:00.000Z',
          policyDecisionId: 'decision-4',
          correlationId: 'corr-4'
        }
      }
    })

    const issue = await cli.run(['node', 'issue-token', '--node', 'node-1'])
    const revoke = await cli.run(['node', 'revoke-token', '--node', 'node-1'])

    expect(issue.exitCode).toBe(0)
    expect(issue.stdout).toContain('"nodeId": "node-1"')
    expect(revoke.exitCode).toBe(0)
    expect(revoke.stdout).toContain('"revokedAt": "2026-05-05T00:05:00.000Z"')
    expect(calls).toEqual(['node:issue-token:node-1', 'node:revoke-token:node-1'])
  })

  it('uses lifecycle-oriented M-Task commands', async () => {
    const calls: string[] = []
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      },
      async submitTask(input) {
        calls.push(`task:submit:${input.nodeId}:${input.type}`)
        return {
          task: {
            id: 'test-cli-job-id',
            nodeId: input.nodeId,
            leafNodeId: input.nodeId,
            type: input.type,
            status: 'completed',
            createdAt: '2026-05-24T00:00:00.000Z',
            updatedAt: '2026-05-24T00:00:00.000Z',
            completedAt: '2026-05-24T00:00:00.000Z'
          },
          policyDecisionId: 'decision-1',
          correlationId: 'corr-1',
          risk: {
            operationDangerLevel: 'medium',
            suspicionScore: 35,
            riskFactors: ['operation_danger_level']
          }
        }
      },
      async getTask(taskId) {
        calls.push(`task:status:${taskId}`)
        return {
          task: {
            id: taskId,
            nodeId: 'node-leaf-1',
            leafNodeId: 'node-leaf-1',
            type: 'noop',
            status: 'completed',
            createdAt: '2026-05-24T00:00:00.000Z',
            updatedAt: '2026-05-24T00:00:00.000Z'
          }
        }
      },
      async listTasks() {
        calls.push('task:list')
        return { tasks: [] }
      },
      async cancelTask(taskId) {
        calls.push(`task:cancel:${taskId}`)
        return {
          task: {
            id: taskId,
            nodeId: 'node-leaf-1',
            leafNodeId: 'node-leaf-1',
            type: 'noop',
            status: 'canceled',
            createdAt: '2026-05-24T00:00:00.000Z',
            updatedAt: '2026-05-24T00:00:00.000Z'
          },
          policyDecisionId: 'decision-2',
          correlationId: 'corr-2',
          risk: {
            operationDangerLevel: 'high',
            suspicionScore: 70,
            riskFactors: ['operation_danger_level']
          }
        }
      },
      async retryTask(taskId) {
        calls.push(`task:retry:${taskId}`)
        return {
          error: { code: 'not_implemented_yet', message: 'retry is not implemented' },
          decisionId: 'decision-3',
          risk: {
            operationDangerLevel: 'high',
            suspicionScore: 70,
            riskFactors: ['operation_danger_level']
          }
        }
      }
    })

    expect(
      (await cli.run(['task', 'submit', '--node', 'node-leaf-1', '--type', 'noop'])).exitCode
    ).toBe(0)
    expect((await cli.run(['task', 'status', 'test-cli-job-id'])).exitCode).toBe(0)
    expect((await cli.run(['task', 'list'])).exitCode).toBe(0)
    expect((await cli.run(['task', 'cancel', 'test-cli-job-id'])).exitCode).toBe(0)
    expect((await cli.run(['task', 'retry', 'test-cli-job-id'])).stdout).toContain(
      'not_implemented_yet'
    )
    expect(calls).toEqual([
      'task:submit:node-leaf-1:noop',
      'task:status:test-cli-job-id',
      'task:list',
      'task:cancel:test-cli-job-id',
      'task:retry:test-cli-job-id'
    ])
  })

  it('shows help with --help flag including representative commands', async () => {
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      }
    })

    const result = await cli.run(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('status')
    expect(result.stdout).toContain('node')
    expect(result.stdout).toContain('mnet')
    expect(result.stdout).toContain('policy approvals')
    expect(result.stdout).toContain('identity')
    expect(result.stdout).toContain('secret')
    expect(result.stdout).toContain('config')
  })

  it('rejects unknown commands with non-zero exit and help suggestion', async () => {
    const cli = createCliRunner({
      async status() {
        throw new Error('should not be called')
      }
    })

    const result = await cli.run(['foobar'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown command: foobar')
    expect(result.stderr).toContain('--help')
  })
})
