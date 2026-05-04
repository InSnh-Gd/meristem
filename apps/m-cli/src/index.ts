type CliConfig = {
  coreUrl: string
  token: string | undefined
}

function config(): CliConfig {
  return {
    coreUrl: process.env.MERISTEM_CORE_URL ?? 'http://localhost:3000',
    token: process.env.MERISTEM_TOKEN
  }
}

function headers(cfg: CliConfig): HeadersInit {
  return {
    authorization: cfg.token ? `Bearer ${cfg.token}` : '',
    'content-type': 'application/json'
  }
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const cfg = config()
  const response = await fetch(`${cfg.coreUrl}${path}`, {
    ...init,
    headers: {
      ...headers(cfg),
      ...(init.headers ?? {})
    }
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body
      ? JSON.stringify(body)
      : `request failed: ${response.status}`
    throw new Error(message)
  }
  return body
}

function requireArg(args: string[], flag: string): string {
  const index = args.indexOf(flag)
  const value = index >= 0 ? args[index + 1] : undefined
  if (!value) throw new Error(`missing ${flag}`)
  return value
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

async function main(args: string[]): Promise<void> {
  const [command, subcommand] = args

  if (command === 'status') {
    print(await requestJson('/api/v0/status'))
    return
  }

  if (command === 'node' && subcommand === 'register') {
    const kind = requireArg(args, '--kind')
    const name = requireArg(args, '--name')
    if (kind !== 'stem' && kind !== 'leaf') throw new Error('--kind must be stem or leaf')
    print(await requestJson('/api/v0/nodes', {
      method: 'POST',
      body: JSON.stringify({ kind, name })
    }))
    return
  }

  if (command === 'node' && subcommand === 'list') {
    print(await requestJson('/api/v0/nodes'))
    return
  }

  if (command === 'network' && subcommand === 'create') {
    const name = requireArg(args, '--name')
    const profileFlagIndex = args.indexOf('--profile')
    const profileVersion = profileFlagIndex >= 0 ? args[profileFlagIndex + 1] : undefined
    print(await requestJson('/api/v0/networks', {
      method: 'POST',
      body: JSON.stringify(profileVersion ? { name, profileVersion } : { name })
    }))
    return
  }

  if (command === 'network' && subcommand === 'list') {
    print(await requestJson('/api/v0/networks'))
    return
  }

  if (command === 'network' && subcommand === 'join') {
    const networkId = requireArg(args, '--network')
    const nodeId = requireArg(args, '--node')
    print(await requestJson(`/api/v0/networks/${networkId}/members`, {
      method: 'POST',
      body: JSON.stringify({ nodeId })
    }))
    return
  }

  if (command === 'network' && subcommand === 'members') {
    const networkId = requireArg(args, '--network')
    print(await requestJson(`/api/v0/networks/${networkId}/members`))
    return
  }

  if (command === 'task' && subcommand === 'assign') {
    const leafNodeId = requireArg(args, '--leaf')
    const type = requireArg(args, '--type')
    if (type !== 'noop') throw new Error('--type must be noop')
    print(await requestJson('/api/v0/tasks', {
      method: 'POST',
      body: JSON.stringify({ leafNodeId, type })
    }))
    return
  }

  if (command === 'log' && subcommand === 'timeline') {
    print(await requestJson('/api/v0/logs/timeline'))
    return
  }

  if (command === 'audit' && subcommand === 'list') {
    print(await requestJson('/api/v0/audit'))
    return
  }

  throw new Error('usage: meristem status | node register/list | network create/list/join/members | task assign | log timeline | audit list')
}

try {
  await main(Bun.argv.slice(2))
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown CLI error'
  console.error(message)
  process.exit(1)
}

export {}
