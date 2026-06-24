import * as Schema from 'effect/Schema'
import {
  DataPlaneStatusResponseSchema,
  InternalNetworkProfileRejectResponseSchema,
  InternalNetworkProfileResumeResponseSchema,
  MNetProfileListResponseSchema,
  MNetRegionalProfileSchema,
  NetworkMapResponseSchema,
  NodeKeyRegistrationResponseSchema,
  SetNetworkProfileRequestSchema,
  SetNetworkProfileResponseSchema
} from '../schemas/mnet-profile.ts'
import { NodeControlRequestSchema, NodeControlResponseSchema } from '../schemas/core.ts'

export const mNetProfileApiRoutes = {
  collection: '/api/v0/network-profiles',
  detail: '/api/v0/network-profiles/:profileVersion',
  setNetworkProfile: '/api/v0/networks/:id/profile',
  nodeControl: '/api/v0/nodes/:nodeId/control',
  networkMap: '/api/v0/networks/:id/network-map',
  registerNodeKey: '/api/v0/networks/:id/nodes/:nodeId/key',
  dataPlaneStatus: '/api/v0/networks/:id/dataplane/status',
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

export const NetworkNodeRouteParamsSchema = Schema.Struct({
  id: Schema.String,
  nodeId: Schema.String
})
export type NetworkNodeRouteParamsFromSchema = typeof NetworkNodeRouteParamsSchema.Type

export const NodeControlRouteParamsSchema = Schema.Struct({
  nodeId: Schema.String
})
export type NodeControlRouteParamsFromSchema = typeof NodeControlRouteParamsSchema.Type

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
  nodeControl: {
    method: 'POST',
    path: mNetProfileApiRoutes.nodeControl,
    paramsSchema: NodeControlRouteParamsSchema,
    requestSchema: NodeControlRequestSchema,
    responseSchema: NodeControlResponseSchema
  },
  networkMap: {
    method: 'GET',
    path: mNetProfileApiRoutes.networkMap,
    paramsSchema: NetworkProfileRouteParamsSchema,
    responseSchema: NetworkMapResponseSchema
  },
  registerNodeKey: {
    method: 'POST',
    path: mNetProfileApiRoutes.registerNodeKey,
    paramsSchema: NetworkNodeRouteParamsSchema,
    responseSchema: NodeKeyRegistrationResponseSchema
  },
  dataPlaneStatus: {
    method: 'GET',
    path: mNetProfileApiRoutes.dataPlaneStatus,
    paramsSchema: NetworkProfileRouteParamsSchema,
    responseSchema: DataPlaneStatusResponseSchema
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
