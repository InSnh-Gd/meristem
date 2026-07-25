import * as Schema from 'effect/Schema'
import {
  MNetClosedLoopPublicationSchema,
  MNetJoinApprovalResultSchema,
  MNetOperationDeniedSchema,
  MNetTopologyViewSchema
} from '../../../../packages/contracts/src/index.ts'

/** M-Net closed-loop 公共响应在 BFF 重新解码，避免把未知上游数据送入工作台。 */
export const BffMNetJoinDecisionResponseSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('mutation'),
    contractVersion: Schema.Literal('mnet-closed-loop-mutation@0.1.0'),
    value: MNetJoinApprovalResultSchema,
    publication: MNetClosedLoopPublicationSchema
  }),
  MNetOperationDeniedSchema
)

export const BffMNetManagementTopologyResponseSchema = Schema.Struct({
  topology: MNetTopologyViewSchema,
  stateSource: Schema.Struct({
    sourceType: Schema.Literal('read-model'),
    sourceId: Schema.String
  })
})

/** BFF 只标注 M-Net 的组合读模型来源，不改写拓扑事实或 WireGuard 状态。 */
export function toBffMNetManagementTopology(
  networkId: string,
  topology: typeof MNetTopologyViewSchema.Type
) {
  return {
    topology,
    stateSource: {
      sourceType: 'read-model' as const,
      sourceId: `mnet:/api/v0/mnet/closed-loop/networks/${networkId}/topology`
    }
  }
}
