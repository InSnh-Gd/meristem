import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import {
  createSidecarSupervisor,
  type SpawnedSidecarProcess
} from '../../services/node-agent/src/node-agent-sidecar-supervisor.ts'

type FakeProcess = {
  spawned: SpawnedSidecarProcess
  exit: (code: number) => void
}

function createFakeSpawn(overrides?: Partial<SpawnedSidecarProcess>) {
  const spawnedProcesses: FakeProcess[] = []
  const spawn = (argv: string[]): SpawnedSidecarProcess => {
    let exitFn: (code: number) => void = () => {}
    const exited = new Promise<number>(resolve => {
      exitFn = resolve
    })
    const proc: FakeProcess = {
      spawned: {
        pid: 4000 + spawnedProcesses.length,
        exited,
        kill: signal => {
          if (overrides?.kill) {
            overrides.kill(signal)
            return
          }
          exitFn(signal === 15 ? 0 : 137)
        }
      },
      exit: exitFn
    }
    spawnedProcesses.push(proc)
    return proc.spawned
  }
  return {
    spawn: ((argv: string[]) => spawn(argv)) as (
      argv: string[],
      env: Record<string, string>
    ) => SpawnedSidecarProcess,
    processes: spawnedProcesses
  }
}

const BASE_OPTIONS = {
  binaryPath: '/usr/bin/netbird-fixture',
  configPath: '/run/meristem/netbird/sidecar.json',
  restartBackoffMs: [5, 5, 5],
  stopGraceMs: 20
}

describe('node-agent sidecar supervisor', () => {
  it('rejects config paths that escape the declared directory boundary', async () => {
    const fake = createFakeSpawn()
    const supervisor = createSidecarSupervisor({
      ...BASE_OPTIONS,
      configPath: '/run/meristem/../../etc/passwd',
      spawn: fake.spawn
    })
    const result = await supervisor.start()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('path.traversal')
    }
    expect(fake.processes).toHaveLength(0)
  })

  it('spawns the client with config path argv and reports running', async () => {
    const fake = createFakeSpawn()
    const supervisor = createSidecarSupervisor({ ...BASE_OPTIONS, spawn: fake.spawn })
    const result = await supervisor.start()
    expect(result).toMatchObject({ ok: true, alreadyRunning: false })
    expect(supervisor.state()).toMatchObject({ kind: 'running' })
    expect(fake.processes[0]?.spawned.pid).toBe(4000)
    // 重启退避在成功运行后清零：人为崩溃一次后应再次拉起
    fake.processes[0]?.exit(1)
    await Bun.sleep(80)
    expect(fake.processes.length).toBeGreaterThanOrEqual(2)
    expect(supervisor.state().kind).toBe('running')
    await supervisor.stop()
  })

  it('gives up after exhausting the restart backoff and stops restarting', async () => {
    const fake = createFakeSpawn()
    // 每个新进程立刻崩溃
    const supervisor = createSidecarSupervisor({
      ...BASE_OPTIONS,
      spawn: (argv, env) => {
        const proc = fake.spawn(argv, env)
        // 进程立即以非零退出，模拟持续崩溃
        queueMicrotask(() => fake.processes[fake.processes.length - 1]?.exit(1))
        return proc
      }
    })
    const result = await supervisor.start()
    expect(result.ok).toBe(true)
    await Bun.sleep(150)
    expect(supervisor.state()).toMatchObject({ kind: 'gave_up', attempts: 3 })
    const count = fake.processes.length
    await Bun.sleep(60)
    expect(fake.processes.length).toBe(count)
    await supervisor.stop()
  })

  it('stops gracefully with SIGTERM and escalates to SIGKILL after grace window', async () => {
    const signals: number[] = []
    const fake = createFakeSpawn({
      kill: signal => {
        signals.push(signal ?? 0)
        // SIGTERM 后不退出，模拟卡住进程，逼出 SIGKILL 升级路径
      }
    })
    const supervisor = createSidecarSupervisor({
      ...BASE_OPTIONS,
      stopGraceMs: 30,
      spawn: fake.spawn
    })
    await supervisor.start()
    await supervisor.stop()
    expect(signals).toEqual([15, 9])
    expect(supervisor.state().kind).toBe('stopped')
  })

  it('health probe fails when supervisor is not running and succeeds when running', async () => {
    const fake = createFakeSpawn()
    const tempDir = await mkdtemp(join(tmpdir(), 'meristem-sidecar-test-'))
    const configPath = join(tempDir, 'sidecar.json')
    await Bun.write(configPath, `${JSON.stringify({ desiredState: 'start' })}\n`)
    try {
      const supervisor = createSidecarSupervisor({
        ...BASE_OPTIONS,
        configPath,
        spawn: fake.spawn
      })
      const before = await supervisor.healthProbe()
      expect(before.ok).toBe(false)
      if (!before.ok) expect(before.reason).toBe('process.not_running')
      await supervisor.start()
      const after = await supervisor.healthProbe()
      expect(after.ok).toBe(true)
      await supervisor.stop()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
