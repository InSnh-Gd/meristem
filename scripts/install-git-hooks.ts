import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const rootDir = import.meta.dir.replace(/\/scripts$/, '')
const gitDir = join(rootDir, '.git')
const hooksDir = join(gitDir, 'hooks')
const managedHook = join(rootDir, 'scripts', 'git-hooks', 'pre-push')
const installedHook = join(hooksDir, 'pre-push')

if (!existsSync(gitDir)) {
  console.log('Skipping git hook install: .git directory not found.')
  process.exit(0)
}

mkdirSync(hooksDir, { recursive: true })

const hookSource = `#!/usr/bin/env sh
set -eu
exec "${managedHook}" "$@"
`

writeFileSync(installedHook, hookSource)
chmodSync(installedHook, 0o755)
chmodSync(managedHook, 0o755)

console.log('Installed pre-push hook: bun run format:check')
