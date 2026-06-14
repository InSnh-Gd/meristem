import type {
  DisableExtensionRequest,
  EnableExtensionRequest,
  ExtensionDetailResponse,
  ExtensionInstanceControlResponse,
  ExtensionListResponse,
  RegisterExtensionResponse
} from '../../../../packages/contracts/src/index.ts'
import { mExtensionApiRoutes } from '../../../../packages/contracts/src/types/extension.ts'
import type { CliClient } from '../commands/types.ts'
import type { CliRuntime } from './runtime.ts'

/**
 * 扩展客户端直接命中 m-extension 服务，保持原有 API 路由常量和错误处理方式。
 */
export function createExtensionClient(
  runtime: CliRuntime
): Pick<
  CliClient,
  'listExtensions' | 'getExtension' | 'registerExtension' | 'enableExtension' | 'disableExtension'
> {
  const { extensionRoutes } = runtime

  return {
    listExtensions: async () => {
      const result = await extensionRoutes.getJson<ExtensionListResponse>(
        mExtensionApiRoutes.collection
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    getExtension: async id => {
      const result = await extensionRoutes.getJson<ExtensionDetailResponse>(
        mExtensionApiRoutes.detail,
        { params: { id } }
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    registerExtension: async input => {
      const result = await extensionRoutes.postJson<RegisterExtensionResponse>(
        mExtensionApiRoutes.register,
        { body: input }
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    enableExtension: async (id, input?: EnableExtensionRequest) => {
      const result = await extensionRoutes.postJson<ExtensionInstanceControlResponse>(
        mExtensionApiRoutes.enable,
        { params: { id }, body: input ?? {} }
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    disableExtension: async (id, input?: DisableExtensionRequest) => {
      const result = await extensionRoutes.postJson<ExtensionInstanceControlResponse>(
        mExtensionApiRoutes.disable,
        { params: { id }, body: input ?? {} }
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
  }
}
