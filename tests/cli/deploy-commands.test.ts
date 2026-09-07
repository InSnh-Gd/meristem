import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { createCliStatusMock } from '@meristem/testing'
import {
  createDeployCommands,
  DEPLOY_USAGE,
  type DeployCommandDeps,
  type DeployProcessResult
} from '../../apps/m-cli/src/commands/deploy-commands.ts'
import { type CliClient, type CliRunResult, createCliRunner } from '../../apps/m-cli/src/cli.ts'

// ---------------------------------------------------------------------------
// deploy 命令组测试：容器 provider 与 compose 全部经 fake runner 注入，
// 不依赖真实 docker/podman；真实端到端部署由 WSL2 环境验收覆盖。
// ---------------------------------------------------------------------------

const client: CliClient = { status: createCliStatusMock }

/**
 * 直接调用 handler 时不经过 cli.ts 的 try/catch 分派层，
 * 这里复刻同一语义：handler 抛错归一化为 exitCode 1 + stderr。
 */
async function run(args: string[]): Promise<CliRunResult> {
  try {
    return (
      (await createDeployCommands(makeDeps())(client, args)) ?? {
        exitCode: 1,
        stdout: '',
        stderr: 'deploy handler returned undefined\n'
      }
    )
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: `${(error as Error).message}\n` }
  }
}

/** 允许替换单个 deps 字段的变体（如自定义 run 返回值）。 */
async function runWithDeps(deps: DeployCommandDeps, args: string[]): Promise<CliRunResult> {
  try {
    return (
      (await createDeployCommands(deps)(client, args)) ?? {
        exitCode: 1,
        stdout: '',
        stderr: 'deploy handler returned undefined\n'
      }
    )
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: `${(error as Error).message}\n` }
  }
}

let tmpRoot: string
let runCalls: Array<{ binary: string; args: string[]; stream: boolean }>

/** 构造带真实临时 repoRoot 的 deps，ops/compose 资产按需落盘。 */
function makeDeps(which?: (binary: string) => string | null): DeployCommandDeps {
  return {
    repoRoot: tmpRoot,
    which: which ?? (binary => (binary === 'docker' ? '/usr/bin/docker' : null)),
    run: async input => {
      runCalls.push(input)
      return { exitCode: 0, stdout: '', stderr: '' } satisfies DeployProcessResult
    }
  }
}

/** 在临时 repoRoot 下准备默认 compose/env 文件，走默认路径解析。 */
function seedComposeAssets(): void {
  const dir = join(tmpRoot, 'ops/compose')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meristem.prod.yml'), 'name: meristem\n')
  writeFileSync(join(dir, 'meristem.prod.env'), 'MERISTEM_TAG=latest\n')
}

function seedEnvExample(): void {
  const dir = join(tmpRoot, 'ops/compose')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'meristem.prod.env.example'),
    [
      '# 模板',
      'POSTGRES_PASSWORD=change-me-strong-password',
      'OPENSEARCH_INITIAL_PASSWORD=change-me-opensearch',
      'MERISTEM_INTERNAL_TOKEN=change-me-internal-token',
      'MERISTEM_JWT_SECRET=change-me-jwt-secret',
      'MERISTEM_TAG=latest'
    ].join('\n')
  )
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(realpathSync('/tmp'), 'meristem-deploy-test-'))
  runCalls = []
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('meristem deploy — compose actions', () => {
  it('up 默认从源码构建并等待健康', async () => {
    seedComposeAssets()
    runCalls = []
    const result = await run(['deploy', 'up'])

    expect(result?.exitCode).toBe(0)
    expect(runCalls).toHaveLength(1)
    expect(runCalls[0]?.binary).toBe('docker')
    expect(runCalls[0]?.stream).toBe(true)
    expect(runCalls[0]?.args).toEqual([
      'compose',
      '-f',
      join(tmpRoot, 'ops/compose/meristem.prod.yml'),
      '--env-file',
      join(tmpRoot, 'ops/compose/meristem.prod.env'),
      'up',
      '-d',
      '--build',
      '--remove-orphans',
      '--wait'
    ])
  })

  it('up --pull 先拉取镜像再免构建启动，--timeout 映射 wait-timeout', async () => {
    seedComposeAssets()
    runCalls = []
    const result = await run(['deploy', 'up', '--pull', '--timeout', '600'])

    expect(result?.exitCode).toBe(0)
    expect(runCalls).toHaveLength(2)
    expect(runCalls[0]?.args.at(-1)).toBe('pull')
    expect(runCalls[1]?.args).toContain('up')
    expect(runCalls[1]?.args).not.toContain('--build')
    expect(runCalls[1]?.args).toContain('--wait-timeout')
    expect(runCalls[1]?.args.at(-1)).toBe('600')
  })

  it('up --pull 拉取失败时回退为本地构建而不是放弃部署', async () => {
    seedComposeAssets()
    runCalls = []
    const deps = makeDeps()
    deps.run = async input => {
      runCalls.push(input)
      return input.args.at(-1) === 'pull'
        ? { exitCode: 1, stdout: '', stderr: 'pull failed' }
        : { exitCode: 0, stdout: '', stderr: '' }
    }
    const result = await runWithDeps(deps, ['deploy', 'up', '--pull'])

    expect(result?.exitCode).toBe(0)
    expect(runCalls[0]?.args.at(-1)).toBe('pull')
    expect(runCalls[1]?.args).toContain('--build')
  })

  it('status / logs / down 按参数构造 compose 调用', async () => {
    seedComposeAssets()

    runCalls = []
    await run(['deploy', 'status'])
    expect(runCalls[0]?.args.slice(-2)).toEqual(['ps', '--all'])

    runCalls = []
    await run(['deploy', 'logs', 'm-net', '--tail', '20', '--follow'])
    expect(runCalls[0]?.args.slice(-5)).toEqual(['logs', '--tail', '20', '--follow', 'm-net'])

    runCalls = []
    await run(['deploy', 'down', '--volumes'])
    expect(runCalls[0]?.args.slice(-3)).toEqual(['down', '--volumes', '--remove-orphans'])
  })

  it('compose 非零退出码归一化为 CLI 失败', async () => {
    seedComposeAssets()
    runCalls = []
    const deps = makeDeps()
    deps.run = async input => {
      runCalls.push(input)
      return { exitCode: 3, stdout: '', stderr: '' }
    }
    const result = await runWithDeps(deps, ['deploy', 'up'])
    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: '' })
  })

  it('缺少 env 文件时提示 deploy init', async () => {
    // 不 seed env，仅放 compose 文件
    mkdirSync(join(tmpRoot, 'ops/compose'), { recursive: true })
    writeFileSync(join(tmpRoot, 'ops/compose/meristem.prod.yml'), 'name: meristem\n')
    rmSync(join(tmpRoot, 'ops/compose/meristem.prod.env'), { force: true })

    const result = await run(['deploy', 'status'])
    expect(result?.exitCode).toBe(1)
    expect(result?.stderr).toContain("run 'meristem deploy init'")
  })

  it('缺少 compose 文件时报出具体路径', async () => {
    rmSync(join(tmpRoot, 'ops/compose/meristem.prod.yml'), { force: true })
    writeFileSync(join(tmpRoot, 'ops/compose/meristem.prod.env'), 'MERISTEM_TAG=latest\n')

    const result = await run(['deploy', 'status'])
    expect(result?.exitCode).toBe(1)
    expect(result?.stderr).toContain('compose file not found')
  })

  it('找不到容器 provider 时给出安装提示', async () => {
    seedComposeAssets()
    const result = await runWithDeps(
      makeDeps(() => null),
      ['deploy', 'status']
    )
    expect(result?.exitCode).toBe(1)
    expect(result?.stderr).toContain('no container provider found')
  })

  it('非 deploy 参数不拦截，交回后续 handler', async () => {
    const result = await createDeployCommands(makeDeps())(client, ['status'])
    expect(result).toBeUndefined()
  })
})

describe('meristem deploy — token', () => {
  it('通过 compose run 读取 bootstrap 卷内 token 并输出 JSON', async () => {
    seedComposeAssets()
    runCalls = []
    const deps = makeDeps()
    deps.run = async input => {
      runCalls.push(input)
      return { exitCode: 0, stdout: 'ey-jwt-token\n', stderr: '' }
    }
    const result = await runWithDeps(deps, ['deploy', 'token', 'admin'])

    expect(result?.exitCode).toBe(0)
    expect(runCalls[0]?.stream).toBe(false)
    expect(runCalls[0]?.args.slice(-7)).toEqual([
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'cat',
      'bootstrap',
      '/bootstrap/tokens/admin.token'
    ])
    const payload = JSON.parse(result?.stdout ?? '{}') as { actor: string; token: string }
    expect(payload).toEqual({ actor: 'admin', token: 'ey-jwt-token' })
  })

  it('token 读取失败透传 stderr 并返回非零', async () => {
    seedComposeAssets()
    const deps = makeDeps()
    deps.run = async () => ({ exitCode: 1, stdout: '', stderr: 'cat: no such file\n' })
    const result = await runWithDeps(deps, ['deploy', 'token', 'admin'])
    expect(result?.exitCode).toBe(1)
    expect(result?.stderr).toContain('no such file')
  })

  it('拒绝携带路径穿越字符的 actor', async () => {
    seedComposeAssets()
    const result = await run(['deploy', 'token', '../other'])
    expect(result?.exitCode).toBe(1)
    expect(result?.stderr).toContain('actor must match')
  })
})

describe('meristem deploy — init', () => {
  it('从模板生成 env 文件：替换占位、收紧 0600、不回显密钥', async () => {
    seedEnvExample()
    runCalls = []
    const envPath = join(tmpRoot, 'ops/compose/meristem.prod.env')
    rmSync(envPath, { force: true })

    const result = await run(['deploy', 'init'])
    expect(result?.exitCode).toBe(0)

    const content = readFileSync(envPath, 'utf-8')
    expect(content).not.toContain('change-me')
    expect(content).toContain('MERISTEM_TAG=latest')
    expect(statSync(envPath).mode & 0o777).toBe(0o600)

    // 输出只包含路径与键名，不包含生成的密钥值
    expect(result?.stdout).toContain('"generatedKeys"')
    expect(result?.stdout).not.toContain('base64')

    // 重复执行默认拒绝覆盖，--force 才允许
    const again = await run(['deploy', 'init'])
    expect(again?.exitCode).toBe(1)
    expect(again?.stderr).toContain('--force')
    const forced = await run(['deploy', 'init', '--force'])
    expect(forced?.exitCode).toBe(0)
  })

  it('模板缺占位符时失败，避免静默产出不可用 env', async () => {
    const dir = join(tmpRoot, 'ops/compose')
    writeFileSync(
      join(dir, 'meristem.prod.env.example'),
      'POSTGRES_PASSWORD=change-me-strong-password\n'
    )
    rmSync(join(dir, 'meristem.prod.env'), { force: true })

    const result = await run(['deploy', 'init'])
    expect(result?.exitCode).toBe(1)
    expect(result?.stderr).toContain('missing expected placeholder')
  })
})

describe('meristem deploy — CLI 注册', () => {
  it('通过 createCliRunner 可达且无 action 时输出 usage', async () => {
    seedComposeAssets()
    const cli = createCliRunner(client)
    const result = await cli.run(['deploy'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('usage: meristem deploy')
    expect(result.stderr).toContain(DEPLOY_USAGE)
  })

  it('未知 deploy action 报错并列出合法动作', async () => {
    seedComposeAssets()
    const result = await run(['deploy', 'destroy'])
    expect(result?.exitCode).toBe(1)
    expect(result?.stderr).toContain('unknown deploy action: destroy')
  })
})
