import {
  type DeployCommandDeps,
  type ComposePaths,
  resolveComposeContext
} from './deploy-common.ts'
import type { CliRunResult } from './types.ts'
import {
  type TuiState,
  decodeKeyStream,
  handleKey,
  initialState,
  normalizeKey,
  parseComposePs,
  renderFrame
} from './deploy-tui-render.ts'

// ── deploy tui：全屏部署控制台 ───────────────────────────────────────────
// 备用屏幕 + 原生 stdin 按键循环 + 3s 自动刷新；零 TUI 依赖，全部用
// ANSI 转义实现。非 TTY（管道/CI）自动退化为单帧快照输出，也让测试
// 可以不开 pty 直接断言渲染结果。

const REFRESH_INTERVAL_MS = 3000
const LOG_TAIL_LINES = 200

export async function runDeployTui(
  deps: DeployCommandDeps,
  overrides: { file?: string; envFile?: string }
): Promise<CliRunResult> {
  const compose = resolveComposeContext(deps, overrides)
  const paths: ComposePaths = compose.paths
  const state = initialState({ provider: compose.binary, envFile: paths.envFile })

  // 快照模式：stdin 或 stdout 非 TTY 时取一次状态渲染单帧后退出
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    await refreshRows(deps, compose, state)
    return {
      exitCode: 0,
      stdout: renderFrame(state, { snapshot: true, plain: true }),
      stderr: ''
    }
  }

  const write = (frame: string) => process.stdout.write(frame)
  // 进入备用屏幕、隐藏光标
  write('\x1b[?1049h\x1b[?25l')

  let running = true
  let busy = false
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    clearInterval(timer)
    process.stdin.setRawMode(false)
    // 退出备用屏幕、恢复光标
    write('\x1b[?25h\x1b[?1049l')
  }
  // 终端状态必须可恢复：信号退出同样走 cleanup，防止终端滞留 raw + 备用屏
  const exitHandler = () => {
    cleanup()
    process.exit(0)
  }
  process.on('SIGTERM', exitHandler)
  process.on('SIGHUP', exitHandler)

  // 周期刷新与按键动作共用 busy 互斥；所有异常收敛到状态行，不让
  // unhandled rejection 在 raw 模式下刷屏（provider 消失、ps 失败等）。
  const timer = setInterval(() => {
    void (async () => {
      if (busy || !running) return
      busy = true
      try {
        await refreshRows(deps, compose, state)
      } catch (error) {
        state.statusLine = `refresh failed: ${error instanceof Error ? error.message : 'unknown'}`
        state.busy = false
      } finally {
        busy = false
      }
      if (running) write(renderFrame(state))
    })()
  }, REFRESH_INTERVAL_MS)

  try {
    // 首次取数并渲染，再进入按键循环
    await refreshRows(deps, compose, state)
    write(renderFrame(state))

    let pending = ''
    for await (const chunk of Bun.stdin.stream()) {
      const decoded = decodeKeyStream(chunk, pending)
      pending = decoded.pending
      for (const rawKey of decoded.keys) {
        const key = normalizeKey(rawKey)
        const applied = handleKey(state, key)
        Object.assign(state, applied.state)

        if (applied.command.kind === 'quit') {
          running = false
          break
        }
        if (busy) continue
        const command = applied.command
        const needsRun =
          command.kind === 'refresh' ||
          command.kind === 'fetch-logs' ||
          command.kind === 'up-stack' ||
          command.kind === 'down-stack'
        if (!needsRun) continue
        busy = true
        try {
          if (command.kind === 'refresh') {
            await refreshRows(deps, compose, state)
          } else if (command.kind === 'fetch-logs') {
            await fetchLogs(deps, compose, state, command.service)
          } else {
            await runStackAction(deps, compose, state, command.kind)
            await refreshRows(deps, compose, state)
          }
        } catch (error) {
          state.statusLine = `action failed: ${error instanceof Error ? error.message : 'unknown'}`
          state.busy = false
        } finally {
          busy = false
        }
      }
      if (!running) break
      write(renderFrame(state))
    }
  } finally {
    process.off('SIGTERM', exitHandler)
    process.off('SIGHUP', exitHandler)
    cleanup()
  }
  return { exitCode: 0, stdout: '', stderr: '' }
}

/** 刷新服务状态行；ps 失败不退出 TUI，把错误显示在状态行。 */
async function refreshRows(
  deps: DeployCommandDeps,
  compose: { binary: string; args: string[] },
  state: TuiState
): Promise<void> {
  state.busy = true
  const result = await deps.run({
    binary: compose.binary,
    args: [...compose.args, 'ps', '--all', '--format', 'json'],
    stream: false
  })
  state.busy = false
  if (result.exitCode !== 0) {
    state.statusLine = `ps failed (${result.exitCode}): ${firstLine(result.stderr)}`
    return
  }
  const rows = parseComposePs(result.stdout)
  // 完全解析不出结构化行时保持空表 + 状态行提示，不渲染假数据。
  state.rows = rows
  state.selected = Math.min(state.selected, Math.max(rows.length - 1, 0))
  state.lastRefreshAt = Date.now()
  const healthy = rows.filter(row => row.health === 'healthy').length
  const completed = rows.filter(row => row.state === 'exited' && row.exitCode === 0).length
  state.statusLine =
    `${rows.length} services, ${healthy} healthy` +
    (completed > 0 ? `, ${completed} completed` : '')
}

async function fetchLogs(
  deps: DeployCommandDeps,
  compose: { binary: string; args: string[] },
  state: TuiState,
  service: string
): Promise<void> {
  state.logService = service
  const result = await deps.run({
    binary: compose.binary,
    args: [...compose.args, 'logs', '--tail', String(LOG_TAIL_LINES), service],
    stream: false
  })
  if (result.exitCode !== 0) {
    state.logLines = [`(logs failed: ${firstLine(result.stderr)})`]
    return
  }
  state.logLines = result.stdout.replace(/\r/g, '').split('\n')
}

async function runStackAction(
  deps: DeployCommandDeps,
  compose: { binary: string; args: string[] },
  state: TuiState,
  kind: 'up-stack' | 'down-stack'
): Promise<void> {
  const args =
    kind === 'up-stack'
      ? [...compose.args, 'up', '-d', '--build', '--remove-orphans']
      : [...compose.args, 'down', '--remove-orphans']
  const result = await deps.run({ binary: compose.binary, args, stream: false })
  state.statusLine =
    result.exitCode === 0
      ? kind === 'up-stack'
        ? 'stack started'
        : 'stack stopped'
      : `${kind} failed: ${firstLine(result.stderr)}`
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}
