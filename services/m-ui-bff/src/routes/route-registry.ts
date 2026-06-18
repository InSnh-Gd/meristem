import * as Schema from 'effect/Schema'
import {
  type SduiV02RouteRegistry,
  SduiV02RouteRegistrySchema
} from '../../../../packages/contracts/src/schemas/ui.ts'

/** SDUI v0.2 路由注册表；启动时用 schema 解码，避免发布未登记组件。 */
export const SDUI_V02_ROUTE_REGISTRY: SduiV02RouteRegistry = Schema.decodeUnknownSync(
  SduiV02RouteRegistrySchema
)({
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
      id: 'policy.approvals',
      title: '审批队列',
      requiredPermissions: ['policy:approval-read'],
      stateSources: ['policy', 'audit'],
      degradedState: { enabled: true, reason: '审批队列读路径降级时显示待处理来源与空列表' },
      components: [
        { kind: 'ApprovalQueuePanel', id: 'policy-approval-queue-panel' },
        { kind: 'DecisionQueueSummary', id: 'policy-approval-queue-summary' },
        { kind: 'OperationalCommandPreview', id: 'policy-approval-command-preview' }
      ]
    },
    {
      id: 'policy.approvals.detail',
      title: '审批详情',
      requiredPermissions: ['policy:approval-read'],
      stateSources: ['policy', 'audit', 'log'],
      degradedState: { enabled: true, reason: '审批详情缺失时保留审计、日志与原始 envelope' },
      components: [
        { kind: 'ApprovalDetailPanel', id: 'policy-approval-detail-panel' },
        { kind: 'TraceLink', id: 'policy-approval-trace-link' },
        { kind: 'RawEnvelopeView', id: 'policy-approval-envelope' },
        { kind: 'OperationalCommandPreview', id: 'policy-approval-detail-command-preview' }
      ]
    },
    {
      id: 'network.profiles',
      title: '网络 Profile',
      requiredPermissions: ['network:profile-read'],
      stateSources: ['authoritative', 'policy', 'audit'],
      degradedState: { enabled: true, reason: '网络 Profile 读路径降级时显示来源与内联告警' },
      components: [
        { kind: 'NetworkProfileListPanel', id: 'network-profile-list-panel' },
        { kind: 'InlineOperationalAlert', id: 'network-profile-operational-alert' }
      ]
    },
    {
      id: 'network.profiles.detail',
      title: 'Profile 详情',
      requiredPermissions: ['network:profile-read'],
      stateSources: ['authoritative', 'policy', 'audit', 'log'],
      degradedState: { enabled: true, reason: 'Profile 详情缺失时保留追踪链接与命令预览' },
      components: [
        { kind: 'NetworkProfileDetailPanel', id: 'network-profile-detail-panel' },
        { kind: 'TraceLink', id: 'network-profile-trace-link' },
        { kind: 'OperationalCommandPreview', id: 'network-profile-detail-command-preview' }
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
    },
    {
      id: 'networks.index',
      title: '数据面网络',
      requiredPermissions: ['network:read'],
      stateSources: ['authoritative', 'event'],
      degradedState: { enabled: true, reason: '网络列表降级时显示空列表' },
      components: [
        { kind: 'NetworkListPanel', id: 'networks-list' },
        { kind: 'CommandWellPanel', id: 'networks-command-well' }
      ]
    },
    {
      id: 'networks.detail',
      title: '网络详情',
      requiredPermissions: ['network:read'],
      stateSources: ['authoritative', 'event', 'log'],
      degradedState: { enabled: true, reason: '网络详情降级时显示追踪与基本信息' },
      components: [
        { kind: 'NetworkDetailPanel', id: 'network-detail-panel' },
        { kind: 'TraceLink', id: 'network-trace-link' },
        { kind: 'CommandWellPanel', id: 'network-detail-command-well' }
      ]
    },
    {
      id: 'nodes.credentials',
      title: '节点凭证',
      requiredPermissions: ['core:read'],
      stateSources: ['authoritative', 'audit'],
      degradedState: { enabled: true, reason: '节点凭证查询降级时只允许只读' },
      components: [
        { kind: 'NodeCredentialPanel', id: 'node-credential-panel' },
        { kind: 'CommandWellPanel', id: 'node-credential-command-well' }
      ]
    },
    {
      id: 'mnet.dataplane.status',
      title: '数据面状态',
      requiredPermissions: ['network:read'],
      stateSources: ['authoritative', 'event', 'audit'],
      degradedState: { enabled: true, reason: '数据面状态探测降级时显示最后已知状态' },
      components: [
        { kind: 'DataplaneStatusPanel', id: 'dataplane-status-panel' },
        { kind: 'TraceLink', id: 'dataplane-trace-link' }
      ]
    },
    {
      id: 'mnet.profile.migration',
      title: 'Profile 迁移',
      requiredPermissions: ['network:profile-enable'],
      stateSources: ['authoritative', 'policy', 'audit'],
      degradedState: { enabled: true, reason: '迁移过程查询降级时禁止执行新命令' },
      components: [
        { kind: 'CommandWellPanel', id: 'mnet-migration-command-well' },
        { kind: 'TraceLink', id: 'mnet-migration-trace-link' }
      ]
    },
    {
      id: 'mnet.break-glass',
      title: '紧急预案 (Break-glass)',
      requiredPermissions: ['network:profile-disable'],
      stateSources: ['authoritative', 'audit'],
      degradedState: { enabled: true, reason: '核心服务降级时通过本地备用配置允许操作' },
      components: [
        { kind: 'CommandWellPanel', id: 'mnet-break-glass-command-well' },
        { kind: 'TraceLink', id: 'mnet-break-glass-trace-link' }
      ]
    }
  ]
})
