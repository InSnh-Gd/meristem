// 本地联调时按固定顺序拉起核心内部服务和 Core，保持日志输出简单直接。
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

// Ctrl-C 时统一杀掉子进程，避免残留半启动的内部服务继续占端口。
process.on('SIGINT', () => {
  for (const child of children) child.kill()
  process.exit(0)
})

await Promise.all(children.map((child) => child.exited))

export {}
