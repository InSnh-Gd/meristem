import { ok, type Result } from '../../../packages/common/src/result.ts'
import type { MDeployEvidenceMetadataV01FromSchema } from '../../../packages/contracts/src/index.ts'
import type { MDeployDeps, MDeployError } from './deps.ts'

type EvidenceInput = {
  operationId: string
  correlationId: string
  auditId: string
  evidenceType: Parameters<MDeployDeps['log']['writeEvidence']>[0]['evidenceType']
  digest: Parameters<MDeployDeps['log']['writeEvidence']>[0]['digest']
}

/** M-Log assigns the immutable reference; M-Deploy stores only searchable correlation metadata. */
export async function persistMDeployEvidence(
  deps: MDeployDeps,
  input: EvidenceInput
): Promise<Result<void, MDeployError>> {
  const storageRef = await deps.log.writeEvidence(input)
  if (!storageRef.ok) return storageRef
  const persisted = await deps.store.addEvidence({
    schemaVersion: 'mdeploy.evidence-metadata@0.1.0',
    operationId: input.operationId,
    correlationId: input.correlationId,
    auditId: input.auditId,
    evidenceType: input.evidenceType,
    timestamp: deps.now(),
    storageRef: storageRef.value
  })
  if (!persisted.ok) return persisted
  const event = await deps.events.publish('mdeploy.evidence.emitted.v0', persisted.value)
  if (!event.ok) return event
  return ok(undefined)
}

/** Prepares metadata for the caller's atomic operation/evidence/outbox transaction. */
export async function prepareMDeployEvidence(
  deps: MDeployDeps,
  input: EvidenceInput
): Promise<Result<MDeployEvidenceMetadataV01FromSchema, MDeployError>> {
  const storageRef = await deps.log.writeEvidence(input)
  if (!storageRef.ok) return storageRef
  return ok({
    schemaVersion: 'mdeploy.evidence-metadata@0.1.0',
    operationId: input.operationId,
    correlationId: input.correlationId,
    auditId: input.auditId,
    evidenceType: input.evidenceType,
    timestamp: deps.now(),
    storageRef: storageRef.value
  })
}
