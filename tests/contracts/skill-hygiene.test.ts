import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('scans .agents dot-directories and collects findings for invalid skills and missing SKILL.md', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'meristem-skill-hygiene-'))
    try {
      await mkdir(join(tempRoot, '.agents/skills/valid-skill'), { recursive: true })
      await writeFile(
        join(tempRoot, '.agents/skills/valid-skill/SKILL.md'),
        [
          '---',
          'name: valid-skill',
          'description: Use when running valid skill tests.',
          '---',
          '',
          '# Valid Skill',
          '',
          'Valid body content.'
        ].join('\n')
      )

      await mkdir(join(tempRoot, '.agents/skills/invalid-skill'), { recursive: true })
      await writeFile(
        join(tempRoot, '.agents/skills/invalid-skill/SKILL.md'),
        [
          '---',
          'name: invalid-skill',
          'description: Missing trigger wording.',
          '---',
          '',
          '# Invalid Skill'
        ].join('\n')
      )

      await mkdir(join(tempRoot, '.agents/skills/missing-skill-doc'), { recursive: true })

      const findings = await collectSkillHygieneFindings(tempRoot)
      expect(findings).toEqual([
        {
          path: '.agents/skills/invalid-skill/SKILL.md',
          reason: 'description must include "Use when" trigger wording'
        },
        {
          path: '.agents/skills/missing-skill-doc',
          reason: 'skill directory is missing SKILL.md'
        }
      ])
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('finds no project skill hygiene violations in the repository', async () => {
    const findings = await collectSkillHygieneFindings(process.cwd())
    expect(findings).toEqual([])
  })
})
