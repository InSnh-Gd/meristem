import type {
  ApprovalActionResponse,
  ApprovalDetailResponse,
  ApprovalListResponse,
  BackfillParams,
  BackfillResult,
  CreateNetworkResponse,
  CreateNodeTicketResponse,
  DisableExtensionRequest,
  DLQRecord,
  EnableExtensionRequest,
  ExtensionDetailResponse,
  ExtensionInstanceControlResponse,
  ExtensionListResponse,
  HealthResponse,
  IssueNodeCredentialResponse,
  JoinNetworkResponse,
  MExtensionManifestV01,
  ProjectionHealth,
  ReadyResponse,
  RegisterExtensionResponse,
  RegisterNodeResponse,
  RevokeNodeCredentialResponse,
  ServiceListResponse,
  ServiceReloadResponse,
  StatusResponse,
  SubmitTaskResponse,
  TaskControlResponse,
  TaskListResponse,
  TaskRetryNotImplementedResponse,
  TaskStatusResponse
} from '../../../../packages/contracts/src/index.ts'

export type CliClient = {
  health?(): Promise<HealthResponse>
  ready?(): Promise<ReadyResponse>
  status(): Promise<StatusResponse>
  registerNode?(input: {
    kind: 'stem' | 'leaf'
    name: string
    mode?: 'agent' | 'simulated'
  }): Promise<RegisterNodeResponse>
  createNodeTicket?(input: {
    kind: 'stem' | 'leaf'
    name: string
    expiresInSeconds?: number
  }): Promise<CreateNodeTicketResponse>
  issueNodeToken?(nodeId: string): Promise<IssueNodeCredentialResponse>
  revokeNodeToken?(nodeId: string): Promise<RevokeNodeCredentialResponse>
  listNodes?(): Promise<unknown>
  createNetwork?(input: { name: string; profileVersion?: string }): Promise<CreateNetworkResponse>
  listNetworks?(): Promise<unknown>
  joinNetwork?(input: { networkId: string; nodeId: string }): Promise<JoinNetworkResponse>
  listNetworkMembers?(networkId: string): Promise<unknown>
  listNetworkProfiles?(): Promise<unknown>
  getNetworkProfile?(profileVersion: string): Promise<unknown>
  enableNetworkProfile?(networkId: string, profileVersion: string, reason: string): Promise<unknown>
  disableNetworkProfile?(networkId: string, reason: string): Promise<unknown>
  /** 获取全局迁移状态或指定操作状态 */
  getMigrationStatus?(operationId?: string): Promise<unknown>
  /** 扫描 legacy profile/node 并返回可执行迁移报告 */
  getMigrationReport?(): Promise<unknown>
  /** 规划迁移 dry-run */
  planMigration?(
    targetVersion: string,
    batchSize: number | undefined,
    reason: string
  ): Promise<unknown>
  /** 执行迁移 apply */
  applyMigration?(operationId: string): Promise<unknown>
  /** 恢复迁移 */
  resumeMigration?(operationId: string): Promise<unknown>
  /** 回滚迁移（必须提供 reason） */
  rollbackMigration?(operationId: string, reason: string): Promise<unknown>
  /** 查询数据面健康状态 */
  getDataplaneHealth?(networkId: string): Promise<unknown>
  /** 查询中继分配 */
  getRelayAssignment?(networkId: string): Promise<unknown>
  /** 检查网络映射摘要 */
  getNetworkMap?(networkId: string): Promise<unknown>
  /** break-glass 紧急禁用（必须提供 reason 和 confirm 标记） */
  breakGlass?(networkId: string, reason: string): Promise<unknown>
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
  listExtensions?(): Promise<ExtensionListResponse>
  getExtension?(id: string): Promise<ExtensionDetailResponse>
  registerExtension?(input: {
    manifest: MExtensionManifestV01
    reason?: string
  }): Promise<RegisterExtensionResponse>
  enableExtension?(
    id: string,
    input?: EnableExtensionRequest
  ): Promise<ExtensionInstanceControlResponse>
  disableExtension?(
    id: string,
    input?: DisableExtensionRequest
  ): Promise<ExtensionInstanceControlResponse>
  identity?: {
    listActors?(): Promise<Array<{ id: string; displayName: string; status: string }>>
    getActor?(id: string): Promise<{ id: string; displayName: string; status: string }>
    issueToken?(input: {
      actor: string
      ttl: string
      purpose: string
    }): Promise<{ jti: string; token: string; expiresAt: string; actor: string }>
    inspectToken?(jti: string): Promise<{
      jti: string
      actor: string
      status: string
      issuer: string
      audience: string
      issuedAt: string
      expiresAt: string
      issuedBy: string
      purpose: string
    }>
    revokeToken?(
      jti: string,
      input: { reason: string }
    ): Promise<{ jti: string; status: string; revokedAt: string; revokedBy: string }>
  }
  secret?: {
    list?(): Promise<
      Array<{
        id: string
        name: string
        scope: string
        status: string
        createdBy: string
        createdAt: string
      }>
    >
    get?(id: string): Promise<{
      id: string
      name: string
      scope: string
      status: string
      createdBy: string
      createdAt: string
      updatedAt: string
      metadata: Record<string, string>
    }>
    create?(input: {
      name: string
      scope: string
      value: string
      metadata?: Record<string, string>
    }): Promise<{ id: string; name: string; status: string; createdAt: string }>
    rotate?(
      id: string,
      input: { value: string; reason: string }
    ): Promise<{ id: string; version: string; status: string; rotatedAt: string }>
    disable?(
      id: string,
      input: { reason: string }
    ): Promise<{ id: string; status: string; disabledAt: string }>
  }
  config?: {
    list?(): Promise<
      Array<{
        id: string
        configVersion: string
        domain: string
        status: string
        createdBy: string
        createdAt: string
      }>
    >
    get?(id: string): Promise<{
      id: string
      configVersion: string
      schemaVersion: string
      configHash: string
      domain: string
      targetScope: string[]
      status: string
      payload: unknown
      createdBy: string
      createdAt: string
      publishedBy?: string
      publishedAt?: string
      rollbackVersion?: string
      updatedAt: string
    }>
    draft?(input: {
      domain: string
      payload: unknown
      targetScope?: string[]
    }): Promise<{ id: string; configVersion: string; status: string; createdAt: string }>
    validate?(id: string): Promise<{ id: string; status: string }>
    publish?(
      id: string,
      input: { reason: string }
    ): Promise<{
      id: string
      configVersion: string
      status: string
      publishedAt: string
      publishedBy: string
    }>
    rollback?(
      id: string,
      input: { toVersion: string; reason: string }
    ): Promise<{ id: string; status: string }>
  }
}

// CLI 结果统一收敛成 stdout/stderr/exitCode，方便测试和 shell 脚本直接断言。
export type CliRunResult = {
  exitCode: 0 | 1
  stdout: string
  stderr: string
}
