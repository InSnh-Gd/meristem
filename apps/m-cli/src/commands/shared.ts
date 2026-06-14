import type { CliClient, CliRunResult } from './types.ts'

export type CliCommandHandler = (
  client: CliClient,
  args: string[]
) => Promise<CliRunResult | undefined>

/**
 * CLI 参数缺失在入口层直接失败，避免命令处理继续往下传播半有效输入。
 */
export function requireArg(args: string[], flag: string): string {
  const index = args.indexOf(flag)
  const value = index >= 0 ? args[index + 1] : undefined
  if (!value) throw new Error(`missing ${flag}`)
  return value
}

/**
 * CLI 所有成功输出统一编码为可直接被脚本消费的 JSON 文本。
 */
export function encode(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * 成功路径统一构造成脚本友好的结果对象，避免命令模块各自拼装返回值。
 */
export function success(value: unknown): CliRunResult {
  return { exitCode: 0, stdout: encode(value), stderr: '' }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return (await Bun.file(filePath).json()) as T
}

/**
 * 从 stdin 安全读取秘密值，避免在进程参数或历史记录中暴露明文。
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf-8').trim()
}

/**
 * 命令运行器按契约能力检查客户端方法是否存在，避免测试桩或未来裁剪版本 silently 跳过命令。
 */
export function requireMethod<T>(method: T | undefined, name: string): T {
  if (method) return method
  throw new Error(`CLI client missing ${name}`)
}
