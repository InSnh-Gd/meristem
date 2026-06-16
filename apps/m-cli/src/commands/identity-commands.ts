import { type CliCommandHandler, requireArg, requireMethod, success } from './shared.ts'

const IDENTITY_USAGE =
  'usage: meristem identity actor list | identity actor show <actor-id> | identity token issue --actor <actor-id> --ttl <duration> --purpose <text> | identity token inspect <jti> | identity token revoke <jti> --reason <text>'

/**
 * 身份命令仍通过 Core identity 控制面工作，只把解析逻辑拆到独立模块中。
 */
export const handleIdentityCommands: CliCommandHandler = async (client, args) => {
  const [command, subcommand] = args
  if (command !== 'identity') return undefined

  if (subcommand === 'actor') {
    const action = args[2]
    if (action === 'list') {
      const listActors = requireMethod(client.identity?.listActors, 'identity.listActors')
      return success(await listActors())
    }
    if (action === 'show') {
      const actorId = args[3]
      if (!actorId) throw new Error('usage: meristem identity actor show <actor-id>')
      const getActor = requireMethod(client.identity?.getActor, 'identity.getActor')
      return success(await getActor(actorId))
    }
    throw new Error('usage: meristem identity actor list | identity actor show <actor-id>')
  }

  if (subcommand === 'token') {
    const action = args[2]
    if (action === 'issue') {
      const actor = requireArg(args, '--actor')
      const ttlFlagIndex = args.indexOf('--ttl')
      const ttl = ttlFlagIndex >= 0 ? (args[ttlFlagIndex + 1] ?? '8h') : '8h'
      const purpose = requireArg(args, '--purpose')
      const issueToken = requireMethod(client.identity?.issueToken, 'identity.issueToken')
      return success(await issueToken({ actor, ttl, purpose }))
    }
    if (action === 'inspect') {
      const jti = args[3]
      if (!jti) throw new Error('usage: meristem identity token inspect <jti>')
      const inspectToken = requireMethod(client.identity?.inspectToken, 'identity.inspectToken')
      return success(await inspectToken(jti))
    }
    if (action === 'revoke') {
      const jti = args[3]
      if (!jti) throw new Error('usage: meristem identity token revoke <jti> --reason <text>')
      const reason = requireArg(args, '--reason')
      const revokeToken = requireMethod(client.identity?.revokeToken, 'identity.revokeToken')
      return success(await revokeToken(jti, { reason }))
    }
    throw new Error(
      'usage: meristem identity token issue --actor <actor-id> --ttl <duration> --purpose <text> | identity token inspect <jti> | identity token revoke <jti> --reason <text>'
    )
  }

  throw new Error(IDENTITY_USAGE)
}
