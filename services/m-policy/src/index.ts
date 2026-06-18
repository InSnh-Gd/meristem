import { createDb } from '../../../packages/db/src/client.ts'
import { internalServicePorts, serveHttpApp } from '../../../packages/internal-http/src/index.ts'
import { initTelemetry, shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import { createPolicyApp, type PolicyAuthorizeInput } from './app.ts'
import { createPolicyApprovalDeps, createPolicyReadiness } from './approval-deps.ts'
import { createApprovalRoutes, createInternalApprovalRoutes } from './approvals.ts'
import { createPolicyDecisionStore } from './decision-store.ts'
import { createPolicyEventPublisher } from './event-publisher.ts'
import { summarizePolicyState } from './summary.ts'

initTelemetry('m-policy')

const { db, client } = createDb()
const publisher = createPolicyEventPublisher()
const decisionStore = createPolicyDecisionStore(db, publisher)
const approvalDeps = createPolicyApprovalDeps(db, publisher, decisionStore)

const approvalRoutes = createApprovalRoutes(approvalDeps)
const internalApprovalRoutes = createInternalApprovalRoutes(approvalDeps)

const app = createPolicyApp({
  readiness: createPolicyReadiness(client),
  authorize(input: PolicyAuthorizeInput) {
    return decisionStore.authorize(input)
  },
  getDecision(id: string) {
    return decisionStore.getDecision(id)
  },
  async getSummary() {
    return summarizePolicyState({
      decisions: await decisionStore.listDecisions(),
      approvals: await approvalDeps.approvals.listApprovals()
    })
  }
})

const mergedApp = app.use(approvalRoutes).use(internalApprovalRoutes)
const server = serveHttpApp('m-policy', mergedApp.fetch)

// 退出顺序先停 HTTP，再关数据库和 telemetry，避免正在处理的授权请求半途丢失。
process.on('SIGINT', () => {
  void server
    .stop()
    .then(() => client.end())
    .then(() => shutdownTelemetry())
    .then(() => process.exit(0))
})

console.log(`m-policy listening on http://127.0.0.1:${internalServicePorts['m-policy']}`)
