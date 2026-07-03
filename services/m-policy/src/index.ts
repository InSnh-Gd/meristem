import { createSharedAuthVerifier } from '../../../packages/auth/src/index.ts'
import { loadRuntimeDeploymentConfigOrThrow } from '../../../packages/config/src/index.ts'
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

function requiredJwtSecret(): string {
  const secret = process.env.MERISTEM_JWT_SECRET
  if (!secret) throw new Error('MERISTEM_JWT_SECRET is required')
  return secret
}

const runtimeConfig = await loadRuntimeDeploymentConfigOrThrow()
const authVerifier = createSharedAuthVerifier(
  runtimeConfig.auth.provider === 'local-dev'
    ? { auth: runtimeConfig.auth, localDev: { jwtSecret: requiredJwtSecret() } }
    : { auth: runtimeConfig.auth }
)

const { db, client } = createDb()
const publisher = createPolicyEventPublisher()
const decisionStore = createPolicyDecisionStore(db, publisher)
const approvalDeps = createPolicyApprovalDeps(db, publisher, decisionStore, {
  async verify(token: string) {
    const verified = await authVerifier.verify(token)
    if (!verified.ok) return { ok: false as const, code: verified.code, message: verified.message }
    return { ok: true as const, actor: verified.session.actor.id }
  }
})

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
