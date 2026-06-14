import { verifyLocalToken } from '../../../packages/auth/src/index.ts'
import { err, ok } from '../../../packages/common/src/result.ts'
import { createDb } from '../../../packages/db/src/client.ts'
import {
  internalRequestHeaders,
  internalServicePorts,
  serveHttpApp,
  serviceUrl
} from '../../../packages/internal-http/src/index.ts'
import { initTelemetry, shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import { createMTaskApp } from './app.ts'
import { createDbMTaskStorage } from './storage-adapter.ts'
import { createDbSuspendedOperationStore } from './suspended-operations.ts'
import { createInMemoryMTaskDeps } from './testing.ts'

initTelemetry('m-task')

// 先把任务权威状态落到 M-Task 表组；其他端口继续保持轻量边界，
// 后续 hardening slice 再替换为真实跨服务客户端。
const { db, client } = createDb()
const deps = createInMemoryMTaskDeps({ actor: 'operator' })
const app = createMTaskApp({
  ...deps,
  storage: createDbMTaskStorage(db),
  suspendedOps: createDbSuspendedOperationStore(db),
  approvals: {
    async create(input) {
      const response = await fetch(`${serviceUrl('m-policy')}/internal/v0/policy/approvals`, {
        method: 'POST',
        headers: { ...internalRequestHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify(input)
      })
      if (!response.ok)
        return err({ code: 'approval.create_failed', message: 'failed to create policy approval' })
      const body = (await response.json()) as { approval: { id: string } }
      return ok({ approvalId: body.approval.id })
    }
  },
  auth: {
    async verify(token: string) {
      const secret = process.env.MERISTEM_JWT_SECRET
      if (!secret)
        return err({ code: 'auth.unconfigured', message: 'MERISTEM_JWT_SECRET is required' })
      const verified = await verifyLocalToken({ token, secret })
      return verified.ok
        ? ok({ actor: verified.actor })
        : err({ code: verified.code, message: verified.message })
    }
  }
})

const server = serveHttpApp('m-task', app.fetch)

process.on('SIGINT', () => {
  void server
    .stop()
    .then(() => client.end())
    .then(() => shutdownTelemetry())
    .then(() => process.exit(0))
})

console.log(`m-task listening on http://127.0.0.1:${internalServicePorts['m-task']}`)
