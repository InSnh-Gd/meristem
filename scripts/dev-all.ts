const commands = [
  ['bun', 'run', 'dev:m-eventbus'],
  ['bun', 'run', 'dev:m-policy'],
  ['bun', 'run', 'dev:m-log'],
  ['bun', 'run', 'dev:m-net'],
  ['bun', 'run', 'dev:core']
] as const

const children = commands.map((command) =>
  Bun.spawn([...command], {
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env
  })
)

process.on('SIGINT', () => {
  for (const child of children) child.kill()
  process.exit(0)
})

await Promise.all(children.map((child) => child.exited))

export {}
