export type TaskType = 'noop'
export type MTaskStatus =
  | 'accepted'
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancel_requested'
  | 'canceled'
  | 'timed_out'
export type OperationDangerLevel = 'low' | 'medium' | 'high' | 'critical'
export type RiskFactor =
  | 'actor_permission_level'
  | 'operation_danger_level'
  | 'target_node_kind'
  | 'target_node_reachability'
  | 'task_type_risk'
  | 'recent_failure_count'
  | 'outside_expected_scope'
  | 'audit_visibility'

// M-Task 拥有 canonical task lifecycle。
export type SubmitTaskRequest = {
  nodeId: string
  type: TaskType
  timeoutAt?: string
}

export type MTask = {
  id: string
  nodeId: string
  leafNodeId: string
  type: TaskType
  status: MTaskStatus
  createdAt: string
  updatedAt: string
  timeoutAt?: string
  completedAt?: string
  canceledAt?: string
}

export type TaskRiskSummary = {
  operationDangerLevel: OperationDangerLevel
  suspicionScore: number
  riskFactors: RiskFactor[]
}

export type TaskPolicyResult = 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'

export type MTaskPolicyDecision = {
  decisionId: string
  result: TaskPolicyResult
  requiredAction?: 'manual_review' | 'multi_approval' | undefined
  reasons: string[]
}

export type SubmitTaskResponse = {
  task: MTask
  policyDecisionId: string
  correlationId: string
  risk: TaskRiskSummary
}

export type TaskListResponse = {
  tasks: MTask[]
}

export type TaskStatusResponse = {
  task: MTask
}

export type TaskControlResponse = {
  task: MTask
  policyDecisionId: string
  correlationId: string
  risk: TaskRiskSummary
}

export type TaskRetryNotImplementedResponse = {
  error: {
    code: 'not_implemented_yet'
    message: string
  }
  decisionId: string
  risk: TaskRiskSummary
}

export type NodeAgentTaskExecuteRequest = {
  nodeId: string
  taskId: string
  type: 'noop'
  correlationId?: string
}

export type NodeAgentTaskExecuteResponse = {
  nodeId: string
  taskId: string
  result: 'completed'
  completedAt: string
}
