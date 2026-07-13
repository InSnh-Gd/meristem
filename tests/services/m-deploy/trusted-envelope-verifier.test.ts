import { describe, expect, it } from 'bun:test'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { ok } from '../../../packages/common/src/result.ts'
import type { SecretManager } from '../../../packages/secrets/src/index.ts'
import type { MDeployDeps } from '../../../services/m-deploy/src/deps.ts'
import { createTrustedEnvelopeVerifier } from '../../../services/m-deploy/src/trusted-envelope-verifier.ts'

const now = '2026-07-13T00:05:00.000Z'

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const fingerprint = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64url')
  const signedBytes = new TextEncoder().encode('canonical-envelope-bytes')
  const signature = sign(null, signedBytes, privateKey).toString('base64url')
  const manager: SecretManager = {
    async read() {
      return ok(publicKeyPem)
    },
    async list() {
      return ok([])
    },
    async write() {
      return ok(undefined)
    }
  }
  const verifier = createTrustedEnvelopeVerifier({
    secretManager: manager,
    publicKeyRef: { provider: 'vault-kv-v2', keyPath: 'mdeploy/controller/public-key' },
    issuer: 'm-deploy-controller',
    audience: 'mdeploy-agent',
    publicKeyFingerprint: fingerprint,
    now: () => now
  })
  const input = {
    signedBytes,
    signature: {
      algorithm: 'ed25519' as const,
      value: signature,
      payloadDigest: { algorithm: 'sha256' as const, value: 'sha256:fixture' }
    },
    signer: { kind: 'mdeploy-controller' as const, identity: 'm-deploy-controller' },
    controllerTrust: {
      issuer: 'm-deploy-controller',
      audience: 'mdeploy-agent',
      publicKeyFingerprint: fingerprint,
      expiresAt: '2026-07-14T00:00:00.000Z'
    }
  }
  return { verifier, input }
}

describe('M-Deploy production trusted-envelope verifier', () => {
  it('accepts canonical bytes signed by the SecretProvider-backed enrolled controller key', async () => {
    const { verifier, input } = fixture()
    expect(await verifier.verify(input)).toEqual({ ok: true, value: undefined })
  })

  type VerificationInput = Parameters<MDeployDeps['envelopeVerifier']['verify']>[0]
  type VerificationChange = {
    signedBytes?: Uint8Array
    signature?: Partial<VerificationInput['signature']>
    signer?: Partial<VerificationInput['signer']>
    controllerTrust?: Partial<VerificationInput['controllerTrust']>
  }
  const rejectedChanges: ReadonlyArray<readonly [string, VerificationChange]> = [
    ['issuer', { controllerTrust: { issuer: 'forged-controller' } }],
    ['audience', { controllerTrust: { audience: 'other-agent' } }],
    ['fingerprint', { controllerTrust: { publicKeyFingerprint: 'attacker-key' } }],
    ['expired trust', { controllerTrust: { expiresAt: '2026-07-12T00:00:00.000Z' } }],
    ['signer identity', { signer: { identity: 'forged-controller' } }],
    ['altered bytes', { signedBytes: new TextEncoder().encode('altered-envelope') }],
    ['altered signature', { signature: { value: 'Zm9yZ2Vk' } }]
  ]

  it.each(rejectedChanges)('rejects %s', async (_name, change) => {
    const { verifier, input } = fixture()
    const changed = {
      ...input,
      ...change,
      controllerTrust: { ...input.controllerTrust, ...change.controllerTrust },
      signer: { ...input.signer, ...change.signer },
      signature: { ...input.signature, ...change.signature }
    }
    expect(await verifier.verify(changed)).toMatchObject({
      ok: false,
      error: { code: 'signature_verification_failed' }
    })
  })
})
