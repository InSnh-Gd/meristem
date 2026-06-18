import { describe, expect, it } from 'bun:test'
import {
  createCliStatusMock,
  createFocusedCliClient,
  createIdentityCliClient
} from './src/index.ts'

describe('@meristem/testing cli helpers', () => {
  it('createCliStatusMock 返回健康 status response', async () => {
    const status = await createCliStatusMock()
    expect(status.core.mode).toBe('normal')
    expect(status.dependencies.postgres).toBe('ready')
    expect(status.counts).toEqual({ services: 1, nodes: 2, tasks: 3 })
  })

  it('createFocusedCliClient 合并覆盖并保持 status mock', async () => {
    const cli = createFocusedCliClient({
      async listServices() {
        return { services: [] }
      }
    })
    expect(typeof cli.status).toBe('function')
    const status = await cli.status()
    expect(status.core.id).toBe('meristem-core')
    expect(typeof cli.listServices).toBe('function')
    if (!cli.listServices) {
      throw new Error('listServices should be defined')
    }
    const list = await cli.listServices()
    expect(list.services).toEqual([])
  })

  it('createIdentityCliClient 绑定 identity 方法', async () => {
    const cli = createIdentityCliClient({
      listActors: async () => ({
        actors: [
          {
            id: 'operator',
            displayName: 'Default Operator',
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      })
    })
    const status = await cli.status()
    expect(status.core.mode).toBe('normal')
    if (!cli.identity?.listActors) {
      throw new Error('identity.listActors should be defined')
    }
    const actors = await cli.identity.listActors()
    expect(actors).toEqual([{ id: 'operator', displayName: 'Default Operator', status: 'active' }])
  })
})
