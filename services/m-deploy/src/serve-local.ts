import { createSharedAuthVerifier } from '../../../packages/auth/src/index.ts'
import { err, ok } from '../../../packages/common/src/result.ts'
import { loadRuntimeDeploymentConfigOrThrow } from '../../../packages/config/src/index.ts'
import { internalServicePorts, requiredInternalToken } from '../../../packages/internal-http/src/index.ts'
import { initTelemetry, shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import type { MDeployAgentEnrollmentV01FromSchema } from '../../../packages/contracts/src/index.ts'
import { serveMDeployApp } from './app.ts'
import { createInMemoryMDeployDeps } from './testing.ts'

const env = process.env
const runtimeConfig = await loadRuntimeDeploymentConfigOrThrow({ env })
if (runtimeConfig.auth.provider !== 'local-dev') {
  throw new Error('mdeploy.local_auth_required: local M-Deploy only supports local-dev auth')
}
const jwtSecret = env.MERISTEM_JWT_SECRET
if (!jwtSecret) throw new Error('MERISTEM_JWT_SECRET is required for local M-Deploy')
const authVerifier = createSharedAuthVerifier({
  auth: runtimeConfig.auth,
  localDev: { jwtSecret }
})

const now = new Date().toISOString()
// 本地控制面必须对操作者真实 pin 的 sourceRef 作出响应，否则 apply 永远停在
// git.digest_not_found；controller trust 也必须相对当前时间有效，而不是沿用服务测试的固定时钟。
const fixture = createInMemoryMDeployDeps({
  now,
  gitEnvelopeFromRequestedSource: true,
  controllerTrustExpiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString()
})
const trust = fixture.__testing.controllerTrust()
const enrollment: MDeployAgentEnrollmentV01FromSchema = {
  schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
  agentId: 'local-agent',
  hostId: 'local-host',
  capabilities: [{ runtimeDriver: 'podman', version: 'local', features: ['apply', 'rollback'] }],
  controllerTrust: trust,
  enrolledAt: now
}
const deps = {
  ...fixture,
  auth: {
    async verify(bearerToken: string) {
      const token = bearerToken.replace(/^Bearer\s+/i, '')
      const verified = await authVerifier.verify(token)
      return verified.ok
        ? ok({ actor: verified.session.actor.id })
        : err({ code: `auth.${verified.code}`, message: verified.message })
    }
  }
}
const enrolled = await deps.store.upsertAgent({ enrollment })
if (!enrolled.ok) throw new Error(`mdeploy.local_agent_enrollment_failed: ${enrolled.error.message}`)

requiredInternalToken()
initTelemetry('m-deploy')
const server = serveMDeployApp(deps)
let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  void server.stop().then(() => shutdownTelemetry()).then(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
console.log(`m-deploy local listening on http://127.0.0.1:${internalServicePorts['m-deploy']}`)
