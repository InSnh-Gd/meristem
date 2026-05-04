import { mintLocalToken, isActorId } from './index.ts'

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

console.log(await mintLocalToken({ actor, secret }))

