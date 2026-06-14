type SkillHygieneFinding = {
  path: string
  reason: string
}

const MAX_SKILL_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 1024
const MAX_BODY_LINES = 150
const ALLOWED_FRONTMATTER_KEYS = new Set(['name', 'description'])

/**
 * 校验项目 skill 的最小可发现性契约，避免依赖 Python/YAML 工具链。
 */
export function validateSkillMarkdown(path: string, text: string): SkillHygieneFinding[] {
  const findings: SkillHygieneFinding[] = []
  const frontmatter = parseFrontmatter(text)

  if (!frontmatter) {
    return [{ path, reason: 'missing YAML frontmatter' }]
  }

  const keys = Object.keys(frontmatter.values)
  for (const key of keys) {
    if (!ALLOWED_FRONTMATTER_KEYS.has(key)) {
      findings.push({ path, reason: `unexpected frontmatter key "${key}"` })
    }
  }

  const name = frontmatter.values.name
  if (!name) {
    findings.push({ path, reason: 'missing skill name' })
  } else {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      findings.push({ path, reason: 'skill name must use lowercase hyphen-case' })
    }
    if (name.length > MAX_SKILL_NAME_LENGTH) {
      findings.push({
        path,
        reason: `skill name must be ${MAX_SKILL_NAME_LENGTH} characters or fewer`
      })
    }
  }

  const description = frontmatter.values.description
  if (!description) {
    findings.push({ path, reason: 'missing skill description' })
  } else {
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      findings.push({
        path,
        reason: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`
      })
    }
    if (!description.includes('Use when')) {
      findings.push({ path, reason: 'description must include "Use when" trigger wording' })
    }
  }

  if (frontmatter.bodyLineCount > MAX_BODY_LINES) {
    findings.push({ path, reason: `skill body should stay at or below ${MAX_BODY_LINES} lines` })
  }

  return findings
}

/**
 * 扫描仓库项目 skill，作为 Bun-only skill hygiene 门禁。
 */
export async function collectSkillHygieneFindings(root: string): Promise<SkillHygieneFinding[]> {
  const findings: SkillHygieneFinding[] = []
  const seen = new Set<string>()

  for await (const path of new Bun.Glob('.agents/skills/*/SKILL.md').scan({
    cwd: root,
    absolute: false
  })) {
    seen.add(path)
    const text = await Bun.file(`${root}/${path}`).text()
    findings.push(...validateSkillMarkdown(path, text))
  }

  for await (const skillDir of new Bun.Glob('.agents/skills/*').scan({
    cwd: root,
    absolute: false,
    onlyFiles: false
  })) {
    if (seen.has(`${skillDir}/SKILL.md`)) continue
    findings.push({ path: skillDir, reason: 'skill directory is missing SKILL.md' })
  }

  return findings
}

function parseFrontmatter(
  text: string
): { values: Record<string, string>; bodyLineCount: number } | null {
  const lines = text.split('\n')
  if (lines[0] !== '---') return null

  const closingIndex = lines.indexOf('---', 1)
  if (closingIndex === -1) return null

  const values: Record<string, string> = {}
  for (const line of lines.slice(1, closingIndex)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    const [, key, value] = match
    if (key === undefined || value === undefined) continue
    values[key] = value.trim()
  }

  return {
    values,
    bodyLineCount: lines.slice(closingIndex + 1).length
  }
}

function printFindings(findings: SkillHygieneFinding[]): void {
  for (const finding of findings) {
    console.error(`${finding.path}: ${finding.reason}`)
  }
}

if (import.meta.main) {
  const findings = await collectSkillHygieneFindings(process.cwd())
  if (findings.length > 0) {
    printFindings(findings)
    process.exit(1)
  }
  console.log('skill hygiene checks passed')
}
