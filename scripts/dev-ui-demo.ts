const children = [
  Bun.spawn(['bun', 'run', 'dev:m-ui-bff'], { stdout: 'inherit', stderr: 'inherit', env: process.env }),
  Bun.spawn(['bun', 'run', 'dev:m-ui'], { stdout: 'inherit', stderr: 'inherit', env: process.env })
]

process.on('SIGINT', () => {
  for (const child of children) child.kill()
  process.exit(0)
})

await Promise.all(children.map((child) => child.exited))

export {}
