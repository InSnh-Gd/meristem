import { Elysia } from 'elysia'
import { protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps } from '../types.ts'
import { configDraftBodySchema, configParamsSchema } from './config-schemas.ts'
import {
  createConfigDraft,
  listConfigRecords,
  readConfigDetail,
  validateConfigRecord
} from './config-support.ts'

/**
 * Config CRUD 路由处理读取、草稿和校验边界，不承载高风险发布与回退流程。
 */
export const createConfigCrudRoutes = (deps: CoreDeps) =>
  new Elysia({ prefix: '/api/v0/configs' })
    // 读取配置要求 Bearer 身份和 config:read 权限，但不依赖 M-Policy/Audit 可用性，保证只读排障路径可降级工作。
    .get('/', async ({ headers }) => ({ configs: await listConfigRecords(deps, headers) }), {
      detail: protectedRouteDetail('List config records')
    })
    // 单条配置详情返回 payload 供控制面确认，但 payload 已由草稿边界禁止明文 secret。
    .get(
      '/:id',
      async ({ params, headers }) => ({
        config: await readConfigDetail(deps, { headers, id: params.id })
      }),
      {
        params: configParamsSchema,
        detail: protectedRouteDetail('Show one config record')
      }
    )
    // 草稿创建只做本地权限与明文 secret 拦截，不写 Audit，避免把配置编辑误归类为高风险发布事实。
    .post(
      '/drafts',
      async ({ body, headers, set }) => {
        const config = await createConfigDraft(deps, {
          headers,
          domain: body.domain,
          payload: body.payload,
          ...(body.targetScope ? { targetScope: body.targetScope } : {})
        })
        set.status = 201
        return { config }
      },
      {
        body: configDraftBodySchema,
        detail: protectedRouteDetail('Create config draft')
      }
    )
    // validate 是中风险生命周期转换：需要 actor 具备 config:validate，但不强依赖 Audit 可用性。
    .post(
      '/:id/validate',
      async ({ params, headers }) => ({
        config: await validateConfigRecord(deps, { headers, id: params.id })
      }),
      {
        params: configParamsSchema,
        detail: protectedRouteDetail('Validate config record')
      }
    )
