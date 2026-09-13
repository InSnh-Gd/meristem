import { and, eq, ne } from 'drizzle-orm'
import {
  mnetClosedLoopFacts,
  mnetDataPlaneOperationLocks,
  mnetNetworkEventIntents,
  mnetNetworkMapRenders,
  mnetNetworkProfileStates,
  mnetNetworkTombstones,
  mnetPartitionStates,
  mnetProfileMigrations,
  mnetProfileSwitchBatchMembers,
  mnetProfileTransitions,
  mnetRelayAssignments,
  mnetSuspendedOperations,
  mnetTunnelAddressAllocations,
  networkMemberships,
  networks
} from '../../../../packages/db/src/schema.ts'
import { createMNetNetworkEventIntent, networkEventIntentRow } from './network-event-outbox.ts'
import type { MNetDb, MNetServiceError } from '../types.ts'

/**
 * 网络删除事务体（ADR-N05 / DFW-043）。抽出以守单文件 500 行预算，
 * 并让「门禁 → 级联 → 墓碑/事件意图」这条删除链路集中在一处：
 * 发布者迁到 M-Net 后，删除事件必须与墓碑在同一事务提交。
 */

type MNetTransaction = Parameters<Parameters<MNetDb['transaction']>[0]>[0]

export type NetworkDeletionPrecondition =
  | { kind: 'ok' }
  /** 墓碑已存在：删除已提交过，本次是幂等重试，不重复写事件。 */
  | { kind: 'idempotent' }
  | { kind: 'failure'; error: MNetServiceError }

/**
 * 删除前置门禁，全部在本事务内读：
 * 网络行（FOR UPDATE，防并发 join 绕过成员门禁）、成员、权威 profile 状态、留存台账。
 * 行不存在时用墓碑区分「删过」（幂等成功）与「从未存在」（not_found）。
 */
export async function evaluateNetworkDeletion(
  tx: MNetTransaction,
  networkId: string
): Promise<NetworkDeletionPrecondition> {
  const [networkRow] = await tx
    .select()
    .from(networks)
    .where(eq(networks.id, networkId))
    .limit(1)
    .for('update')
  if (!networkRow) {
    const [tombstone] = await tx
      .select({ networkId: mnetNetworkTombstones.networkId })
      .from(mnetNetworkTombstones)
      .where(eq(mnetNetworkTombstones.networkId, networkId))
      .limit(1)
    return tombstone ? { kind: 'idempotent' } : { kind: 'failure', error: notFound() }
  }

  const memberRows = await tx
    .select()
    .from(networkMemberships)
    .where(eq(networkMemberships.networkId, networkId))
  if (memberRows.length > 0) {
    return {
      kind: 'failure',
      error: {
        code: 'network.members_present',
        message: 'network still has members; remove them first'
      }
    }
  }

  // 权威 profile 门禁在事务内直读状态表（生产 profileStore 与本事务同库，
  // 事务外读会留下并发解禁的 TOCTOU 窗口）；行缺失放行：profile 状态行经
  // FK 挂在 networks 上，网络存在而状态行缺失即从未启用，与旧语义一致。
  const [profileRow] = await tx
    .select({ status: mnetNetworkProfileStates.status })
    .from(mnetNetworkProfileStates)
    .where(eq(mnetNetworkProfileStates.networkId, networkId))
    .limit(1)
  if (profileRow && profileRow.status !== 'disabled') {
    return {
      kind: 'failure',
      error: {
        code: 'network.profile_not_disabled',
        message: 'network profile must be disabled before deletion'
      }
    }
  }

  // 留存台账门禁：closed-loop 事实与 profile switch 子表按 network_id 外键挂在
  // networks 上，但它们是运维/审计账本，不做级联销毁——存在引用即拒绝删除（409），
  // 由操作者显式处置；这与改前「FK 违例 500」相比是把同一冲突变成 typed 拒绝。
  const [factRow] = await tx
    .select({ factId: mnetClosedLoopFacts.factId })
    .from(mnetClosedLoopFacts)
    .where(eq(mnetClosedLoopFacts.networkId, networkId))
    .limit(1)
  if (factRow) {
    return {
      kind: 'failure',
      error: {
        code: 'network.closed_loop_facts_present',
        message: 'network still has closed-loop facts; prune them before deletion'
      }
    }
  }
  const [batchMemberRow] = await tx
    .select({ operationId: mnetProfileSwitchBatchMembers.operationId })
    .from(mnetProfileSwitchBatchMembers)
    .where(eq(mnetProfileSwitchBatchMembers.networkId, networkId))
    .limit(1)
  if (batchMemberRow) {
    return {
      kind: 'failure',
      error: {
        code: 'network.switch_membership_present',
        message: 'network still belongs to a profile switch operation; it cannot be deleted'
      }
    }
  }

  // 挂起操作台账（break-glass 恢复路径）只允许清理已终结（resumed）的行；
  // suspended / rejected / expired / resume_failed 都属于未决或待追账状态，存在即拒绝删除。
  const [suspendedRow] = await tx
    .select({ id: mnetSuspendedOperations.id })
    .from(mnetSuspendedOperations)
    .where(
      and(
        eq(mnetSuspendedOperations.networkId, networkId),
        ne(mnetSuspendedOperations.status, 'resumed')
      )
    )
    .limit(1)
  if (suspendedRow) {
    return {
      kind: 'failure',
      error: {
        code: 'network.operation_suspended',
        message:
          'network has a non-terminal suspended policy operation; resolve or prune its ledger before deletion'
      }
    }
  }

  return { kind: 'ok' }
}

/**
 * 级联清理运营态数据（随网络生命周期归属）；留存台账只门禁不销毁。
 */
export async function cascadeDeleteNetworkState(
  tx: MNetTransaction,
  networkId: string
): Promise<void> {
  await tx
    .delete(mnetTunnelAddressAllocations)
    .where(eq(mnetTunnelAddressAllocations.networkId, networkId))
  await tx.delete(mnetRelayAssignments).where(eq(mnetRelayAssignments.networkId, networkId))
  await tx.delete(mnetNetworkMapRenders).where(eq(mnetNetworkMapRenders.networkId, networkId))
  await tx.delete(mnetPartitionStates).where(eq(mnetPartitionStates.networkId, networkId))
  await tx
    .delete(mnetDataPlaneOperationLocks)
    .where(eq(mnetDataPlaneOperationLocks.networkId, networkId))
  await tx.delete(mnetProfileMigrations).where(eq(mnetProfileMigrations.networkId, networkId))
  await tx.delete(mnetProfileTransitions).where(eq(mnetProfileTransitions.networkId, networkId))
  // 挂起操作台账只清理已终结（resumed）且门禁已确认存在的行。谓词必须与门禁同界：
  // 无 status 条件的整表删除会在「并发插入一条非终结挂起操作」时把它一并抹掉，
  // 违反上面「存在即拒绝」的留存语义；限定 resumed 后该并发行会残留并让
  // delete(networks) 触发 FK 拒绝，整事务回滚而不销毁台账。
  await tx
    .delete(mnetSuspendedOperations)
    .where(
      and(
        eq(mnetSuspendedOperations.networkId, networkId),
        eq(mnetSuspendedOperations.status, 'resumed')
      )
    )
  await tx.delete(networkMemberships).where(eq(networkMemberships.networkId, networkId))
  await tx.delete(mnetNetworkProfileStates).where(eq(mnetNetworkProfileStates.networkId, networkId))
  await tx.delete(networks).where(eq(networks.id, networkId))
}

/**
 * 墓碑与删除事件意图在网络行删除之后、同一事务内写入；两者都软引用 network_id，
 * 不设外键，因此活过它们描述的网络行（ADR-N05）。
 * @returns 刚写入的 event intent id，供调用方在提交后只投递这一条。
 */
export async function writeNetworkDeletionArtifacts(
  tx: MNetTransaction,
  networkId: string,
  correlationId: string | undefined
): Promise<string> {
  const now = new Date()
  await tx.insert(mnetNetworkTombstones).values({ networkId, deletedAt: now })
  const intent = createMNetNetworkEventIntent(
    networkId,
    'mnet.network.deleted.v0',
    { networkId },
    correlationId ?? crypto.randomUUID(),
    now.toISOString()
  )
  await tx.insert(mnetNetworkEventIntents).values(networkEventIntentRow(intent))
  return intent.intentId
}

function notFound(): MNetServiceError {
  return { code: 'network.not_found', message: 'network not found' }
}

export type { MNetTransaction }
