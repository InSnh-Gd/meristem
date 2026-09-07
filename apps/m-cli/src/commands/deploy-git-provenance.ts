import {
  hasMDeployGitSourceRefCredentials,
  type MDeployGitSourceRefV01FromSchema
} from '../../../../packages/contracts/src/index.ts'

type GitProvenanceFailureCode =
  | 'git_archive_failed'
  | 'git_checkout_unavailable'
  | 'git_detached_head'
  | 'git_origin_credentials'
  | 'git_origin_unavailable'
  | 'git_revision_unavailable'

type GitInvocation = {
  readonly args: readonly string[]
  readonly cwd: string
  readonly failureCode: GitProvenanceFailureCode
  readonly failureMessage: string
}

/** Git provenance 边界错误区分 checkout、origin、分支、提交与 archive 失败，便于操作者修复。 */
export class GitProvenanceError extends Error {
  override readonly name = 'GitProvenanceError'

  constructor(
    readonly code: GitProvenanceFailureCode,
    message: string
  ) {
    super(message)
  }
}

/** 从调用 CLI 的 Git checkout 收集不可变生产 sourceRef，不读取工作树文件。 */
export async function collectGitProvenance(cwd: string): Promise<MDeployGitSourceRefV01FromSchema> {
  const insideWorkTree = await runGitText({
    args: ['rev-parse', '--is-inside-work-tree'],
    cwd,
    failureCode: 'git_checkout_unavailable',
    failureMessage:
      'production deploy init requires a Git checkout; run it from a checked-out repository'
  })
  if (insideWorkTree !== 'true') {
    throw new GitProvenanceError(
      'git_checkout_unavailable',
      'production deploy init requires a Git checkout; run it from a checked-out repository'
    )
  }

  const repositoryUrl = await runGitText({
    args: ['remote', 'get-url', 'origin'],
    cwd,
    failureCode: 'git_origin_unavailable',
    failureMessage:
      'production deploy init requires Git remote "origin"; add origin before retrying'
  })
  if (hasMDeployGitSourceRefCredentials(repositoryUrl)) {
    throw new GitProvenanceError(
      'git_origin_credentials',
      'production Git origin must not include credentials; remove userinfo or query credentials before retrying'
    )
  }

  const branch = await runGitText({
    args: ['symbolic-ref', 'HEAD'],
    cwd,
    failureCode: 'git_detached_head',
    failureMessage:
      'production deploy init requires an attached Git branch; check out a branch before retrying'
  })
  const commit = await runGitText({
    args: ['rev-parse', '--verify', 'HEAD^{commit}'],
    cwd,
    failureCode: 'git_revision_unavailable',
    failureMessage:
      'production deploy init could not resolve HEAD to an immutable commit; create or select a commit before retrying'
  })
  // 对 Git 提交树生成的 tar 原始字节直接哈希，禁止解码或重序列化，确保脏工作树不影响 provenance。
  const archiveBytes = await runGitBytes({
    args: ['archive', '--format=tar', commit, '--', '.'],
    cwd,
    failureCode: 'git_archive_failed',
    failureMessage:
      'production deploy init could not archive the committed Git tree; verify the commit is available'
  })
  const digest = new Bun.CryptoHasher('sha256').update(archiveBytes).digest('hex').toLowerCase()
  return {
    repositoryUrl,
    branch,
    commit,
    path: '.',
    digest: { algorithm: 'sha256', value: digest },
    syncedAt: new Date().toISOString()
  } satisfies MDeployGitSourceRefV01FromSchema
}

async function runGitText(input: GitInvocation): Promise<string> {
  return new TextDecoder().decode(await runGitBytes(input)).trim()
}

async function runGitBytes(input: GitInvocation): Promise<Uint8Array> {
  try {
    const child = Bun.spawn(['git', ...input.args], {
      cwd: input.cwd,
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).arrayBuffer(),
      child.stderr.text()
    ])
    if (exitCode !== 0) {
      const detail = stderr.trim()
      throw new GitProvenanceError(
        input.failureCode,
        detail ? `${input.failureMessage}: ${detail}` : input.failureMessage
      )
    }
    return new Uint8Array(stdout)
  } catch (error) {
    if (error instanceof GitProvenanceError) throw error
    throw new GitProvenanceError(
      input.failureCode,
      `${input.failureMessage}: ${errorMessage(error)}`
    )
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
