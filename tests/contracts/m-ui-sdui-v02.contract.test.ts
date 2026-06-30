import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  ApprovalDetailDisplaySchema,
  ApprovalQueueItemSchema,
  NetworkProfileListItemSchema,
  OperationalCommandPreviewSchema,
  SduiV02RouteRegistrySchema,
  SduiV02RouteSchema
} from '../../packages/contracts/src/schemas/ui.ts'

const requiredSduiV02RouteIds = [
  'control-room.overview',
  'nodes.index',
  'nodes.detail',
  'timeline.index',
  'audit.index',
  'policy.decisions',
  'policy.approvals',
  'policy.approvals.detail',
  'network.profiles',
  'network.profiles.detail',
  'services.index',
  'networks.index',
  'networks.detail',
  'nodes.credentials',
  'mnet.dataplane.status',
  'mnet.profile.migration',
  'mnet.break-glass'
] as const

const forbiddenComponentKinds = [
  // UI anti-patterns that must never appear as SDUI component kinds
  'Toast',
  'Snackbar',
  'DecorativeCard',
  'MarketingBanner',
  'Confetti',
  'Carousel',
  'FloatingActionButton',
  'UnscopedDropdownActionMenu',
  'UnlabeledDestructiveIconButton',
  // Orphan kinds removed during SDUI v0.2 registry lock — must not return
  'TimelinePanel',
  'NodeListPanel',
  'NodeDetailPanel',
  'ServiceListPanel'
] as const

const validRouteV02 = {
  id: 'control-room.overview',
  title: 'Control Room Overview',
  requiredPermissions: ['timeline:read'],
  stateSources: ['authoritative', 'event', 'cache', 'read-model', 'log', 'audit', 'policy'],
  degradedState: {
    enabled: true,
    reason: 'audit backend degraded'
  },
  components: [
    {
      kind: 'TimelineStream',
      id: 'timeline-main'
    }
  ]
} as const

const approvalQueueItem = {
  approvalId: 'approval-001',
  policyDecisionId: 'decision-001',
  originService: 'm-net',
  operationId: 'operation-001',
  requestedBy: 'admin',
  requiredAction: 'multi_approval',
  quorumRequired: 2,
  status: 'pending',
  expiresAt: '2026-06-15T12:00:00.000Z',
  createdAt: '2026-06-15T10:00:00.000Z',
  completedAt: '2026-06-15T11:00:00.000Z',
  stateSource: 'policy'
} as const

const approvalDetailDisplay = {
  approval: approvalQueueItem,
  votes: [
    {
      actor: 'admin',
      vote: 'approve',
      reason: 'approved after audit review',
      createdAt: '2026-06-15T10:30:00.000Z',
      stateSource: 'audit'
    },
    {
      actor: 'security-admin',
      vote: 'reject',
      createdAt: '2026-06-15T10:45:00.000Z',
      stateSource: 'log'
    }
  ]
} as const

const networkProfileListItem = {
  profileVersion: 'm-net-cn@0.3.0',
  region: 'cn',
  displayName: 'China NetBird Sidecar',
  controlPlaneOnly: false,
  status: 'enabled',
  networkId: 'network-cn-001',
  stateSource: 'authoritative'
} as const

const operationalCommandPreview = {
  commandId: 'policy.approval.approve.preview',
  label: '批准审批请求',
  action: 'display-only',
  resource: 'approval/approval-001',
  risk: 'high',
  requiredPermissions: ['policy:approval-approve'],
  requiresPolicy: true,
  requiresAudit: true,
  state: 'disabled',
  disabledReason: '等待更多审批人',
  displayOnly: true
} as const

describe('SDUI v0.2 route schema', () => {
  it('decodes and encodes approval queue items', () => {
    const decoded = Schema.decodeUnknownSync(ApprovalQueueItemSchema)(approvalQueueItem)
    const encoded = Schema.encodeSync(ApprovalQueueItemSchema)(decoded)

    expect(decoded).toEqual(approvalQueueItem)
    expect(encoded).toEqual(approvalQueueItem)
  })

  it('decodes and encodes approval detail display payloads', () => {
    const decoded = Schema.decodeUnknownSync(ApprovalDetailDisplaySchema)(approvalDetailDisplay)
    const encoded = Schema.encodeSync(ApprovalDetailDisplaySchema)(decoded)

    expect(decoded).toEqual(approvalDetailDisplay)
    expect(encoded).toEqual(approvalDetailDisplay)
  })

  it('decodes and encodes network profile list items', () => {
    const decoded = Schema.decodeUnknownSync(NetworkProfileListItemSchema)(networkProfileListItem)
    const encoded = Schema.encodeSync(NetworkProfileListItemSchema)(decoded)

    expect(decoded).toEqual(networkProfileListItem)
    expect(encoded).toEqual(networkProfileListItem)
  })

  it('decodes and encodes operational command previews', () => {
    const decoded = Schema.decodeUnknownSync(OperationalCommandPreviewSchema)(
      operationalCommandPreview
    )
    const encoded = Schema.encodeSync(OperationalCommandPreviewSchema)(decoded)

    expect(decoded).toEqual(operationalCommandPreview)
    expect(encoded).toEqual(operationalCommandPreview)
  })

  it('operational command previews fail closed for non-display-only values or execute paths', () => {
    expect(() =>
      Schema.decodeUnknownSync(OperationalCommandPreviewSchema)({
        ...operationalCommandPreview,
        displayOnly: false
      })
    ).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(OperationalCommandPreviewSchema, {
        onExcessProperty: 'error'
      })({
        ...operationalCommandPreview,
        executePath: '/api/v0/policy/approvals/approval-001/approve'
      })
    ).toThrow()
  })

  it('accepts valid v0.2 routes with stateSources, degradedState, and requiredPermissions', () => {
    const decoded = Schema.decodeUnknownSync(SduiV02RouteSchema)(validRouteV02)

    expect(decoded.id).toBe('control-room.overview')
    expect(decoded.requiredPermissions).toEqual(['timeline:read'])
    expect(decoded.stateSources).toEqual([
      'authoritative',
      'event',
      'cache',
      'read-model',
      'log',
      'audit',
      'policy'
    ])
    expect(decoded.degradedState.enabled).toBe(true)
  })

  it('unknown component kind is rejected', () => {
    const unknownKindRoute = {
      ...validRouteV02,
      components: [
        {
          kind: 'UnknownComponentKind',
          id: 'bad-component'
        }
      ]
    } as const

    expect(() => Schema.decodeUnknownSync(SduiV02RouteSchema)(unknownKindRoute)).toThrow()
  })

  it('forbidden component kinds are rejected', () => {
    for (const forbiddenKind of forbiddenComponentKinds) {
      const routeWithForbiddenKind = {
        ...validRouteV02,
        components: [
          {
            kind: forbiddenKind,
            id: `forbidden-${forbiddenKind.toLowerCase()}`
          }
        ]
      } as const

      expect(() => Schema.decodeUnknownSync(SduiV02RouteSchema)(routeWithForbiddenKind)).toThrow()
    }
  })

  it('route registry contains required SDUI v0.2 route IDs', () => {
    const registry = {
      schemaVersion: 'sdui@0.2.0',
      routes: requiredSduiV02RouteIds.map(id => ({
        ...validRouteV02,
        id
      }))
    } as const

    const decoded = Schema.decodeUnknownSync(SduiV02RouteRegistrySchema)(registry)
    const routeIds = decoded.routes.map(route => route.id)

    // Bun 的 toEqual 重载在 strict 模式下不接受 readonly tuple；
    // 展开为普通字符串列表进行比较，语义不变且消除 TS2769。
    expect(routeIds).toEqual([...requiredSduiV02RouteIds])
    expect(new Set(routeIds).size).toBe(17)
  })

  it('every route declares state sources', () => {
    const registry = {
      schemaVersion: 'sdui@0.2.0',
      routes: requiredSduiV02RouteIds.map(id => ({
        ...validRouteV02,
        id
      }))
    } as const

    const decoded = Schema.decodeUnknownSync(SduiV02RouteRegistrySchema)(registry)
    for (const route of decoded.routes) {
      expect(route.stateSources.length).toBeGreaterThan(0)
    }
  })
})
