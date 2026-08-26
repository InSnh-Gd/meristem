import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  BffCredentialMutationResponseSchema,
  disabledEligibility,
  enabledEligibility
} from '../../../services/m-ui-bff/src/routes/mnet-dataplane-contracts.ts'
import { readJoinTicketCreateBody } from '../../../services/m-ui-bff/src/routes/mnet-dataplane-body-readers.ts'

describe('M-Net dataplane support characterization', () => {
  it('decodes a credential lifecycle response without exposing token material', () => {
    const result = Schema.decodeUnknownSync(BffCredentialMutationResponseSchema)({
      nodeId: 'leaf-1',
      action: 'rotated',
      policyDecisionId: 'decision-1',
      correlationId: 'corr-1',
      issuedAt: '2026-08-26T00:00:00.000Z'
    })

    expect(result).toEqual({
      nodeId: 'leaf-1',
      action: 'rotated',
      policyDecisionId: 'decision-1',
      correlationId: 'corr-1',
      issuedAt: '2026-08-26T00:00:00.000Z'
    })
  })

  it('rejects an unknown credential lifecycle action', () => {
    expect(() =>
      Schema.decodeUnknownSync(BffCredentialMutationResponseSchema)({
        nodeId: 'leaf-1',
        action: 'unknown',
        policyDecisionId: 'decision-1',
        correlationId: 'corr-1'
      })
    ).toThrow()
  })

  it('maps an eligible command to the exact auditable command descriptor', () => {
    expect(
      enabledEligibility({
        id: 'network.node.rotate',
        label: '轮换节点凭证',
        action: 'network:profile-enable',
        resource: 'network:network-1/node:leaf-1',
        requiredPermissions: ['network:profile-enable']
      })
    ).toEqual({
      state: 'enabled',
      command: {
        id: 'network.node.rotate',
        label: '轮换节点凭证',
        action: 'network:profile-enable',
        resource: 'network:network-1/node:leaf-1',
        risk: 'high',
        requiredPermissions: ['network:profile-enable'],
        requiresPolicy: true,
        requiresAudit: true
      }
    })
  })

  it('maps missing permission to the exact disabled descriptor', () => {
    expect(
      disabledEligibility(
        'missing_permission',
        '缺少权限：network:profile-enable',
        'network:profile-enable'
      )
    ).toEqual({
      state: 'disabled',
      disabled: {
        code: 'missing_permission',
        message: '缺少权限：network:profile-enable',
        missingPermission: 'network:profile-enable'
      },
      disabledReason: '缺少权限：network:profile-enable'
    })
  })

  it('reads a complete join ticket body without changing optional fields', () => {
    expect(
      readJoinTicketCreateBody({
        kind: 'leaf',
        name: 'edge-leaf-1',
        capabilities: ['telemetry'],
        expiresInSeconds: 600
      })
    ).toEqual({
      kind: 'leaf',
      name: 'edge-leaf-1',
      capabilities: ['telemetry'],
      expiresInSeconds: 600
    })
  })

  it('preserves the existing null failure sentinel for an invalid join ticket body', () => {
    expect(
      readJoinTicketCreateBody({
        kind: 'leaf',
        name: 'edge-leaf-1',
        capabilities: [1]
      })
    ).toBeNull()
  })
})
