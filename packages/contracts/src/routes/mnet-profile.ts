import * as Schema from 'effect/Schema'
import {
  InternalNetworkProfileRejectResponseSchema,
  InternalNetworkProfileResumeResponseSchema,
  MNetProfileListResponseSchema,
  MNetRegionalProfileSchema,
  SetNetworkProfileRequestSchema,
  SetNetworkProfileResponseSchema
} from '../schemas/mnet-profile.ts'

export const mNetProfileApiRoutes = {
  collection: '/api/v0/network-profiles',
  detail: '/api/v0/network-profiles/:profileVersion',
  setNetworkProfile: '/api/v0/networks/:id/profile',
  resumeOperation: '/internal/v0/network-profile-operations/:id/resume',
  rejectOperation: '/internal/v0/network-profile-operations/:id/reject'
} as const

export const MNetProfileVersionParamsSchema = Schema.Struct({
  profileVersion: Schema.String
})
export type MNetProfileVersionParamsFromSchema = typeof MNetProfileVersionParamsSchema.Type

export const NetworkProfileRouteParamsSchema = Schema.Struct({
  id: Schema.String
})
export type NetworkProfileRouteParamsFromSchema = typeof NetworkProfileRouteParamsSchema.Type

export const MNetProfileDetailResponseSchema = MNetRegionalProfileSchema
export type MNetProfileDetailResponseFromSchema = typeof MNetProfileDetailResponseSchema.Type

export const mNetProfileRouteContracts = {
  list: {
    method: 'GET',
    path: mNetProfileApiRoutes.collection,
    responseSchema: MNetProfileListResponseSchema
  },
  detail: {
    method: 'GET',
    path: mNetProfileApiRoutes.detail,
    paramsSchema: MNetProfileVersionParamsSchema,
    responseSchema: MNetProfileDetailResponseSchema
  },
  setNetworkProfile: {
    method: 'POST',
    path: mNetProfileApiRoutes.setNetworkProfile,
    paramsSchema: NetworkProfileRouteParamsSchema,
    requestSchema: SetNetworkProfileRequestSchema,
    responseSchema: SetNetworkProfileResponseSchema
  },
  resumeOperation: {
    method: 'POST',
    path: mNetProfileApiRoutes.resumeOperation,
    paramsSchema: NetworkProfileRouteParamsSchema,
    responseSchema: InternalNetworkProfileResumeResponseSchema
  },
  rejectOperation: {
    method: 'POST',
    path: mNetProfileApiRoutes.rejectOperation,
    paramsSchema: NetworkProfileRouteParamsSchema,
    responseSchema: InternalNetworkProfileRejectResponseSchema
  }
} as const
