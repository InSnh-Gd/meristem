import { describe, expect, it } from 'bun:test'
import { collectSkillHygieneFindings, validateSkillMarkdown } from '../../scripts/skill-hygiene.ts'

describe('skill hygiene scanner', () => {
  it('accepts project skills with valid frontmatter and focused body size', () => {
    const findings = validateSkillMarkdown(
      '.agents/skills/meristem-example/SKILL.md',
      [
        '---',
        'name: meristem-example',
        'description: Use when validating Meristem example skills.',
        '---',
        '',
        '# Meristem Example',
        '',
        '## Rules',
        '',
        '- Keep the skill focused.'
      ].join('\n')
    )

    expect(findings).toEqual([])
  })

  it('rejects malformed skill names, missing trigger descriptions, and oversized bodies', () => {
    const findings = validateSkillMarkdown(
      '.agents/skills/Bad Skill/SKILL.md',
      [
        '---',
        'name: Bad Skill',
        'description: Missing trigger wording.',
        'owner: local',
        '---',
        ...Array.from({ length: 151 }, (_, index) => `line ${index}`)
      ].join('\n')
    )

    expect(findings.map(finding => finding.reason)).toEqual([
      'unexpected frontmatter key "owner"',
      'skill name must use lowercase hyphen-case',
      'description must include "Use when" trigger wording',
      'skill body should stay at or below 150 lines'
    ])
  })

  it('finds no project skill hygiene violations in the repository', async () => {
    const findings = await collectSkillHygieneFindings(process.cwd())
    expect(findings).toEqual([])
  })
})
