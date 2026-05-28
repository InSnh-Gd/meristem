import type {
  ApprovalListResponse,
  ApprovalDetailResponse,
  ApprovalActionResponse,
  CreateNodeTicketResponse,
  CreateNetworkResponse,
  HealthResponse,
  IssueNodeCredentialResponse,
  JoinNetworkResponse,
  ReadyResponse,
  RegisterNodeResponse,
  ServiceListResponse,
  ServiceReloadResponse,
  SubmitTaskResponse,
  TaskControlResponse,
  TaskListResponse,
  TaskRetryNotImplementedResponse,
  TaskStatusResponse,
  StatusResponse,
  ProjectionHealth,
  BackfillParams,
  BackfillResult,
  DLQRecord
} from '../../../packages/contracts/src/index.ts'

export type CliClient = {
  health?(): Promise<HealthResponse>
  ready?(): Promise<ReadyResponse>
  status(): Promise<StatusResponse>
  registerNode?(input: { kind: 'stem' | 'leaf'; name: string; mode?: 'agent' | 'simulated' }): Promise<RegisterNodeResponse>
  createNodeTicket?(input: { kind: 'stem' | 'leaf'; name: string; expiresInSeconds?: number }): Promise<CreateNodeTicketResponse>
  issueNodeToken?(nodeId: string): Promise<IssueNodeCredentialResponse>
  listNodes?(): Promise<unknown>
  createNetwork?(input: { name: string; profileVersion?: string }): Promise<CreateNetworkResponse>
  listNetworks?(): Promise<unknown>
  joinNetwork?(input: { networkId: string; nodeId: string }): Promise<JoinNetworkResponse>
  listNetworkMembers?(networkId: string): Promise<unknown>
  submitTask?(input: { nodeId: string; type: 'noop' }): Promise<SubmitTaskResponse>
  cancelTask?(taskId: string): Promise<TaskControlResponse>
  getTask?(taskId: string): Promise<TaskStatusResponse>
  listTasks?(): Promise<TaskListResponse>
  retryTask?(taskId: string): Promise<TaskRetryNotImplementedResponse>
  listServices?(): Promise<ServiceListResponse>
  reloadService?(serviceId: string, reason?: string): Promise<ServiceReloadResponse>
  listTimeline?(): Promise<unknown>
  listAudit?(): Promise<unknown>
  projectionHealth?(): Promise<{ indices: ProjectionHealth[] }>
  backfill?(input: BackfillParams): Promise<BackfillResult>
  listDLQ?(index?: string): Promise<{ records: DLQRecord[] }>
  replayDLQ?(dlqId: string): Promise<unknown>
  skipDLQ?(dlqId: string): Promise<unknown>
  listApprovals?(): Promise<ApprovalListResponse>
  getApproval?(id: string): Promise<ApprovalDetailResponse>
  approveApproval?(id: string, reason?: string): Promise<ApprovalActionResponse>
  rejectApproval?(id: string, reason?: string): Promise<ApprovalActionResponse>
}

// CLI 结果统一收敛成 stdout/stderr/exitCode，方便测试和 shell 脚本直接断言。
export type CliRunResult = {
  exitCode: 0 | 1
  stdout: string
  stderr: string
}

/**
 * CLI 参数缺失在入口层直接失败，避免命令处理继续往下传播半有效输入。
 */
function requireArg(args: string[], flag: string): string {
  const index = args.indexOf(flag)
  const value = index >= 0 ? args[index + 1] : undefined
  if (!value) throw new Error(`missing ${flag}`)
  return value
}

/**
 * CLI 所有成功输出统一编码为可直接被脚本消费的 JSON 文本。
 */
function encode(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * 命令运行器按契约能力检查客户端方法是否存在，避免测试桩或未来裁剪版本 silently 跳过命令。
 */
function requireMethod<T>(method: T | undefined, name: string): T {
  if (method) return method
  throw new Error(`CLI client missing ${name}`)
}

/**
 * CLI 入口负责命令分发和基础参数验证，不承担授权、策略或业务状态判断；
 * 这些能力仍然必须回到 Core 及其下游服务执行。
 */
export function createCliRunner(client: CliClient) {
  return {
    async run(args: string[]): Promise<CliRunResult> {
      try {
        const [command, subcommand] = args

        // 命令分发刻意保持平铺结构，避免在 MVP 阶段引入过深的命令抽象层。
        if (command === 'status') {
          return { exitCode: 0, stdout: encode(await client.status()), stderr: '' }
        }

        if (command === 'node' && subcommand === 'register') {
          const kind = requireArg(args, '--kind')
          const name = requireArg(args, '--name')
          const modeFlagIndex = args.indexOf('--mode')
          const mode = modeFlagIndex >= 0 ? args[modeFlagIndex + 1] : undefined
          if (kind !== 'stem' && kind !== 'leaf') throw new Error('--kind must be stem or leaf')
          if (mode !== undefined && mode !== 'agent' && mode !== 'simulated') throw new Error('--mode must be agent or simulated')
          if (mode === 'agent') throw new Error('agent mode moved to node ticket create and the M-Net join ingress')
          const registerNode = requireMethod(client.registerNode, 'registerNode')
          return {
            exitCode: 0,
            stdout: encode(await registerNode(mode ? { kind, name, mode } : { kind, name })),
            stderr: ''
          }
        }

        if (command === 'node' && subcommand === 'ticket') {
          const action = args[2]
          if (action !== 'create') throw new Error('usage: meristem node ticket create --kind <stem|leaf> --name <name> [--expires <seconds>]')
          const kind = requireArg(args, '--kind')
          const name = requireArg(args, '--name')
          const expiresFlagIndex = args.indexOf('--expires')
          const expires = expiresFlagIndex >= 0 ? Number(args[expiresFlagIndex + 1]) : undefined
          if (kind !== 'stem' && kind !== 'leaf') throw new Error('--kind must be stem or leaf')
          if (expires !== undefined && (!Number.isFinite(expires) || expires <= 0)) throw new Error('--expires must be a positive integer')
          const createNodeTicket = requireMethod(client.createNodeTicket, 'createNodeTicket')
          return {
            exitCode: 0,
            stdout: encode(await createNodeTicket(expires === undefined ? { kind, name } : { kind, name, expiresInSeconds: expires })),
            stderr: ''
          }
        }

        if (command === 'node' && subcommand === 'issue-token') {
          const nodeId = requireArg(args, '--node')
          const issueNodeToken = requireMethod(client.issueNodeToken, 'issueNodeToken')
          return { exitCode: 0, stdout: encode(await issueNodeToken(nodeId)), stderr: '' }
        }

        if (command === 'node' && subcommand === 'list') {
          const listNodes = requireMethod(client.listNodes, 'listNodes')
          return { exitCode: 0, stdout: encode(await listNodes()), stderr: '' }
        }

        if (command === 'network' && subcommand === 'create') {
          const name = requireArg(args, '--name')
          const profileFlagIndex = args.indexOf('--profile')
          const profileVersion = profileFlagIndex >= 0 ? args[profileFlagIndex + 1] : undefined
          const createNetwork = requireMethod(client.createNetwork, 'createNetwork')
          return { exitCode: 0, stdout: encode(await createNetwork(profileVersion ? { name, profileVersion } : { name })), stderr: '' }
        }

        if (command === 'network' && subcommand === 'list') {
          const listNetworks = requireMethod(client.listNetworks, 'listNetworks')
          return { exitCode: 0, stdout: encode(await listNetworks()), stderr: '' }
        }

        if (command === 'network' && subcommand === 'join') {
          const networkId = requireArg(args, '--network')
          const nodeId = requireArg(args, '--node')
          const joinNetwork = requireMethod(client.joinNetwork, 'joinNetwork')
          return { exitCode: 0, stdout: encode(await joinNetwork({ networkId, nodeId })), stderr: '' }
        }

        if (command === 'network' && subcommand === 'members') {
          const networkId = requireArg(args, '--network')
          const listNetworkMembers = requireMethod(client.listNetworkMembers, 'listNetworkMembers')
          return { exitCode: 0, stdout: encode(await listNetworkMembers(networkId)), stderr: '' }
        }

        if (command === 'task' && subcommand === 'submit') {
          const nodeId = requireArg(args, '--node')
          const type = requireArg(args, '--type')
          if (type !== 'noop') throw new Error('--type must be noop')
          const submitTask = requireMethod(client.submitTask, 'submitTask')
          return { exitCode: 0, stdout: encode(await submitTask({ nodeId, type })), stderr: '' }
        }

        if (command === 'task' && subcommand === 'cancel') {
          const taskId = args[2]
          if (!taskId) throw new Error('usage: meristem task cancel <task-id>')
          const cancelTask = requireMethod(client.cancelTask, 'cancelTask')
          return { exitCode: 0, stdout: encode(await cancelTask(taskId)), stderr: '' }
        }

        if (command === 'task' && subcommand === 'status') {
          const taskId = args[2]
          if (!taskId) throw new Error('usage: meristem task status <task-id>')
          const getTask = requireMethod(client.getTask, 'getTask')
          return { exitCode: 0, stdout: encode(await getTask(taskId)), stderr: '' }
        }

        if (command === 'task' && subcommand === 'list') {
          const listTasks = requireMethod(client.listTasks, 'listTasks')
          return { exitCode: 0, stdout: encode(await listTasks()), stderr: '' }
        }

        if (command === 'task' && subcommand === 'retry') {
          const taskId = args[2]
          if (!taskId) throw new Error('usage: meristem task retry <task-id>')
          const retryTask = requireMethod(client.retryTask, 'retryTask')
          return { exitCode: 0, stdout: encode(await retryTask(taskId)), stderr: '' }
        }

        if (command === 'service' && subcommand === 'list') {
          const listServices = requireMethod(client.listServices, 'listServices')
          return { exitCode: 0, stdout: encode(await listServices()), stderr: '' }
        }

        if (command === 'service' && subcommand === 'reload') {
          const serviceId = requireArg(args, '--service')
          const reasonFlagIndex = args.indexOf('--reason')
          const reason = reasonFlagIndex >= 0 ? args[reasonFlagIndex + 1] : undefined
          const reloadService = requireMethod(client.reloadService, 'reloadService')
          return { exitCode: 0, stdout: encode(await reloadService(serviceId, reason)), stderr: '' }
        }

        if (command === 'log' && subcommand === 'timeline') {
          const listTimeline = requireMethod(client.listTimeline, 'listTimeline')
          return { exitCode: 0, stdout: encode(await listTimeline()), stderr: '' }
        }

        if (command === 'audit' && subcommand === 'list') {
          const listAudit = requireMethod(client.listAudit, 'listAudit')
          return { exitCode: 0, stdout: encode(await listAudit()), stderr: '' }
        }

        if (command === 'projection' && subcommand === 'health') {
          const projectionHealth = requireMethod(client.projectionHealth, 'projectionHealth')
          return { exitCode: 0, stdout: encode(await projectionHealth()), stderr: '' }
        }

        if (command === 'projection' && subcommand === 'backfill') {
          const index = requireArg(args, '--index')
          const fromFlagIndex = args.indexOf('--from')
          const toFlagIndex = args.indexOf('--to')
          const batchSizeFlagIndex = args.indexOf('--batch-size')
          const from = fromFlagIndex >= 0 ? args[fromFlagIndex + 1] : undefined
          const to = toFlagIndex >= 0 ? args[toFlagIndex + 1] : undefined
          const batchSize = batchSizeFlagIndex >= 0 ? Number(args[batchSizeFlagIndex + 1]) : 100
          if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('--batch-size must be between 1 and 1000')
          const backfill = requireMethod(client.backfill, 'backfill')
          return {
            exitCode: 0,
            stdout: encode(await backfill({
              index,
              ...(from ? { from: JSON.parse(from) } : { from: null }),
              ...(to ? { to: JSON.parse(to) } : { to: null }),
              batchSize
            })),
            stderr: ''
          }
        }

        if (command === 'projection' && subcommand === 'dlq') {
          const action = args[2]
          if (action === 'list') {
            const indexFlagIndex = args.indexOf('--index')
            const index = indexFlagIndex >= 0 ? args[indexFlagIndex + 1] : undefined
            const listDLQ = requireMethod(client.listDLQ, 'listDLQ')
            return { exitCode: 0, stdout: encode(await listDLQ(index)), stderr: '' }
          }
          if (action === 'replay') {
            const id = requireArg(args, '--id')
            const replayDLQ = requireMethod(client.replayDLQ, 'replayDLQ')
            return { exitCode: 0, stdout: encode(await replayDLQ(id)), stderr: '' }
          }
          if (action === 'skip') {
            const id = requireArg(args, '--id')
            const skipDLQ = requireMethod(client.skipDLQ, 'skipDLQ')
            return { exitCode: 0, stdout: encode(await skipDLQ(id)), stderr: '' }
          }
          throw new Error('usage: meristem projection dlq list [--index <name>] | projection dlq replay --id <dlq-id> | projection dlq skip --id <dlq-id>')
        }

        // Phase 12: 审批命令通过 M-Policy 外部审批 API 操作审批队列。
        if (command === 'policy' && subcommand === 'approvals') {
          const action = args[2]
          if (action === 'list') {
            const listApprovals = requireMethod(client.listApprovals, 'listApprovals')
            return { exitCode: 0, stdout: encode(await listApprovals()), stderr: '' }
          }
          if (action === 'show') {
            const id = args[3]
            if (!id) throw new Error('usage: meristem policy approvals show <approval-id>')
            const getApproval = requireMethod(client.getApproval, 'getApproval')
            return { exitCode: 0, stdout: encode(await getApproval(id)), stderr: '' }
          }
          if (action === 'approve') {
            const id = args[3]
            if (!id) throw new Error('usage: meristem policy approvals approve <approval-id> [--reason <text>]')
            const reasonFlagIndex = args.indexOf('--reason')
            const reason = reasonFlagIndex >= 0 ? args[reasonFlagIndex + 1] : undefined
            const approveApproval = requireMethod(client.approveApproval, 'approveApproval')
            return { exitCode: 0, stdout: encode(await approveApproval(id, reason)), stderr: '' }
          }
          if (action === 'reject') {
            const id = args[3]
            if (!id) throw new Error('usage: meristem policy approvals reject <approval-id> [--reason <text>]')
            const reasonFlagIndex = args.indexOf('--reason')
            const reason = reasonFlagIndex >= 0 ? args[reasonFlagIndex + 1] : undefined
            const rejectApproval = requireMethod(client.rejectApproval, 'rejectApproval')
            return { exitCode: 0, stdout: encode(await rejectApproval(id, reason)), stderr: '' }
          }
          throw new Error('usage: meristem policy approvals list | policy approvals show <approval-id> | policy approvals approve <approval-id> [--reason <text>] | policy approvals reject <approval-id> [--reason <text>]')
        }

        // 未匹配命令直接返回统一 usage，避免不同失败分支各自输出不同帮助文本。
        throw new Error(
          'usage: meristem status | node register --kind <stem|leaf> --name <name> [--mode simulated] | node ticket create --kind <stem|leaf> --name <name> [--expires <seconds>] | node issue-token --node <node-id> | node list | network create/list/join/members | task submit/cancel/status/list/retry | service list/reload | log timeline | audit list | policy approvals list | policy approvals show <id> | policy approvals approve <id> [--reason <text>] | policy approvals reject <id> [--reason <text>] | projection health | projection backfill --index <name> [--from <cursor>] [--to <cursor>] [--batch-size <n>] | projection dlq list [--index <name>] | projection dlq replay --id <dlq-id> | projection dlq skip --id <dlq-id>'
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown CLI error'
        return { exitCode: 1, stdout: '', stderr: `${message}\n` }
      }
    }
  }
}
