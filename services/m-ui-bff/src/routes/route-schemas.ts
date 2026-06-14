import { t } from 'elysia'

export const idParamsSchema = t.Object({ id: t.String({ minLength: 1 }) })
export const commandIdParamsSchema = t.Object({ commandId: t.String({ minLength: 1 }) })
export const leafNodeIdBodySchema = t.Object({ leafNodeId: t.String({ minLength: 1 }) })
