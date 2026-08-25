import { createHash, createPublicKey, verify } from 'node:crypto'
import { err, ok } from '../../../packages/common/src/result.ts'
import type { SecretRefFromSchema } from '../../../packages/contracts/src/index.ts'
import type { SecretManager } from '../../../packages/secrets/src/index.ts'
import type { MDeployDeps, MDeployError } from './deps.ts'

type TrustedEnvelopeVerifierOptions = {
  secretManager: SecretManager
  publicKeyRef: SecretRefFromSchema
  issuer: string
  audience: string
  publicKeyFingerprint: string
  now?: () => string
}

function verificationFailure(message: string): MDeployError {
  return { code: 'signature_verification_failed', message }
}

/**
 * Resolves controller public-key material through SecretProvider and binds it to configured and enrolled trust.
 * Envelope-provided verification claims are never inputs to this adapter.
 */
export function createTrustedEnvelopeVerifier(
  options: TrustedEnvelopeVerifierOptions
): MDeployDeps['envelopeVerifier'] {
  const now = options.now ?? (() => new Date().toISOString())

  return {
    async verify(input) {
      const trust = input.controllerTrust
      const trustMatches =
        trust.issuer === options.issuer &&
        trust.audience === options.audience &&
        trust.publicKeyFingerprint === options.publicKeyFingerprint &&
        Date.parse(trust.expiresAt) > Date.parse(now()) &&
        input.signer.kind === 'mdeploy-controller' &&
        input.signer.identity === options.issuer &&
        input.signature.algorithm === 'ed25519'
      if (!trustMatches) {
        return err(
          verificationFailure('desired-state signer is not bound to enrolled controller trust')
        )
      }

      const resolved = await options.secretManager.read(options.publicKeyRef)
      if (!resolved.ok) {
        return err({
          code: resolved.error.code,
          message: resolved.error.message
        })
      }

      try {
        const publicKey = createPublicKey(resolved.value)
        const actualFingerprint = createHash('sha256')
          .update(publicKey.export({ type: 'spki', format: 'der' }))
          .digest('base64url')
        if (actualFingerprint !== options.publicKeyFingerprint) {
          return err(
            verificationFailure('resolved controller key fingerprint does not match trust')
          )
        }
        const signature = Buffer.from(input.signature.value, 'base64url')
        return verify(null, input.signedBytes, publicKey, signature)
          ? ok(undefined)
          : err(verificationFailure('desired-state envelope signature verification failed'))
      } catch {
        return err(verificationFailure('controller key or signature encoding is invalid'))
      }
    }
  }
}

export type { TrustedEnvelopeVerifierOptions }
