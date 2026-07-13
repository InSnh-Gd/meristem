import { err, ok, type Result } from '../../../packages/common/src/result.ts'
import {
  type MDeploySignedEnvelopeV01FromSchema,
  validateMDeploySignedEnvelopeForApply
} from '../../../packages/contracts/src/index.ts'
import type { MDeployAgentRecord, MDeployDeps, MDeployError } from './deps.ts'
import { mDeployEnvelopeVerificationBytes } from './envelope-verification.ts'

/** Controller verifies against the selected agent trust before queueing; the agent verifies again before runtime. */
export async function validateEnvelopeForAgent(
  deps: MDeployDeps,
  agent: MDeployAgentRecord,
  envelope: unknown
): Promise<Result<MDeploySignedEnvelopeV01FromSchema, MDeployError>> {
  const expectedRuntimeDriver = agent.enrollment.capabilities[0]?.runtimeDriver
  if (!expectedRuntimeDriver) {
    return err({
      code: 'deploy.agent_runtime_unsupported',
      message: 'agent has no selected runtime driver capability'
    })
  }
  const validated = validateMDeploySignedEnvelopeForApply(envelope, {
    now: deps.now(),
    expectedRuntimeDriver,
    snapshotTtlMs: deps.snapshotTtlMs
  })
  if (!validated.ok) {
    return err({
      code: validated.error.code,
      message: validated.error.message,
      ...(validated.error.detail === undefined ? {} : { detail: validated.error.detail })
    })
  }
  const trusted = await deps.envelopeVerifier.verify({
    signedBytes: mDeployEnvelopeVerificationBytes(
      validated.value,
      agent.enrollment.controllerTrust
    ),
    signature: validated.value.signature,
    signer: validated.value.signer,
    controllerTrust: agent.enrollment.controllerTrust
  })
  if (!trusted.ok) return trusted
  return ok({
    ...validated.value,
    verification: {
      verified: true,
      verifiedAt: deps.now(),
      verifier: agent.enrollment.controllerTrust.issuer
    }
  })
}
