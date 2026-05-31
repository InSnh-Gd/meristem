import * as Schema from 'effect/Schema'
import { SduiV02RouteRegistrySchema, type SduiV02RouteRegistry } from '../../../../packages/contracts/src/schemas/ui.ts'

/** Phase 14 SDUI v0.2 路由注册表；启动时用 schema 解码，避免发布未登记组件。 */
export const PHASE_14_ROUTE_REGISTRY: SduiV02RouteRegistry = Schema.decodeUnknownSync(SduiV02RouteRegistrySchema)({
  schemaVersion: 'sdui@0.2.0',
  routes: [
    {
      id: 'control-room.overview',
      title: '控制室概览',
      requiredPermissions: ['core:read', 'timeline:read'],
      stateSources: ['authoritative', 'event', 'log', 'audit'],
      degradedState: { enabled: true, reason: 'Core 或日志读模型降级时显示局部数据' },
      components: [
        { kind: 'NodeMap', id: 'overview-node-map' },
        { kind: 'TimelineStream', id: 'overview-timeline-stream' },
        { kind: 'ServiceRegistryTable', id: 'overview-service-registry' },
        { kind: 'InlineOperationalAlert', id: 'overview-operational-alert' },
        { kind: 'CommandWellPanel', id: 'overview-command-well' }
      ]
    },
    {
      id: 'nodes.index',
      title: '节点列表',
      requiredPermissions: ['core:read'],
      stateSources: ['authoritative', 'event'],
      degradedState: { enabled: true, reason: '节点权威读路径降级时显示空列表' },
      components: [
        { kind: 'NodeListPanel', id: 'nodes-list' },
        { kind: 'KeyValueInspector', id: 'nodes-inspector' },
        { kind: 'TraceLink', id: 'nodes-trace-link' }
      ]
    },
    {
      id: 'nodes.detail',
      title: '节点详情',
      requiredPermissions: ['core:read'],
      stateSources: ['authoritative', 'event', 'log'],
      degradedState: { enabled: true, reason: '节点详情缺失时保留可追溯错误 envelope' },
      components: [
        { kind: 'KeyValueInspector', id: 'node-detail-inspector' },
        { kind: 'TimelineStream', id: 'node-detail-timeline' },
        { kind: 'RawEnvelopeView', id: 'node-detail-envelope' }
      ]
    },
    {
      id: 'timeline.index',
      title: '时间线',
      requiredPermissions: ['timeline:read'],
      stateSources: ['event', 'log'],
      degradedState: { enabled: true, reason: 'Timeline Log 降级时保留来源标记' },
      components: [
        { kind: 'TimelineStream', id: 'timeline-stream' },
        { kind: 'TraceLink', id: 'timeline-trace-link' },
        { kind: 'FilterBar', id: 'timeline-filter-bar' }
      ]
    },
    {
      id: 'audit.index',
      title: '审计事实',
      requiredPermissions: ['audit:read'],
      stateSources: ['audit'],
      degradedState: { enabled: true, reason: 'Audit Log 由 Core 鉴权，拒绝时显示访问受限' },
      components: [
        { kind: 'AuditLedger', id: 'audit-ledger' },
        { kind: 'TraceLink', id: 'audit-trace-link' },
        { kind: 'RawEnvelopeView', id: 'audit-envelope' }
      ]
    },
    {
      id: 'policy.decisions',
      title: '策略决策',
      requiredPermissions: ['core:read'],
      stateSources: ['policy', 'audit'],
      degradedState: { enabled: true, reason: '策略决策列表不可用时显示空列表与来源' },
      components: [
        { kind: 'PolicyDecisionPanel', id: 'policy-decision-panel' },
        { kind: 'DecisionQueueSummary', id: 'policy-decision-queue' }
      ]
    },
    {
      id: 'services.index',
      title: '服务列表',
      requiredPermissions: ['core:read'],
      stateSources: ['authoritative'],
      degradedState: { enabled: true, reason: '服务生命周期读路径降级时显示空列表' },
      components: [
        { kind: 'ServiceRegistryTable', id: 'services-list' },
        { kind: 'KeyValueInspector', id: 'services-inspector' }
      ]
    }
  ]
})
