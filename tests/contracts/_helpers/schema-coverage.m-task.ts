import type { EventContract, ResponseContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

export const mTaskEventContracts: EventContract[] = [
  ...[
    'task.requested.v0',
    'task.queued.v0',
    'task.dispatched.v0',
    'task.running.v0',
    'task.completed.v0',
    'task.failed.v0',
    'task.canceled.v0'
  ].map((subject, index) => ({
    subject,
    schema: Contracts.TaskLifecycleEventPayloadSchema,
    fixture: {
      taskId: `task-${index + 1}`,
      nodeId: 'node-1',
      type: 'noop',
      status: subject.split('.')[1] === 'requested' ? 'accepted' : subject.split('.')[1]
    }
  })),
  {
    subject: 'task.operation.suspended.v0',
    schema: Contracts.TaskOperationSuspendedPayloadSchema,
    fixture: {
      decisionId: 'pd-task-1',
      action: 'task:submit',
      resource: 'node:node-1',
      actor: 'operator'
    }
  },
  {
    subject: 'task.operation.resumed.v0',
    schema: Contracts.TaskOperationResumedPayloadSchema,
    fixture: {
      opId: 'op-task-1',
      action: 'task.submit',
      resource: 'node:node-1',
      taskId: 'task-99'
    }
  },
  {
    subject: 'task.operation.resume.failure.v0',
    schema: Contracts.TaskOperationResumeFailurePayloadSchema,
    fixture: { opId: 'op-task-2', reason: 'target_task_not_found', taskStatus: 'failed' }
  },
  {
    subject: 'task.operation.rejected.v0',
    schema: Contracts.TaskOperationRejectedPayloadSchema,
    fixture: { opId: 'op-task-3', action: 'task.cancel', resource: 'task:task-1' }
  }
]

export const mTaskResponseContracts: ResponseContract[] = [
  {
    route: 'GET /api/v0/task-definitions',
    schema: Contracts.TaskDefinitionsResponseSchema,
    fixture: { taskDefinitions: [{ type: 'noop', version: 'v0', timeoutSeconds: 30 }] }
  },
  {
    route: 'GET /api/v0/tasks',
    schema: Contracts.TaskListResponseSchema,
    fixture: {
      tasks: [
        {
          id: 'task-1',
          nodeId: 'node-1',
          leafNodeId: 'node-1',
          type: 'noop',
          status: 'queued',
          createdAt: '2026-06-04T10:00:00.000Z',
          updatedAt: '2026-06-04T10:00:00.000Z'
        }
      ]
    }
  },
  {
    route: 'POST /api/v0/tasks',
    schema: Contracts.SubmitTaskResponseSchema,
    fixture: {
      task: {
        id: 'task-1',
        nodeId: 'node-1',
        leafNodeId: 'node-1',
        type: 'noop',
        status: 'completed',
        createdAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:01:00.000Z',
        completedAt: '2026-06-04T10:01:00.000Z'
      },
      policyDecisionId: 'pd-task',
      correlationId: 'corr-task',
      risk: { operationDangerLevel: 'medium', suspicionScore: 0.1, riskFactors: ['task_type_risk'] }
    }
  },
  {
    route: 'GET /api/v0/tasks/:id',
    schema: Contracts.TaskStatusResponseSchema,
    fixture: {
      task: {
        id: 'task-1',
        nodeId: 'node-1',
        leafNodeId: 'node-1',
        type: 'noop',
        status: 'queued',
        createdAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:00:00.000Z'
      }
    }
  },
  {
    route: 'POST /api/v0/tasks/:id/cancel',
    schema: Contracts.TaskControlResponseSchema,
    fixture: {
      task: {
        id: 'task-1',
        nodeId: 'node-1',
        leafNodeId: 'node-1',
        type: 'noop',
        status: 'canceled',
        createdAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:02:00.000Z',
        canceledAt: '2026-06-04T10:02:00.000Z'
      },
      policyDecisionId: 'pd-task-cancel',
      correlationId: 'corr-task-cancel',
      risk: {
        operationDangerLevel: 'medium',
        suspicionScore: 0.2,
        riskFactors: ['audit_visibility']
      }
    }
  },
  {
    route: 'POST /api/v0/tasks/:id/retry',
    schema: Contracts.TaskRetryNotImplementedResponseSchema,
    fixture: {
      error: { code: 'not_implemented_yet', message: 'retry is not implemented' },
      decisionId: 'pd-task-retry',
      risk: {
        operationDangerLevel: 'medium',
        suspicionScore: 0.3,
        riskFactors: ['recent_failure_count']
      }
    }
  },
  {
    route: 'POST /internal/v0/task-operations/:id/resume',
    schema: Contracts.InternalTaskOperationResumeResponseSchema,
    fixture: {
      resumed: true,
      suspendedOpId: 'op-task',
      task: {
        id: 'task-1',
        nodeId: 'node-1',
        leafNodeId: 'node-1',
        type: 'noop',
        status: 'queued',
        createdAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:00:00.000Z'
      }
    }
  },
  {
    route: 'POST /internal/v0/task-operations/:id/reject',
    schema: Contracts.InternalTaskOperationRejectResponseSchema,
    fixture: { rejected: true, suspendedOpId: 'op-task' }
  },
  {
    route: 'POST /internal/v0/tasks/noop',
    schema: Contracts.NodeAgentTaskExecuteEnvelopeResponseSchema,
    fixture: {
      result: {
        nodeId: 'node-1',
        taskId: 'task-1',
        result: 'completed',
        completedAt: '2026-06-04T10:00:00.000Z'
      }
    }
  }
]
