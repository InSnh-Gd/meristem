const rootDir = import.meta.dir.replace(/\/scripts$/, '')
const gitDir = `${rootDir}/.git`
const hooksDir = `${gitDir}/hooks`
const managedHook = `${rootDir}/scripts/git-hooks/pre-push`
const installedHook = `${hooksDir}/pre-push`

if (!(await Bun.file(gitDir).exists())) {
  console.log('Skipping git hook install: .git directory not found.')
  process.exit(0)
}

const mkdirResult = Bun.spawnSync(['mkdir', '-p', hooksDir], {
  stdout: 'inherit',
  stderr: 'inherit'
})

if (mkdirResult.exitCode !== 0) {
  process.exit(mkdirResult.exitCode)
}

const hookSource = `#!/usr/bin/env sh
set -eu
exec "${managedHook}" "$@"
`

await Bun.write(installedHook, hookSource)

const chmodResult = Bun.spawnSync(['chmod', '755', installedHook, managedHook], {
  stdout: 'inherit',
  stderr: 'inherit'
})

if (chmodResult.exitCode !== 0) {
  process.exit(chmodResult.exitCode)
}

console.log('Installed pre-push hook: bun run format:check && bun run test:agent-submit')
