import { t } from 'elysia'

const nonEmptyString = t.String({ minLength: 1 })

/** M-Net 管理路由使用独立 TypeBox 输入，避免复用不相干的通用命令请求体。 */
export const mnetManagementNetworkParamsSchema = t.Object({ id: nonEmptyString })

export const mnetManagementJoinRequestParamsSchema = t.Object({
  id: nonEmptyString,
  requestId: nonEmptyString
})

export const approveMnetJoinRequestBodySchema = t.Object({
  credentialExpiresAt: nonEmptyString
})

export const rejectMnetJoinRequestBodySchema = t.Object({
  reason: nonEmptyString
})
