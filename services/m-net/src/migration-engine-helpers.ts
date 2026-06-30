import type { NetworkProfileMigrationResult, SwitchBatch } from './global-defaults-store.ts'

export type { NetworkProfileMigrationResult, SwitchBatch }

export type NetworkSnapshot = {
  networkId: string
  profileVersion: string
  status: string
  updatedAt: string
}

/** 判断 Network 是否为目标 profile version 的迁移候选。 */
export function isCandidate(state: NetworkSnapshot, targetProfileVersion: string): boolean {
  return targetProfileVersion === 'm-net-cn@0.3.0'
    ? state.profileVersion.startsWith('m-net-cn@0.1.')
    : state.profileVersion !== targetProfileVersion
}

/** 将候选列表按 batchSize 分片。 */
export function toBatches(
  candidates: readonly NetworkSnapshot[],
  batchSize: number
): SwitchBatch[] {
  const batches: SwitchBatch[] = []
  for (let index = 0; index < candidates.length; index += batchSize) {
    batches.push({
      batchId: batches.length + 1,
      networkIds: candidates.slice(index, index + batchSize).map(candidate => candidate.networkId)
    })
  }
  return batches
}

/** 展开 SwitchBatch[] 为 networkId 列表。 */
export function flattenCandidates(batches: readonly SwitchBatch[]): string[] {
  return batches.flatMap(batch => batch.networkIds)
}

/** 构造迁移结果对象。 */
export function migrationResult(
  networkId: string,
  previousProfileVersion: string,
  targetProfileVersion: string,
  status: NetworkProfileMigrationResult['status'],
  extra: { reason?: string; auditId?: string; correlationId?: string }
): NetworkProfileMigrationResult {
  return {
    networkId,
    previousProfileVersion,
    targetProfileVersion,
    status,
    ...(extra.reason ? { reason: extra.reason } : {}),
    ...(extra.auditId ? { auditId: extra.auditId } : {}),
    ...(extra.correlationId ? { correlationId: extra.correlationId } : {})
  }
}

/** 从审计元数据中读取 reason 字段。 */
export function readReason(metadata: Record<string, unknown>): string | undefined {
  const value = metadata.reason
  return typeof value === 'string' ? value : undefined
}
