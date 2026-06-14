import { describe, expect, it } from 'bun:test'
import {
  approvedCrossOwnerReads,
  sourceDomainRoots,
  tableOwners
} from '../../scripts/db-ownership-allowlist.ts'

const repoRoot = `${import.meta.dir}/../..`
const checkerScript = `${repoRoot}/scripts/db-ownership-check.ts`

async function createFixtureRoot(): Promise<string> {
  const root = crypto.randomUUID()
  const fixtureRoot = `/tmp/meristem-db-ownership-${root}`
  Bun.spawnSync(['mkdir', '-p', `${fixtureRoot}/packages/db/src`, `${fixtureRoot}/services/m-extension/src`])
  await Bun.write(`${fixtureRoot}/packages/db/src/schema.ts`, 'export const policyDecisions = {}\n')
  return fixtureRoot
}

async function writeSource(root: string, relativePath: string, content: string): Promise<void> {
  const path = `${root}/${relativePath}`
  const directory = path.split('/').slice(0, -1).join('/')
  Bun.spawnSync(['mkdir', '-p', directory])
  await Bun.write(path, content)
}

async function runCheck(root: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = Bun.spawn(['bun', 'run', checkerScript, '--enforce'], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ])
  return { exitCode, stdout, stderr }
}

describe('DB ownership check fixture', () => {
  it('rejects an unapproved cross-owner read fixture', async () => {
    const root = await createFixtureRoot()

    try {
      await writeSource(
        root,
        'services/m-extension/src/unauthorized-db-read.ts',
        "import { policyDecisions } from '../../../packages/db/src/schema.ts'\nexport const sample = policyDecisions\n"
      )

      const result = await runCheck(root)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('services/m-extension/src/unauthorized-db-read.ts')
      expect(result.stderr).toContain('policyDecisions')
    } finally {
      await Bun.spawnSync(['rm', '-rf', root])
    }
  })

  it('allows the current approved cross-owner reads', async () => {
    const root = await createFixtureRoot()

    try {
      for (const entry of approvedCrossOwnerReads) {
        const importList = entry.tables.join(', ')
        await writeSource(
          root,
          entry.source,
          `import { ${importList} } from '../../../packages/db/src/schema.ts'\nexport const sample = [${importList}]\n`
        )
      }

      const result = await runCheck(root)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('no unapproved cross-owner table reads found')
    } finally {
      await Bun.spawnSync(['rm', '-rf', root])
    }
  })

  it('keeps the ownership inventory aligned with known service domains', () => {
    expect(sourceDomainRoots.map(entry => entry.domain)).toEqual([
      'core',
      'm-extension',
      'm-log',
      'm-net',
      'm-policy',
      'm-task'
    ])

    expect(tableOwners.policyDecisions).toBe('m-policy')
    expect(tableOwners.nodes).toBe('core')
    expect(tableOwners.taskRequests).toBe('m-task')
  })
})
