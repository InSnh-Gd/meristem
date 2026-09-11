import { t } from 'elysia'

export type SecretMetadata = Record<string, string>

export type SecretListRecord = {
  id: string
  name: string
  scope: string
  status: string
  createdBy: string
  createdAt: string
  metadata: SecretMetadata
}

export type SecretDetailRecord = SecretListRecord & {
  updatedAt: string
}

export type SecretCreateRecord = {
  id: string
  name: string
  status: string
  createdAt: string
}

export type SecretRotateRecord = {
  id: string
  version: string
  status: string
  rotatedAt: string
}

export type SecretDisableRecord = {
  id: string
  status: string
  disabledAt: string
}

export type SecretReferenceRecord = {
  id: string
  currentVersion: string
  status: string
  metadata: SecretMetadata
}

export const secretParamsSchema = t.Object({
  id: t.String({ minLength: 1 })
})

export const secretMetadataSchema = t.Record(t.String(), t.String())

export const secretListRecordSchema = t.Object({
  id: t.String(),
  name: t.String(),
  scope: t.String(),
  status: t.String(),
  createdBy: t.String(),
  createdAt: t.String(),
  metadata: secretMetadataSchema
})

export const secretDetailRecordSchema = t.Object({
  ...secretListRecordSchema.properties,
  updatedAt: t.String()
})

export const secretCreateBodySchema = t.Object({
  name: t.String({ minLength: 1 }),
  scope: t.Union([t.Literal('system'), t.Literal('service'), t.Literal('node')]),
  value: t.String({ minLength: 1 }),
  metadata: t.Optional(secretMetadataSchema)
})

export const secretRotateBodySchema = t.Object({
  value: t.String({ minLength: 1 }),
  reason: t.String({ minLength: 1 })
})

export const secretDisableBodySchema = t.Object({
  reason: t.String({ minLength: 1 })
})

export const secretCreateRecordSchema = t.Object({
  id: t.String(),
  name: t.String(),
  status: t.String(),
  createdAt: t.String()
})

export const secretRotateRecordSchema = t.Object({
  id: t.String(),
  version: t.String(),
  status: t.String(),
  rotatedAt: t.String()
})

export const secretDisableRecordSchema = t.Object({
  id: t.String(),
  status: t.String(),
  disabledAt: t.String()
})

export const secretReferenceRecordSchema = t.Object({
  id: t.String(),
  currentVersion: t.String(),
  status: t.String(),
  metadata: secretMetadataSchema
})
