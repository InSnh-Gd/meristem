import { requireArg, requireMethod, success, type CliCommandHandler } from './shared.ts'

const PROJECTION_DLQ_USAGE =
  'usage: meristem projection dlq list [--index <name>] | projection dlq replay --id <dlq-id> | projection dlq skip --id <dlq-id>'

/**
 * 任务与投影命令都属于运维控制面，拆分后仍保留原先的参数和错误文本。
 */
export const handleTaskProjectionCommands: CliCommandHandler = async (client, args) => {
  const [command, subcommand] = args

  if (command === 'task' && subcommand === 'submit') {
    const nodeId = requireArg(args, '--node')
    const type = requireArg(args, '--type')
    if (type !== 'noop') throw new Error('--type must be noop')
    const submitTask = requireMethod(client.submitTask, 'submitTask')
    return success(await submitTask({ nodeId, type }))
  }

  if (command === 'task' && subcommand === 'cancel') {
    const taskId = args[2]
    if (!taskId) throw new Error('usage: meristem task cancel <task-id>')
    const cancelTask = requireMethod(client.cancelTask, 'cancelTask')
    return success(await cancelTask(taskId))
  }

  if (command === 'task' && subcommand === 'status') {
    const taskId = args[2]
    if (!taskId) throw new Error('usage: meristem task status <task-id>')
    const getTask = requireMethod(client.getTask, 'getTask')
    return success(await getTask(taskId))
  }

  if (command === 'task' && subcommand === 'list') {
    const listTasks = requireMethod(client.listTasks, 'listTasks')
    return success(await listTasks())
  }

  if (command === 'task' && subcommand === 'retry') {
    const taskId = args[2]
    if (!taskId) throw new Error('usage: meristem task retry <task-id>')
    const retryTask = requireMethod(client.retryTask, 'retryTask')
    return success(await retryTask(taskId))
  }

  if (command === 'projection' && subcommand === 'health') {
    const projectionHealth = requireMethod(client.projectionHealth, 'projectionHealth')
    return success(await projectionHealth())
  }

  if (command === 'projection' && subcommand === 'backfill') {
    const index = requireArg(args, '--index')
    const fromFlagIndex = args.indexOf('--from')
    const toFlagIndex = args.indexOf('--to')
    const batchSizeFlagIndex = args.indexOf('--batch-size')
    const from = fromFlagIndex >= 0 ? args[fromFlagIndex + 1] : undefined
    const to = toFlagIndex >= 0 ? args[toFlagIndex + 1] : undefined
    const batchSize = batchSizeFlagIndex >= 0 ? Number(args[batchSizeFlagIndex + 1]) : 100
    if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 1000) {
      throw new Error('--batch-size must be between 1 and 1000')
    }
    const backfill = requireMethod(client.backfill, 'backfill')
    return success(
      await backfill({
        index,
        ...(from ? { from: JSON.parse(from) } : { from: null }),
        ...(to ? { to: JSON.parse(to) } : { to: null }),
        batchSize
      })
    )
  }

  if (command === 'projection' && subcommand === 'dlq') {
    const action = args[2]
    if (action === 'list') {
      const indexFlagIndex = args.indexOf('--index')
      const index = indexFlagIndex >= 0 ? args[indexFlagIndex + 1] : undefined
      const listDLQ = requireMethod(client.listDLQ, 'listDLQ')
      return success(await listDLQ(index))
    }
    if (action === 'replay') {
      const id = requireArg(args, '--id')
      const replayDLQ = requireMethod(client.replayDLQ, 'replayDLQ')
      return success(await replayDLQ(id))
    }
    if (action === 'skip') {
      const id = requireArg(args, '--id')
      const skipDLQ = requireMethod(client.skipDLQ, 'skipDLQ')
      return success(await skipDLQ(id))
    }
    throw new Error(PROJECTION_DLQ_USAGE)
  }

  return undefined
}
