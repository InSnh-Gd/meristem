import { describe, expect, it } from 'bun:test'
import {
  type TuiState,
  decodeKeyStream,
  handleKey,
  initialState,
  normalizeKey,
  parseComposePs,
  renderFrame
} from '../../apps/m-cli/src/commands/deploy-tui-render.ts'

// ---------------------------------------------------------------------------
// TUI 纯模型层测试：ps JSON 解析、按键状态机、帧渲染。
// 交互循环（raw stdin / 备用屏幕）由 WSL2 pty 验收覆盖。
// ---------------------------------------------------------------------------

function rowsState(
  rows: Parameters<typeof initialState> extends never ? never : TuiState['rows']
): TuiState {
  const state = initialState({ provider: 'docker', envFile: '/repo/ops/compose/meristem.prod.env' })
  state.rows = rows
  state.statusLine = '3 services, 2 healthy'
  state.lastRefreshAt = 1760000000000
  return state
}

const sampleRows = [
  { name: 'meristem-core-1', service: 'core', state: 'running', health: 'healthy', exitCode: 0 },
  {
    name: 'meristem-m-net-1',
    service: 'm-net',
    state: 'running',
    health: 'unhealthy',
    exitCode: 0
  },
  { name: 'meristem-bootstrap-1', service: 'bootstrap', state: 'exited', health: '', exitCode: 0 }
]

describe('deploy tui — parseComposePs', () => {
  it('解析 JSON 数组形状（docker compose v2 新版）', () => {
    const rows = parseComposePs(
      JSON.stringify([
        {
          Name: 'meristem-core-1',
          Service: 'core',
          State: 'running',
          Health: 'healthy',
          ExitCode: 0
        },
        { Name: 'meristem-m-net-1', Service: 'm-net', State: 'running', Health: '', ExitCode: 0 }
      ])
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      name: 'meristem-core-1',
      service: 'core',
      state: 'running',
      health: 'healthy',
      exitCode: 0
    })
    expect(rows[1]?.health).toBe('')
  })

  it('解析 JSON-lines 形状（旧版 compose）', () => {
    const rows = parseComposePs(
      [
        JSON.stringify({ Name: 'a-1', Service: 'core', State: 'exited', ExitCode: 1 }),
        JSON.stringify({ Name: 'b-1', Service: 'm-log', State: 'running', Health: 'healthy' })
      ].join('\n')
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]?.exitCode).toBe(1)
    expect(rows[1]?.health).toBe('healthy')
  })

  it('空输出与不可解析输出都返回空表，不抛错', () => {
    expect(parseComposePs('')).toEqual([])
    expect(parseComposePs('NAME IMAGE STATUS\nfoo bar baz')).toEqual([])
  })
})

describe('deploy tui — 按键状态机', () => {
  it('归一化转义序列、控制字节与单键', () => {
    expect(normalizeKey('\x1b[A')).toBe('up')
    expect(normalizeKey('\x1b[B')).toBe('down')
    expect(normalizeKey('q')).toBe('quit')
    expect(normalizeKey('\x03')).toBe('quit')
    expect(normalizeKey('D')).toBe('down-stack')
    expect(normalizeKey('y')).toBe('confirm')
    expect(normalizeKey('x')).toBe('other')
  })

  it('上下移动并夹紧边界；日志开启时移动自动重取日志', () => {
    const state = rowsState(sampleRows)
    const down = handleKey(state, 'down')
    expect(down.state.selected).toBe(1)
    expect(down.command).toEqual({ kind: 'none' })

    const downWithLogs = handleKey({ ...state, showLogs: true, logService: 'core' }, 'down')
    expect(downWithLogs.command).toEqual({ kind: 'fetch-logs', service: 'm-net' })

    const clamped = handleKey({ ...down.state, showLogs: true, logService: 'm-net' }, 'up')
    expect(clamped.state.selected).toBe(0)

    const topClamp = handleKey({ ...state, selected: 0 }, 'up')
    expect(topClamp.state.selected).toBe(0)
  })

  it('l 开关日志窗格并触发取日志；再次 l 关闭', () => {
    const state = rowsState(sampleRows)
    const open = handleKey(state, 'logs')
    expect(open.state.showLogs).toBe(true)
    expect(open.state.logService).toBe('core')
    expect(open.command).toEqual({ kind: 'fetch-logs', service: 'core' })

    const close = handleKey(open.state, 'logs')
    expect(close.state.showLogs).toBe(false)
    expect(close.command).toEqual({ kind: 'none' })

    const noRows = handleKey(initialState({ provider: 'docker', envFile: '/e' }), 'logs')
    expect(noRows.command).toEqual({ kind: 'none' })
  })

  it('停栈需要 D 再 y 二次确认；其他按键解除待确认', () => {
    const state = rowsState(sampleRows)
    const armed = handleKey(state, 'down-stack')
    expect(armed.state.armedDown).toBe(true)
    expect(armed.command).toEqual({ kind: 'none' })

    const cancelled = handleKey(armed.state, 'other')
    expect(cancelled.state.armedDown).toBe(false)

    const confirmed = handleKey(handleKey(state, 'down-stack').state, 'confirm')
    expect(confirmed.command).toEqual({ kind: 'down-stack' })
    expect(confirmed.state.armedDown).toBe(false)

    // 未 armed 时 y 不触发任何动作
    const strayY = handleKey(state, 'confirm')
    expect(strayY.command).toEqual({ kind: 'none' })
  })

  it('u 触发启动栈；q 退出；r 触发刷新', () => {
    const state = rowsState(sampleRows)
    expect(handleKey(state, 'up-stack').command).toEqual({ kind: 'up-stack' })
    expect(handleKey(state, 'quit').command).toEqual({ kind: 'quit' })
    expect(handleKey(state, 'refresh').command).toEqual({ kind: 'refresh' })
  })
})

describe('deploy tui — decodeKeyStream', () => {
  it('拆出方向键转义序列与单键，处理跨 chunk 的半截序列', () => {
    const first = decodeKeyStream(new TextEncoder().encode('\x1b[Bq\x1b['), '')
    expect(first.keys).toEqual(['\x1b[B', 'q'])
    expect(first.pending).toBe('\x1b[')

    const second = decodeKeyStream(new TextEncoder().encode('A'), first.pending)
    expect(second.keys).toEqual(['\x1b[A'])
    expect(second.pending).toBe('')
  })

  it('未知 CSI 序列整体吞掉，不产生幻影键（← 不得落成 D=停栈）', () => {
    const decoded = decodeKeyStream(new TextEncoder().encode('\x1b[Dx\x1b[1;5Aq'), '')
    expect(decoded.keys).toEqual(['x', 'q'])
    expect(decoded.pending).toBe('')
  })

  it('行尾孤 ESC 挂起等待下一块，不立即当退出键', () => {
    const decoded = decodeKeyStream(new TextEncoder().encode('x\x1b'), '')
    expect(decoded.keys).toEqual(['x'])
    expect(decoded.pending).toBe('\x1b')
    // 下一块到达后孤 ESC 作为退出键出现
    const followup = decodeKeyStream(new TextEncoder().encode('q'), decoded.pending)
    expect(followup.keys).toEqual(['\x1b', 'q'])
  })
})

describe('deploy tui — renderFrame', () => {
  it('快照帧包含表头、行、健康列与按键提示，且不含备用屏幕转义', () => {
    const state = rowsState(sampleRows)
    const frame = renderFrame(state, { snapshot: true })

    expect(frame.startsWith('\x1b[H')).toBe(false)
    expect(frame.endsWith('\n')).toBe(true)
    expect(frame).toContain('meristem deploy console')
    expect(frame).toContain('meristem-core-1')
    expect(frame).toContain('HEALTH')
    expect(frame).toContain('↑/↓ 选择')
    expect(frame).toContain('\x1b[7m') // 选中行反显
    expect(frame).toContain('\x1b[32m') // healthy 绿色
    expect(frame).toContain('\x1b[31m') // unhealthy/exited 红色
  })

  it('日志窗格开启时渲染最近日志行；关闭时只显示表格', () => {
    const state = rowsState(sampleRows)
    state.showLogs = true
    state.logService = 'core'
    state.logLines = ['line-1', 'line-2', 'line-3']
    const frame = renderFrame(state, { snapshot: true, height: 14 })
    expect(frame).toContain('── logs: core ──')
    expect(frame).toContain('line-3')

    const closed = rowsState(sampleRows)
    const closedFrame = renderFrame(closed, { snapshot: true })
    expect(closedFrame).not.toContain('── logs:')
  })

  it('正常退出（exitCode 0）的一次性容器用暗色而非红色', () => {
    const state = rowsState([
      { name: 'bootstrap', service: 'bootstrap', state: 'exited', health: '', exitCode: 0 },
      { name: 'crashed', service: 'core', state: 'exited', health: '', exitCode: 1 }
    ])
    const frame = renderFrame(state, { snapshot: true })
    const bootstrapLine = frame.split('\n').find(line => line.includes('bootstrap')) ?? ''
    const crashedLine = frame.split('\n').find(line => line.includes('crashed')) ?? ''
    expect(bootstrapLine).toContain('\x1b[2m') // DIM
    expect(crashedLine).toContain('\x1b[31m') // RED
  })

  it('停栈待确认时提示替换为确认文案', () => {
    const state = rowsState(sampleRows)
    state.armedDown = true
    const frame = renderFrame(state, { snapshot: true })
    expect(frame).toContain('确认停栈')
  })

  it('空表时提示可按 u 启动', () => {
    const state = initialState({ provider: 'docker', envFile: '/e' })
    const frame = renderFrame(state, { snapshot: true })
    expect(frame).toContain('no containers')
  })
})
