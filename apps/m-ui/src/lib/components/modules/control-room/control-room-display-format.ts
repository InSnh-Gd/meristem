/**
 * 控制室工作台的展示层格式化函数。
 *
 * 归属边界：这些函数只做纯展示格式化，不产生事实、不做授权判断、
 * 不访问 store，也不发起数据获取。事实仍然由 M-* 功能域服务拥有，
 * 经 M-UI BFF 适配后传入组件。
 *
 * 提取原因：摘要卡片区、账本/服务表格区与已选上下文检查器三个 zone
 * 子组件都需要同一套时间与标识格式化行为，集中在此避免重复实现。
 */

/** 把 ISO 时间戳格式化为 zh-CN 24 小时制时间；缺失或非法输入回退为占位符。 */
export function formatTime(ts: string | undefined): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
  } catch {
    return '—'
  }
}

/** 截断过长的标识符以适配密集表格与检查器行；缺失值回退为占位符。 */
export function truncateId(value: string | undefined, limit = 16): string {
  if (!value) return '—'
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}
