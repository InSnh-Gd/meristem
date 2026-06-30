/**
 * M-Net data-plane noop adapter.
 *
 * Feature-gated boundary that returns noop/deferred when the data-plane feature
 * gate is off (the default). This preserves `controlPlaneOnly: true` for
 * legacy decode-only profiles and prevents any runtime transport path mutation.
 *
 * Real wstunnel relay / TCP / UDP / Headscale data-plane implementation remains deferred.
 * See ADR-N02 and docs/services/m-net.md for the current scope.
 */

export type DataPlaneAdapterStatus = 'noop' | 'deferred'

export interface DataPlaneAdapterResult {
  readonly enabled: false
  readonly status: DataPlaneAdapterStatus
}

/**
 * Create a data-plane adapter gated by the feature flag.
 *
 * When `config.enabled` is false (the default), the adapter returns noop status
 * and cannot mutate any runtime transport paths. When the gate is on, it still
 * returns noop for now, since real data-plane transport is not yet implemented.
 */
export function createDataPlaneAdapter(config: { enabled: boolean }): DataPlaneAdapterResult {
  if (!config.enabled) {
    return { enabled: false, status: 'noop' }
  }
  // Skeleton for future real implementation.
  // Even with the gate on, no real transport paths are exposed yet.
  return { enabled: false, status: 'noop' }
}

/** Default feature gate state: OFF. */
export const DATA_PLANE_FEATURE_GATE_DEFAULT = false
