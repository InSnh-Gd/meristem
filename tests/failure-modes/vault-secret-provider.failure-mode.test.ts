import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import { err, ok } from '../../packages/common/src/result.ts'
import {
  SecretFailureSchema,
  SecretProviderConfigSchema,
  SecretRefResolutionResultV02Schema,
  SecretRefSchema,
  SecretRevokeResultV02Schema,
  SecretRotationResultV02Schema,
  VaultHealthStatusV02Schema,
  VaultWorkloadAuthResultV02Schema,
  VaultWorkloadAuthV02Schema
} from '../../packages/contracts/src/index.ts'
import {
  createSecretManager,
  type SecretProviderAdapter
} from '../../packages/secrets/src/index.ts'

const secretSentinel = 'MERISTEM_TEST_SECRET_DO_NOT_LOG'

const redactedRef = {
  provider: 'vault-prod',
  keyPath: 'identity/keycloak/client-secret',
  version: 7
}

function encodedPayload(schema: Schema.Schema.AnyNoContext, payload: unknown): string {
  const decoded = Schema.decodeUnknownSync(schema)(payload)
  return JSON.stringify(Schema.encodeSync(schema)(decoded))
}

function expectRedacted(payload: string): void {
  expect(payload).not.toContain(secretSentinel)
  expect(payload).not.toContain('"value"')
  expect(payload).not.toContain('"plaintext"')
  expect(payload).not.toContain('"rootToken"')
  expect(payload).not.toContain('"unsealShard"')
  expect(payload).not.toContain('"appRoleSecretId"')
  expect(payload).not.toContain('"secretIdValue"')
  expect(payload).not.toContain('local-dev-env')
}

describe('Vault SecretProvider v0.2 failure-mode contracts', () => {
  it('preserves legacy SecretRef, SecretProviderConfig, and SecretFailure inputs', () => {
    const legacyRef = Schema.decodeUnknownSync(SecretRefSchema)({
      provider: 'vault-prod',
      keyPath: 'identity/keycloak/client-secret',
      version: 7,
      metadata: { owner: 'm-ui-bff' }
    })
    const legacyProvider = Schema.decodeUnknownSync(SecretProviderConfigSchema)({
      backend: 'vault-kv-v2',
      address: 'https://vault.internal',
      mountPath: 'meristem',
      authMethodRef: 'vault-auth/m-ui-bff'
    })
    const legacyFailure = Schema.decodeUnknownSync(SecretFailureSchema)({
      code: 'permission_denied',
      provider: 'vault-prod',
      ref: redactedRef,
      message: 'Vault policy denied access'
    })

    expect(legacyRef.metadata).toEqual({ owner: 'm-ui-bff' })
    expect(legacyProvider.backend).toBe('vault-kv-v2')
    expect(legacyFailure.code).toBe('permission_denied')
  })

  it('keeps Vault HA as an additive vault-kv-v2 SecretProvider config form', () => {
    const payload = encodedPayload(SecretProviderConfigSchema, {
      version: 'vault-ha@0.2.0',
      backend: 'vault-kv-v2',
      clusterName: 'vault-production',
      address: 'https://vault.internal',
      mountPath: 'meristem',
      authMethodRef: 'vault-auth/mdeploy-agent',
      storage: {
        backend: 'raft-integrated',
        nodeCount: 3,
        autopilotEnabled: true
      },
      unsealMode: 'shamir',
      keyCustodyRef: 'custody/vault-production',
      secretZeroCeremonyRef: 'ceremony/vault-production-bootstrap',
      workloadAuthRef: 'vault-auth/mdeploy-agent',
      rootToken: secretSentinel,
      unsealShard: secretSentinel
    })

    expect(payload).toContain('"version":"vault-ha@0.2.0"')
    expect(payload).toContain('"backend":"vault-kv-v2"')
    expectRedacted(payload)
  })

  it('keeps workload auth references, policy, TTL, status, and audit metadata redacted', () => {
    const authConfig = encodedPayload(VaultWorkloadAuthV02Schema, {
      version: 'vault-workload-auth@0.2.0',
      provider: 'vault-prod',
      method: 'approle',
      roleIdRef: { ...redactedRef, metadata: { value: secretSentinel } },
      secretIdRef: {
        provider: 'vault-prod',
        keyPath: 'auth/mdeploy-agent/secret-id',
        value: secretSentinel
      },
      policyRef: 'vault-policy/mdeploy-agent',
      tokenTtlSeconds: 900,
      renewable: true,
      auditId: 'audit-workload-auth-config',
      appRoleSecretId: secretSentinel,
      secretIdValue: secretSentinel,
      rootToken: secretSentinel
    })
    const authSuccess = encodedPayload(VaultWorkloadAuthResultV02Schema, {
      status: 'authenticated',
      provider: 'vault-prod',
      authMethodRef: 'vault-auth/mdeploy-agent',
      policyRef: 'vault-policy/mdeploy-agent',
      leaseHandle: 'lease-handle-7f1a',
      ttlSeconds: 900,
      auditId: 'audit-workload-auth-success',
      value: secretSentinel
    })

    expect(authConfig).toContain('"tokenTtlSeconds":900')
    expect(authConfig).toContain('"auditId":"audit-workload-auth-config"')
    expect(authSuccess).toContain('"leaseHandle":"lease-handle-7f1a"')
    expect(authSuccess).toContain('"policyRef":"vault-policy/mdeploy-agent"')
    expectRedacted(authConfig)
    expectRedacted(authSuccess)
  })

  it('models sealed, unreachable, and lost-quorum Vault states as fail-closed failures', () => {
    const health = encodedPayload(VaultHealthStatusV02Schema, {
      version: 'vault-health@0.2.0',
      provider: 'vault-prod',
      status: 'quorum_lost',
      sealed: false,
      leader: false,
      quorum: false,
      raftAppliedIndex: 418,
      checkedAt: '2026-07-13T06:00:00.000Z'
    })
    const readFailures = [
      ['vault_sealed', 'audit-read-sealed'],
      ['vault_unreachable', 'audit-read-unreachable'],
      ['vault_quorum_lost', 'audit-read-quorum-lost']
    ].map(([reason, auditId]) =>
      encodedPayload(SecretRefResolutionResultV02Schema, {
        status: 'provider_unavailable',
        provider: 'vault-prod',
        ref: redactedRef,
        reason,
        failClosed: true,
        auditId,
        message: secretSentinel
      })
    )
    const mutationFailures = [SecretRotationResultV02Schema, SecretRevokeResultV02Schema].map(
      schema =>
        encodedPayload(schema, {
          status: 'provider_unavailable',
          secretId: 'sec-oidc-client',
          provider: 'vault-prod',
          reason: 'vault_quorum_lost',
          failClosed: true,
          auditId: 'audit-mutation-quorum-lost',
          message: secretSentinel
        })
    )

    expect(health).toContain('"status":"quorum_lost"')
    expect(health).toContain('"quorum":false')
    for (const payload of [...readFailures, ...mutationFailures]) {
      expect(payload).toContain('"failClosed":true')
      expectRedacted(payload)
    }
  })

  it('models default-deny missing permission without leaking provider details', () => {
    const resolution = encodedPayload(SecretRefResolutionResultV02Schema, {
      status: 'permission_denied',
      provider: 'vault-prod',
      ref: redactedRef,
      reason: 'missing_policy_capability',
      failClosed: true,
      auditId: 'audit-denied-ref',
      message: secretSentinel
    })
    const rotation = encodedPayload(SecretRotationResultV02Schema, {
      status: 'permission_denied',
      secretId: 'sec-oidc-client',
      provider: 'vault-prod',
      reason: 'missing_policy_capability',
      failClosed: true,
      auditId: 'audit-denied-rotation',
      message: secretSentinel
    })

    expect(resolution).toContain('"status":"permission_denied"')
    expect(rotation).toContain('"reason":"missing_policy_capability"')
    expectRedacted(resolution)
    expectRedacted(rotation)
  })

  it('models expired and revoked workload credentials as typed auth and resolution failures', () => {
    for (const status of ['credential_expired', 'credential_revoked'] as const) {
      const auth = encodedPayload(VaultWorkloadAuthResultV02Schema, {
        status,
        provider: 'vault-prod',
        authMethodRef: 'vault-auth/mdeploy-agent',
        policyRef: 'vault-policy/mdeploy-agent',
        failClosed: true,
        auditId: `audit-auth-${status}`,
        message: secretSentinel
      })
      const resolution = encodedPayload(SecretRefResolutionResultV02Schema, {
        status,
        provider: 'vault-prod',
        ref: redactedRef,
        reason: status,
        failClosed: true,
        auditId: `audit-resolution-${status}`,
        message: secretSentinel
      })

      expect(auth).toContain(`"status":"${status}"`)
      expect(resolution).toContain(`"reason":"${status}"`)
      expectRedacted(auth)
      expectRedacted(resolution)
    }
  })

  it('models expired cache as stale_secret and never falls back to local storage', () => {
    const read = encodedPayload(SecretRefResolutionResultV02Schema, {
      status: 'stale_secret',
      provider: 'vault-prod',
      ref: redactedRef,
      reason: 'cache_expired',
      failClosed: true,
      auditId: 'audit-stale-read',
      value: secretSentinel
    })
    const revoke = encodedPayload(SecretRevokeResultV02Schema, {
      status: 'stale_secret',
      secretId: 'sec-oidc-client',
      provider: 'vault-prod',
      reason: 'cache_expired',
      failClosed: true,
      auditId: 'audit-stale-revoke',
      value: secretSentinel
    })

    expect(read).toContain('"status":"stale_secret"')
    expect(revoke).toContain('"reason":"cache_expired"')
    expectRedacted(read)
    expectRedacted(revoke)
  })

  it('does not consult a local development provider after Vault becomes unavailable', async () => {
    let localReads = 0
    const vaultProvider: SecretProviderAdapter = {
      name: 'vault-prod',
      backend: 'vault-kv-v2',
      async read(ref) {
        return err({
          code: 'provider_unavailable',
          provider: 'vault-prod',
          ref: { provider: ref.provider, keyPath: ref.keyPath, version: ref.version },
          message: 'Vault is unavailable'
        })
      },
      async list(prefix) {
        return err({
          code: 'provider_unavailable',
          provider: 'vault-prod',
          ref: { provider: prefix.provider, keyPath: prefix.keyPath },
          message: 'Vault is unavailable'
        })
      },
      async write(ref) {
        return err({
          code: 'provider_unavailable',
          provider: 'vault-prod',
          ref: { provider: ref.provider, keyPath: ref.keyPath, version: ref.version },
          message: 'Vault is unavailable'
        })
      }
    }
    const localProvider: SecretProviderAdapter = {
      name: 'local-dev',
      backend: 'local-dev-env',
      async read() {
        localReads += 1
        return ok(secretSentinel)
      },
      async list() {
        return ok([])
      },
      async write() {
        return ok(undefined)
      }
    }
    const manager = createSecretManager({ providers: [vaultProvider, localProvider] })

    const result = await manager.read(redactedRef)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected Vault read to fail closed')
    expect(result.error.code).toBe('provider_unavailable')
    expect(localReads).toBe(0)
    expect(JSON.stringify(result.error)).not.toContain(secretSentinel)
  })

  it('returns a redacted stale_secret after cached Vault data exceeds its TTL', async () => {
    let nowMs = 0
    let reads = 0
    const vaultProvider: SecretProviderAdapter = {
      name: 'vault-prod',
      backend: 'vault-kv-v2',
      async read(ref) {
        reads += 1
        return reads === 1
          ? ok(secretSentinel)
          : err({
              code: 'provider_unavailable',
              provider: 'vault-prod',
              ref: { provider: ref.provider, keyPath: ref.keyPath, version: ref.version },
              message: 'Vault refresh failed'
            })
      },
      async list() {
        return ok([])
      },
      async write() {
        return ok(undefined)
      }
    }
    const manager = createSecretManager({
      providers: [vaultProvider],
      cache: { freshTtlMs: 10, staleTtlMs: 20 },
      clock: { now: () => nowMs }
    })

    const initial = await manager.read(redactedRef)
    nowMs = 21
    const expired = await manager.read(redactedRef)

    expect(initial).toEqual({ ok: true, value: secretSentinel })
    expect(expired.ok).toBe(false)
    if (expired.ok) throw new Error('expected expired Vault cache to fail closed')
    expect(expired.error.code).toBe('stale_secret')
    expect(JSON.stringify(expired.error)).not.toContain(secretSentinel)
  })

  it('enforces rotation state invariants and records revoke identifiers only', () => {
    const rotation = Schema.decodeUnknownSync(SecretRotationResultV02Schema)({
      status: 'rotated',
      secretId: 'sec-oidc-client',
      oldVersion: { version: 7, state: 'deactivated' },
      newVersion: { version: 8, state: 'active' },
      actor: 'security-admin',
      auditId: 'audit-rotation-success',
      rotatedAt: '2026-07-13T06:00:00.000Z',
      value: secretSentinel
    })
    const revoke = encodedPayload(SecretRevokeResultV02Schema, {
      status: 'revoked',
      secretId: 'sec-oidc-client',
      revokedVersion: 8,
      actor: 'security-admin',
      auditId: 'audit-revoke-success',
      revokedAt: '2026-07-13T06:05:00.000Z',
      value: secretSentinel
    })

    expect(rotation.status).toBe('rotated')
    if (rotation.status !== 'rotated') throw new Error('expected rotation success')
    expect(rotation.oldVersion.state).toBe('deactivated')
    expect(rotation.newVersion.state).toBe('active')
    expect(() =>
      Schema.decodeUnknownSync(SecretRotationResultV02Schema)({
        ...rotation,
        oldVersion: { version: 7, state: 'active' },
        newVersion: { version: 8, state: 'deactivated' }
      })
    ).toThrow()
    expect(revoke).toContain('"revokedVersion":8')
    expectRedacted(JSON.stringify(rotation))
    expectRedacted(revoke)
  })

  it('rejects mismatched failure status and reason combinations', () => {
    expect(() =>
      Schema.decodeUnknownSync(SecretRefResolutionResultV02Schema)({
        status: 'permission_denied',
        provider: 'vault-prod',
        ref: redactedRef,
        reason: 'vault_sealed',
        failClosed: true,
        auditId: 'audit-invalid-pair'
      })
    ).toThrow()
  })
})
