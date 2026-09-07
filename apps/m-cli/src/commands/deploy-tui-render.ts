// ── deploy TUI 的纯模型层 ────────────────────────────────────────────────
// compose ps 解析、按键状态转换、帧渲染都是纯函数，直接单测；
// 交互循环、进程执行与终端控制在 deploy-tui.ts。

export type TuiServiceRow = {
  name: string
  service: string
  state: string
  health: string
  exitCode: number
}

export type TuiState = {
  provider: string
  envFile: string
  rows: TuiServiceRow[]
  selected: number
  showLogs: boolean
  logService: string | null
  logLines: string[]
  statusLine: string
  busy: boolean
  lastRefreshAt: number
  /** 停栈二次确认：按 D 后进入待确认态，再按 y 才执行。 */
  armedDown: boolean
}

export function initialState(partial: { provider: string; envFile: string }): TuiState {
  return {
    provider: partial.provider,
    envFile: partial.envFile,
    rows: [],
    selected: 0,
    showLogs: false,
    logService: null,
    logLines: [],
    statusLine: 'starting…',
    busy: false,
    lastRefreshAt: 0,
    armedDown: false
  }
}

/**
 * 解析 `compose ps --format json` 输出。不同 compose 版本对 JSON 数组与
 * JSON-lines 两种形状各有实现，这里两种都接受；完全不可解析时返回空表
 * （上层在状态行提示失败，不渲染假数据）。
 */
export function parseComposePs(stdout: string): TuiServiceRow[] {
  const text = stdout.trim()
  if (text.length === 0) return []
  const parseRow = (value: unknown): TuiServiceRow | null => {
    if (typeof value !== 'object' || value === null) return null
    const row = value as Record<string, unknown>
    if (typeof row.Name !== 'string' || typeof row.Service !== 'string') return null
    return {
      name: row.Name,
      service: row.Service,
      state: typeof row.State === 'string' ? row.State : 'unknown',
      health: typeof row.Health === 'string' ? row.Health : '',
      exitCode: typeof row.ExitCode === 'number' ? row.ExitCode : 0
    }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.map(parseRow).filter((row): row is TuiServiceRow => row !== null)
    }
    const single = parseRow(parsed)
    if (single) return [single]
  } catch {
    // JSON.parse 整体失败 → 尝试 JSON-lines
  }
  const rows: TuiServiceRow[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      const row = parseRow(JSON.parse(line))
      if (row) rows.push(row)
    } catch {
      // 非 JSON 行忽略
    }
  }
  return rows
}

/** 按键的归一化名：控制字节与转义序列折叠成语义键。 */
export type TuiKey =
  | 'up'
  | 'down'
  | 'quit'
  | 'logs'
  | 'refresh'
  | 'up-stack'
  | 'down-stack'
  | 'confirm'
  | 'other'

/** 解析按键输入流：转义序列与控制字节折叠为原始键串，半截序列留待下一块。 */
export function decodeKeyStream(
  chunk: Uint8Array,
  pending: string
): { keys: string[]; pending: string } {
  let buffer = pending + new TextDecoder().decode(chunk)
  const keys: string[] = []
  while (buffer.length > 0) {
    if (buffer.startsWith('\x1b[A')) {
      keys.push('\x1b[A')
      buffer = buffer.slice(3)
      continue
    }
    if (buffer.startsWith('\x1b[B')) {
      keys.push('\x1b[B')
      buffer = buffer.slice(3)
      continue
    }
    if (buffer.startsWith('\x1b[')) {
      // TUI 只消费上下方向键，其余 CSI 序列（如 ← 的 \x1b[D）必须整体吞掉：
      // 逐字节丢弃会把 D 落成单键而误触「停栈待确认」
      const end = csiTerminatorIndex(buffer)
      if (end === -1) break
      buffer = buffer.slice(end + 1)
      continue
    }
    if (buffer.startsWith('\x1b')) {
      // 孤 ESC 挂起到下一块（可能是序列前半段）；EOF 时外层循环直接结束
      if (buffer.length === 1) break
      keys.push('\x1b')
      buffer = buffer.slice(1)
      continue
    }
    const ch = buffer[0]
    if (ch === undefined) break
    keys.push(ch)
    buffer = buffer.slice(1)
  }
  return { keys, pending: buffer }
}

/** CSI 终止字节范围 0x40-0x7E；返回其在串中的下标，序列未完整返回 -1。 */
function csiTerminatorIndex(buffer: string): number {
  for (let i = 2; i < buffer.length; i++) {
    const code = buffer.charCodeAt(i)
    if (code >= 0x40 && code <= 0x7e) return i
  }
  return -1
}

export function normalizeKey(raw: string): TuiKey {
  if (raw === '\x1b[A') return 'up'
  if (raw === '\x1b[B') return 'down'
  if (raw === 'k') return 'up'
  if (raw === 'j') return 'down'
  if (raw === 'q' || raw === '\x03' || raw === '\x1b') return 'quit'
  if (raw === 'l' || raw === 'L') return 'logs'
  if (raw === 'r' || raw === 'R') return 'refresh'
  if (raw === 'u' || raw === 'U') return 'up-stack'
  if (raw === 'D') return 'down-stack'
  if (raw === 'y' || raw === 'Y') return 'confirm'
  return 'other'
}

export type TuiCommand =
  | { kind: 'none' }
  | { kind: 'quit' }
  | { kind: 'refresh' }
  | { kind: 'fetch-logs'; service: string }
  | { kind: 'up-stack' }
  | { kind: 'down-stack' }

/**
 * 纯按键状态机：更新选择/日志开关/停栈待确认，并产出需要执行的动作。
 * 选中行变化且日志窗格打开时自动重取该服务日志。
 */
export function handleKey(state: TuiState, key: TuiKey): { state: TuiState; command: TuiCommand } {
  if (key === 'quit') return { state, command: { kind: 'quit' } }
  if (key === 'refresh') {
    return { state: { ...state, armedDown: false }, command: { kind: 'refresh' } }
  }
  if (key === 'up-stack') {
    return {
      state: { ...state, armedDown: false, statusLine: '启动栈…' },
      command: { kind: 'up-stack' }
    }
  }
  if (key === 'down-stack') {
    return {
      state: { ...state, armedDown: true, statusLine: '确认停栈? 按 y 执行，其他键取消' },
      command: { kind: 'none' }
    }
  }
  if (key === 'confirm' && state.armedDown) {
    return {
      state: { ...state, armedDown: false, statusLine: '停栈…' },
      command: { kind: 'down-stack' }
    }
  }
  const next = { ...state, armedDown: false }
  if (key === 'up' || key === 'down') {
    const delta = key === 'up' ? -1 : 1
    const selected = Math.min(
      Math.max(state.selected + delta, 0),
      Math.max(state.rows.length - 1, 0)
    )
    const service = state.rows[selected]?.service ?? null
    const showLogs = state.showLogs && service !== null
    return {
      state: { ...next, selected, showLogs, logService: showLogs ? service : state.logService },
      command: showLogs && service ? { kind: 'fetch-logs', service } : { kind: 'none' }
    }
  }
  if (key === 'logs') {
    const service = state.rows[state.selected]?.service ?? null
    if (service === null) return { state: next, command: { kind: 'none' } }
    const showLogs = !state.showLogs
    return {
      state: { ...next, showLogs, logService: showLogs ? service : state.logService },
      command: showLogs ? { kind: 'fetch-logs', service } : { kind: 'none' }
    }
  }
  return { state: next, command: { kind: 'none' } }
}

// ── 渲染 ─────────────────────────────────────────────────────────────────

/** 行内 SGR 转义（\x1b[...m），用于渲染前剥离外来颜色码。 */
const ANSI_PATTERN = new RegExp('\\u001b\\[[0-9;?]*[A-Za-z]', 'g')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const INVERSE = '\x1b[7m'
const RESET = '\x1b[0m'

/** 行颜色：healthy 绿、失败/异常退出红、正常完成的一次性容器（bootstrap）暗灰、其余黄。 */
function rowColor(health: string, state: string, exitCode: number): string {
  if (health === 'healthy' || (state === 'running' && health === '')) return GREEN
  if (health === 'unhealthy' || state === 'dead' || (state === 'exited' && exitCode !== 0)) {
    return RED
  }
  if (state === 'exited') return DIM
  return YELLOW
}

function padCell(value: string, width: number): string {
  const plain = value.length > width ? `${value.slice(0, width - 1)}…` : value
  return plain.padEnd(width, ' ')
}

export type FrameOptions = { width?: number; height?: number; snapshot?: boolean; plain?: boolean }

/**
 * 渲染一帧。snapshot 模式（非 TTY/测试）不进入备用屏幕，只输出纯帧文本；
 * 交互模式由调用方负责进入/退出备用屏幕与光标控制，本函数只做内容与定位。
 */
export function renderFrame(state: TuiState, options: FrameOptions = {}): string {
  const width = options.width ?? 80
  const height = options.height ?? 24
  const lines: string[] = []

  const refreshed =
    state.lastRefreshAt > 0 ? new Date(state.lastRefreshAt).toISOString().slice(11, 19) : '--:--:--'
  lines.push(
    `${DIM}meristem deploy console${RESET}  provider=${state.provider}  refreshed=${refreshed}`
  )
  const status = state.statusLine.slice(0, Math.max(width - 4, 0))
  lines.push(`${DIM}${status}${RESET}`)
  lines.push('')

  const nameWidth = 26
  const serviceWidth = 13
  const stateWidth = 10
  const healthWidth = 10
  if (state.rows.length === 0) {
    lines.push(state.busy ? '读取服务状态…' : '(no containers; press u to start the stack)')
  } else {
    lines.push(
      `${DIM}${padCell('NAME', nameWidth)}${padCell('SERVICE', serviceWidth)}${padCell('STATE', stateWidth)}${padCell('HEALTH', healthWidth)}${RESET}`
    )
    state.rows.forEach((row, index) => {
      const selected = index === state.selected
      const cells =
        padCell(row.name, nameWidth) +
        padCell(row.service, serviceWidth) +
        padCell(row.state, stateWidth) +
        padCell(row.health, healthWidth)
      const color = rowColor(row.health, row.state, row.exitCode)
      const line = `${color}${cells}${RESET}`
      lines.push(selected ? `${INVERSE}${line}${RESET}` : line)
    })
  }

  // 日志窗格占据表格下方剩余空间；行数不足时仅显示提示行
  const reserve = 2 // 底部提示 + 缓冲
  const logsHeight = Math.max(height - lines.length - reserve, 0)
  if (state.showLogs && logsHeight > 0) {
    lines.push('')
    lines.push(`${DIM}── logs: ${state.logService ?? '(select a service)'} ──${RESET}`)
    const body = logsHeight - 1
    if (body > 0) {
      const tail = state.logLines.slice(-body)
      for (const raw of tail) {
        // 日志可能携带服务端 ANSI；先剥掉再按宽度截断，避免截进转义序列中间花屏
        const plain = raw.replace(ANSI_PATTERN, '')
        lines.push(plain.length > width ? `${plain.slice(0, width - 1)}…` : plain)
      }
    }
  }

  while (lines.length < height - 1) lines.push('')

  const hint = state.armedDown
    ? `${RED}确认停栈? 按 y 执行，其他键取消${RESET}`
    : `${DIM}↑/↓ 选择  l 日志  r 刷新  u 启动  D 停栈  q 退出${RESET}`
  lines.push(hint)

  let frame = lines
    .map(line => (line.length > width ? `${line.slice(0, width - 1)}…` : line))
    .join('\n')
  if (options.plain) frame = frame.replace(ANSI_PATTERN, '')
  if (options.snapshot) return `${frame}\n`
  // 交互模式：光标回原点 + 清屏到行尾，避免整屏闪动
  return `\x1b[H\x1b[2J${frame}`
}
