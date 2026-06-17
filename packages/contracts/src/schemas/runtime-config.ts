import * as Schema from 'effect/Schema'

/**
 * DFW-013: M-Net runtime config schema.
 *
 * All transport, routing, and interconnect fields are gated behind exclusive
 * `secretRefId` references. Plaintext TLS, STUN, TURN, Headscale, and other
 * transport credential fields are rejected at the schema level.
 *
 * The config lifecycle payload must use `secretRef` exclusively; plaintext
 * secret values are prohibited by CONFIG-LIFECYCLE.md §2.
 */

// ── Secret reference field: id only, no plaintext ──────────────────────

/**
 * Exclusive secret reference by ID. No plaintext secret values, no
 * API keys, no bearer tokens, no TLS material.
 */
export const SecretRefFieldSchema = Schema.Struct({
  secretRefId: Schema.String
})
export type SecretRefFieldFromSchema = typeof SecretRefFieldSchema.Type

// ── M-Net runtime configuration ─────────────────────────────────────────

/**
 * M-Net runtime transport, interconnect, and routing configuration.
 *
 * Every field that could carry a credential, endpoint key, or secret
 * material uses `SecretRefFieldSchema` exclusively. The schema rejects
 * any plaintext TLS certificate, STUN password, TURN shared secret,
 * Headscale preauth key, or opaque routing credential.
 */
export const MNetRuntimeConfigSchema = Schema.Struct({
  /** DERP relay endpoint credentials (secretRef only) */
  derpRelay: Schema.optional(SecretRefFieldSchema),

  /** TCP interconnect credentials (secretRef only) */
  tcpInterconnect: Schema.optional(SecretRefFieldSchema),

  /** UDP path / STUN / TURN credentials (secretRef only) */
  udpPath: Schema.optional(SecretRefFieldSchema),

  /** Headscale control endpoint credentials (secretRef only) */
  headscaleEndpoint: Schema.optional(SecretRefFieldSchema),

  /** Routing table credentials or peer auth keys (secretRef only) */
  routingTable: Schema.optional(SecretRefFieldSchema)
})
export type MNetRuntimeConfigFromSchema = typeof MNetRuntimeConfigSchema.Type
