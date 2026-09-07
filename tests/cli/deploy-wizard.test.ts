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
import type {
  DeployCommandDeps,
  DeployProcessResult
} from '../../apps/m-cli/src/commands/deploy-common.ts'
import { runDeployWizard } from '../../apps/m-cli/src/commands/deploy-wizard.ts'

// ---------------------------------------------------------------------------
// wizard 测试：prompter 与 compose 执行全部注入，验证问答流程、
// env 生成与部署调用编排；真实端到端由 WSL2 环境验收覆盖。
// ---------------------------------------------------------------------------

let tmpRoot: string
const runCalls: Array<{ binary: string; args: string[]; stream: boolean }> = []

/** 按脚本顺序应答的 fake prompter，记录每个问题供断言。 */
function scriptedPrompter(answers: Array<string | boolean>) {
  const questions: string[] = []
  let index = 0
  return {
    questions,
    prompter: {
      async text(question: string, fallback: string) {
        questions.push(question)
        const answer = answers[index++]
        if (typeof answer !== 'string') throw new Error(`expected text answer for: ${question}`)
        return answer.length > 0 ? answer : fallback
      },
      async bool(question: string) {
        questions.push(question)
        const answer = answers[index++]
        if (typeof answer !== 'boolean') throw new Error(`expected bool answer for: ${question}`)
        return answer
      }
    }
  }
}

function makeDeps(logs: string[]): DeployCommandDeps {
  return {
    repoRoot: tmpRoot,
    which: binary => (binary === 'docker' ? '/usr/bin/docker' : null),
    run: async input => {
      runCalls.push(input)
      // token 调用（compose run ... cat）返回一个假 token，其余返回成功
      if (input.args.includes('cat')) {
        return { exitCode: 0, stdout: 'fake-token\n', stderr: '' } satisfies DeployProcessResult
      }
      return { exitCode: 0, stdout: '', stderr: '' } satisfies DeployProcessResult
    },
    log: line => logs.push(line)
  }
}

function seedRepo(): void {
  const dir = join(tmpRoot, 'ops/compose')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meristem.prod.yml'), 'name: meristem\n')
  // 各测试独立：清掉上一个测试留下的 env，保证问答脚本与问题序列一致
  rmSync(join(dir, 'meristem.prod.env'), { force: true })
  writeFileSync(
    join(dir, 'meristem.prod.env.example'),
    [
      'POSTGRES_PASSWORD=change-me-strong-password',
      'OPENSEARCH_INITIAL_PASSWORD=change-me-opensearch',
      'MERISTEM_INTERNAL_TOKEN=change-me-internal-token',
      'MERISTEM_JWT_SECRET=change-me-jwt-secret',
      'MERISTEM_CORE_PORT=3000',
      'MERISTEM_BFF_PORT=3200',
      'MERISTEM_UI_PORT=8080',
      'MERISTEM_JOIN_INGRESS_PORT=8443',
      'MERISTEM_JOIN_PUBLIC_URL=https://localhost:8443',
      'MERISTEM_PUBLIC_BFF_URL=http://localhost:3200',
      'MERISTEM_BOOTSTRAP_ACTORS=admin'
    ].join('\n')
  )
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(realpathSync('/tmp'), 'meristem-wizard-test-'))
  runCalls.length = 0
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('meristem deploy wizard', () => {
  it('快速路径：全部默认值生成 env 并执行部署，不取 token', async () => {
    seedRepo()
    runCalls.length = 0
    const { prompter } = scriptedPrompter([true, true, false]) // quick / confirm / token
    const logs: string[] = []

    const result = await runDeployWizard(makeDeps(logs), prompter, {}, { timeout: '60' })

    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as { deployed: boolean; uiUrl: string }
    expect(payload.deployed).toBe(true)
    expect(payload.uiUrl).toBe('http://localhost:8080')

    // env：占位符全部替换、0600、默认端口保留
    const envPath = join(tmpRoot, 'ops/compose/meristem.prod.env')
    const content = readFileSync(envPath, 'utf-8')
    expect(content).not.toContain('change-me')
    expect(content).toContain('MERISTEM_CORE_PORT=3000')
    expect(statSync(envPath).mode & 0o777).toBe(0o600)

    // compose 只调用一次 up（含 --build --wait），未取 token
    expect(runCalls).toHaveLength(1)
    expect(runCalls[0]?.args).toContain('--wait')
    expect(runCalls[0]?.args).toContain('--build')
    expect(runCalls[0]?.stream).toBe(true)
  })

  it('自定义路径：端口/地址/actor 写入 env，PUBLIC_BFF 随 BFF 端口派生', async () => {
    seedRepo()
    runCalls.length = 0
    const { prompter } = scriptedPrompter([
      false, // quick=false
      '3100', // core
      '3201', // bff
      '8081', // ui
      '9443', // join port
      'https://join.example.com', // join public url
      'http://localhost:3201', // browser bff url
      'admin,operator', // actors
      true, // confirm
      false // token
    ])

    const result = await runDeployWizard(makeDeps([]), prompter, {}, {})

    expect(result.exitCode).toBe(0)
    const content = readFileSync(join(tmpRoot, 'ops/compose/meristem.prod.env'), 'utf-8')
    expect(content).toContain('MERISTEM_CORE_PORT=3100')
    expect(content).toContain('MERISTEM_BFF_PORT=3201')
    expect(content).toContain('MERISTEM_UI_PORT=8081')
    expect(content).toContain('MERISTEM_JOIN_INGRESS_PORT=9443')
    expect(content).toContain('MERISTEM_JOIN_PUBLIC_URL=https://join.example.com')
    expect(content).toContain('MERISTEM_PUBLIC_BFF_URL=http://localhost:3201')
    expect(content).toContain('MERISTEM_BOOTSTRAP_ACTORS=admin,operator')
  })

  it('立即取 token：读取首个 actor 并输出 JSON', async () => {
    seedRepo()
    runCalls.length = 0
    const { prompter } = scriptedPrompter([
      false, // quick=false
      '3100', // core
      '3201', // bff
      '8081', // ui
      '9443', // join port
      'https://join.example.com', // join public url
      'http://localhost:3201', // browser bff url
      'operator,security-admin', // actors：首个是 operator
      true, // confirm
      true // token
    ])

    const result = await runDeployWizard(makeDeps([]), prompter, {}, {})

    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as { actor: string; token: string }
    expect(payload.actor).toBe('operator')
    expect(payload.token).toBe('fake-token')
    const tokenCall = runCalls.find(call => call.args.includes('cat'))
    expect(tokenCall?.args.at(-1)).toBe('/bootstrap/tokens/operator.token')
  })

  it('env 已存在且拒绝覆盖时中止，不触发 compose', async () => {
    seedRepo()
    writeFileSync(join(tmpRoot, 'ops/compose/meristem.prod.env'), 'MERISTEM_TAG=latest\n')
    runCalls.length = 0
    const { prompter } = scriptedPrompter([false]) // overwrite=false

    const result = await runDeployWizard(makeDeps([]), prompter, {}, {})

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("run 'meristem deploy up'")
    expect(runCalls).toHaveLength(0)
  })

  it('重新配置已有部署：保留旧密钥，仅更新端口等配置项', async () => {
    seedRepo()
    const envPath = join(tmpRoot, 'ops/compose/meristem.prod.env')
    // 既有部署的 env：密钥是首次初始化时的值，端口要改
    writeFileSync(
      envPath,
      [
        'POSTGRES_PASSWORD=old-db-password',
        'OPENSEARCH_INITIAL_PASSWORD=old-os-password',
        'MERISTEM_INTERNAL_TOKEN=old-internal-token',
        'MERISTEM_JWT_SECRET=old-jwt-secret',
        'MERISTEM_CORE_PORT=3000',
        'MERISTEM_UI_PORT=8080',
        'MERISTEM_BOOTSTRAP_ACTORS=admin'
      ].join('\n')
    )
    runCalls.length = 0
    const { prompter } = scriptedPrompter([
      true, // keep secrets
      false, // quick=false
      '3100', // core
      '3201', // bff
      '8081', // ui
      '9443', // join port
      'https://localhost:9443', // join url
      'http://localhost:3201', // browser bff url
      'admin', // actors
      true, // confirm
      false // token
    ])

    const result = await runDeployWizard(makeDeps([]), prompter, {}, {})

    expect(result.exitCode).toBe(0)
    const content = readFileSync(envPath, 'utf-8')
    // 密钥与既有数据卷继续匹配
    expect(content).toContain('POSTGRES_PASSWORD=old-db-password')
    expect(content).toContain('MERISTEM_JWT_SECRET=old-jwt-secret')
    // 配置项已更新
    expect(content).toContain('MERISTEM_CORE_PORT=3100')
    expect(content).toContain('MERISTEM_UI_PORT=8081')
    expect(statSync(envPath).mode & 0o777).toBe(0o600)
  })

  it('重新配置时旧 env 缺密钥键：显式失败而不是静默换随机密钥', async () => {
    seedRepo()
    const envPath = join(tmpRoot, 'ops/compose/meristem.prod.env')
    // 模拟用户手删 MERISTEM_JWT_SECRET 行
    writeFileSync(
      envPath,
      [
        'POSTGRES_PASSWORD=old-db-password',
        'OPENSEARCH_INITIAL_PASSWORD=old-os-password',
        'MERISTEM_INTERNAL_TOKEN=old-internal-token',
        'MERISTEM_CORE_PORT=3000'
      ].join('\n')
    )
    runCalls.length = 0
    const { prompter } = scriptedPrompter([
      true, // keep secrets
      true, // quick
      true // confirm
    ])

    // 直接调用 handler 时错误向上抛出（cli.ts 分派层统一转为 exitCode 1）
    expect(runDeployWizard(makeDeps([]), prompter, {}, {})).rejects.toThrow('missing secret keys')
    expect(runCalls).toHaveLength(0)
  })

  it('自定义 actor 含非法字符时拒绝部署', async () => {
    seedRepo()
    runCalls.length = 0
    const { prompter } = scriptedPrompter([
      false, // quick=false
      '3000', // core
      '3200', // bff
      '8080', // ui
      '8443', // join port
      'https://localhost:8443', // join url
      'http://localhost:3200', // bff url
      'admin,../evil', // actors：非法
      true, // confirm
      false // token
    ])

    expect(runDeployWizard(makeDeps([]), prompter, {}, {})).rejects.toThrow('invalid actor names')
    expect(runCalls).toHaveLength(0)
  })

  it('确认=false 时中止且不写 env', async () => {
    seedRepo()
    runCalls.length = 0
    const { prompter } = scriptedPrompter([true, false]) // quick=true / confirm=false

    const result = await runDeployWizard(makeDeps([]), prompter, {}, {})

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('aborted')
    expect(runCalls).toHaveLength(0)
    expect(existsSyncSafe()).toBe(false)
  })

  it('部署失败时透传非零退出码', async () => {
    seedRepo()
    runCalls.length = 0
    const deps = makeDeps([])
    deps.run = async input => {
      runCalls.push(input)
      return { exitCode: 3, stdout: '', stderr: 'boom' }
    }
    const { prompter } = scriptedPrompter([true, true])

    const result = await runDeployWizard(deps, prompter, {}, {})

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
  })
})

/** init 动作由 deploy-commands 测试覆盖；这里只辅助确认 env 是否落盘。 */
function existsSyncSafe(): boolean {
  try {
    return statSync(join(tmpRoot, 'ops/compose/meristem.prod.env')).isFile()
  } catch {
    return false
  }
}
