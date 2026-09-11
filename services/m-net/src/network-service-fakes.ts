/**
 * network-service.test.ts 的 drizzle 事务 fake 装配（仅测试使用）。
 * 抽出以守单文件 500 行预算（MERISTEM-DEV §8.2）。本模块只包含查询路由与记录逻辑，
 * 刻意不引入 shoehorn / MNetDb——MNetDb 的 fromPartial 包装留在测试文件里，
 * 避免这个 src 路径下的模块触到 devDependencies（not-to-dev-dep 为 error 级规则）。
 */

/** drizzle table 对象带 description 为 drizzle:Name 的 symbol；测试用它比对级联覆盖面。 */
function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table as object).find(
    candidate => candidate.description === 'drizzle:Name'
  )
  return String(Reflect.get(table as object, symbol as symbol))
}

/**
 * drizzle 查询 builder 的最小替身：真 Promise（then 在原型上，合法可 await）挂链式方法；
 * 链尾 await 得本节点行集（或错误）。
 */
function queryBuilderFor(rows: unknown[] | Promise<unknown[]>, onFor?: (mode: string) => void) {
  const chain = (target: unknown[] | Promise<unknown[]>) =>
    Object.assign(Promise.resolve(target), {
      where: () => chain(target),
      limit: () => chain(target),
      returning: () => chain(target),
      for: (mode: string) => {
        onFor?.(mode)
        return chain(target)
      }
    })
  return chain(rows)
}

export type DeleteNetworkFixture = {
  networkExists: boolean
  membershipRows?: unknown[]
  /** 事务内权威 profile 状态行；缺省空集 = 从未启用，放行。 */
  profileRows?: Array<{ status: string }>
  factRows?: unknown[]
  switchMemberRows?: unknown[]
  suspendedRows?: unknown[]
  /** 模拟级联中途某条 DELETE 失败（连接断开等），验证错误原样外抛而不是被吞。 */
  deleteThrowsOn?: string
}

export type RemoveMemberFixture = {
  networkExists: boolean
  /** 事务内目标成员行（存在性检查读数）；缺省空集 = member_not_found。 */
  membershipRows?: unknown[]
  /** 成员行删除后、按 nodeId 的剩余成员资格读数；缺省空集 = 已退出所有网络。 */
  remainingMembershipRows?: unknown[]
  /** 模拟中途某条 DELETE 失败，验证错误原样外抛而不是被吞。 */
  deleteThrowsOn?: string
}

/**
 * deleteNetwork 事务体的最小替身：按表名路由行集，记录删除序列；
 * 只记录 networks 行的锁请求——成员门禁的 TOCTOU 防护依赖 FOR UPDATE。
 */
export function deleteNetworkTx(
  fixture: DeleteNetworkFixture,
  counter: { deletedTables: string[]; locks?: string[] }
) {
  return {
    select: () => ({
      from: (table: unknown): ReturnType<typeof queryBuilderFor> => {
        const name = tableName(table)
        const rows: unknown[] =
          name === 'networks'
            ? fixture.networkExists
              ? [{ id: 'network-a' }]
              : []
            : name === 'network_memberships'
              ? (fixture.membershipRows ?? [])
              : name === 'mnet_network_profile_states'
                ? (fixture.profileRows ?? [])
                : name === 'mnet_closed_loop_facts'
                  ? (fixture.factRows ?? [])
                  : name === 'mnet_profile_switch_batch_members'
                    ? (fixture.switchMemberRows ?? [])
                    : name === 'mnet_suspended_operations'
                      ? (fixture.suspendedRows ?? [])
                      : []
        return queryBuilderFor(
          rows,
          name === 'networks' && counter.locks ? mode => counter.locks?.push(mode) : undefined
        )
      }
    }),
    delete: (table: unknown) => {
      const name = tableName(table)
      if (fixture.deleteThrowsOn === name) {
        return queryBuilderFor(Promise.reject(new Error(`boom:${name}`)))
      }
      counter.deletedTables.push(name)
      return queryBuilderFor([])
    }
  }
}

/**
 * removeMember 事务体的最小替身：与 deleteNetwork 的 fake 同型，
 * network_memberships 的读数在删除后切换到 remainingMembershipRows，
 * 建模同事务「删后读」的可见性。
 */
export function removeMemberTx(
  fixture: RemoveMemberFixture,
  counter: { deletedTables: string[]; locks?: string[] }
) {
  let membershipDeleted = false
  return {
    select: () => ({
      from: (table: unknown): ReturnType<typeof queryBuilderFor> => {
        const name = tableName(table)
        const rows: unknown[] =
          name === 'networks'
            ? fixture.networkExists
              ? [{ id: 'network-a' }]
              : []
            : name === 'network_memberships'
              ? membershipDeleted
                ? (fixture.remainingMembershipRows ?? [])
                : (fixture.membershipRows ?? [])
              : []
        return queryBuilderFor(
          rows,
          name === 'networks' && counter.locks ? mode => counter.locks?.push(mode) : undefined
        )
      }
    }),
    delete: (table: unknown) => {
      const name = tableName(table)
      if (fixture.deleteThrowsOn === name) {
        return queryBuilderFor(Promise.reject(new Error(`boom:${name}`)))
      }
      if (name === 'network_memberships') membershipDeleted = true
      counter.deletedTables.push(name)
      return queryBuilderFor([])
    }
  }
}
