type NodeJsUsageFinding = {
  file: string
  line: number
  reason: string
  snippet: string
}

// 这里只扫描仓库跟踪的 TS/TSX 和 package.json，聚焦 Bun-only 约束，而不是做通用静态分析器。
const trackedSourcePatterns = [
  'apps/**/*.ts',
  'apps/**/*.tsx',
  'services/**/*.ts',
  'services/**/*.tsx',
  'packages/**/*.ts',
  'packages/**/*.tsx',
  'scripts/**/*.ts',
  'scripts/**/*.tsx',
  'tests/**/*.ts',
  'tests/**/*.tsx'
] as const

const nodeImportPatterns: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: 'node:* import is forbidden',
    pattern: /\bfrom\s+['"]node:[^'"]+['"]/
  },
  {
    reason: 'node:* require is forbidden',
    pattern: /\brequire\((['"])node:[^'"]+\1\)/
  }
] as const

/**
 * 仓库级 Node.js 禁令只针对运行时和平台 API。
 * 领域里的 Core Node、Stem Node、Leaf Node 不属于禁令范围。
 */
export async function collectNodeJsUsageFindings(root: string): Promise<NodeJsUsageFinding[]> {
  const findings: NodeJsUsageFinding[] = []
  const files = new Set<string>()

  for (const pattern of trackedSourcePatterns) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: root, absolute: false })) {
      files.add(file)
    }
  }

  files.add('package.json')

  for (const file of [...files].sort()) {
    const text = await Bun.file(`${root}/${file}`).text()
    const lines = text.split('\n')

    for (const [index, line] of lines.entries()) {
      for (const rule of nodeImportPatterns) {
        if (rule.pattern.test(line)) {
          findings.push({
            file,
            line: index + 1,
            reason: rule.reason,
            snippet: line.trim()
          })
        }
      }
    }

    if (file !== 'package.json') continue

    // package.json 额外检查脚本和依赖，阻止有人用“代码没 import，但运行时靠 node”绕过禁令。
    const packageJson = JSON.parse(text) as {
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    for (const [scriptName, scriptValue] of Object.entries(packageJson.scripts ?? {})) {
      if (!/(^|\s)node(\s|$)/.test(scriptValue)) continue
      findings.push({
        file,
        line: 1,
        reason: `package script "${scriptName}" executes node`,
        snippet: scriptValue
      })
    }

    if (packageJson.dependencies?.['@nats-io/transport-node'] !== undefined) {
      findings.push({
        file,
        line: 1,
        reason: 'transport-node dependency is forbidden after Bun websocket migration',
        snippet: '@nats-io/transport-node'
      })
    }

    if (packageJson.devDependencies?.['@nats-io/transport-node'] !== undefined) {
      findings.push({
        file,
        line: 1,
        reason: 'transport-node devDependency is forbidden after Bun websocket migration',
        snippet: '@nats-io/transport-node'
      })
    }
  }

  return findings
}

function printFindings(findings: NodeJsUsageFinding[]): void {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.reason}`)
    console.error(`  ${finding.snippet}`)
  }
}

async function main(): Promise<void> {
  const findings = await collectNodeJsUsageFindings(process.cwd())
  if (findings.length === 0) return
  printFindings(findings)
  process.exitCode = 1
}

if (import.meta.main) {
  await main()
}
