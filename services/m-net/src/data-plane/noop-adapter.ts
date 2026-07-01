/**
 * M-Net data-plane noop adapter.
 *
 * 显式 disabled/local 回退边界，不能作为 live-proof 数据面实现。
 */

export type DataPlaneAdapterStatus = 'noop' | 'deferred' | 'enabled' | 'rejected'

export interface DisabledDataPlaneAdapterResult {
  readonly enabled: false
  readonly status: 'noop' | 'deferred'
  readonly mode: 'disabled' | 'local'
}

export type DataPlaneAdapterResult = DisabledDataPlaneAdapterResult

export type DataPlaneFallbackMode = DisabledDataPlaneAdapterResult['mode']

/**
 * 创建显式回退数据面 adapter。
 */
export function createDataPlaneAdapter(config: {
  enabled: boolean
  mode?: DataPlaneFallbackMode
}): DataPlaneAdapterResult {
  return {
    enabled: false,
    status: config.enabled ? 'deferred' : 'noop',
    mode: config.mode ?? (config.enabled ? 'local' : 'disabled')
  }
}

/** Default feature gate state: OFF. */
export const DATA_PLANE_FEATURE_GATE_DEFAULT = false
