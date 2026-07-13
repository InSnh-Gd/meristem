import type {
  MDeployControllerTrustMaterialV01FromSchema,
  MDeploySignedEnvelopeV01FromSchema
} from '../../../packages/contracts/src/index.ts'

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object' || value === null) return JSON.stringify(value)

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`
}

/**
 * 签名字节显式绑定 desired-state、签名主体和目标 agent 的 controller trust，避免跨 enrollment 重放。
 */
export function mDeployEnvelopeVerificationBytes(
  envelope: MDeploySignedEnvelopeV01FromSchema,
  controllerTrust: MDeployControllerTrustMaterialV01FromSchema
): Uint8Array {
  return new TextEncoder().encode(
    canonicalJson({
      schemaVersion: envelope.schemaVersion,
      payload: envelope.payload,
      signature: {
        algorithm: envelope.signature.algorithm,
        payloadDigest: envelope.signature.payloadDigest
      },
      signer: envelope.signer,
      issuedAt: envelope.issuedAt,
      expiresAt: envelope.expiresAt,
      controllerTrust: {
        issuer: controllerTrust.issuer,
        audience: controllerTrust.audience,
        publicKeyFingerprint: controllerTrust.publicKeyFingerprint
      }
    })
  )
}
