import { isActorId, mintLocalToken } from './index.ts'

// 这个脚本只生成本地开发 JWT，不负责节点 token 或生产身份体系。
const actorFlagIndex = Bun.argv.indexOf('--actor')
const actor = actorFlagIndex >= 0 ? Bun.argv[actorFlagIndex + 1] : undefined
const secret = process.env.MERISTEM_JWT_SECRET

if (!secret) {
  console.error('MERISTEM_JWT_SECRET is required')
  process.exit(1)
}

if (!isActorId(actor)) {
  console.error('Usage: bun run token:mint --actor viewer|operator|admin|security-admin')
  process.exit(1)
}

// 参数校验失败时直接退出，避免误生成不可用 token 并把错误带到后续 CLI 流程。
console.log(await mintLocalToken({ actor, secret }))
