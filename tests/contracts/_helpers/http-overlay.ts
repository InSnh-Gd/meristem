type HandleApp = {
  handle(request: Request): Response | Promise<Response>
}

/**
 * 让测试可在不改动真实 app 装配顺序的前提下，优先拦截少量指定路由；
 * 未命中时继续回退到原始 app，避免大体量测试文件依赖 Elysia route 覆盖细节。
 */
export function createOverlayApp(baseApp: HandleApp, overlayApp: HandleApp): HandleApp {
  return {
    async handle(request: Request) {
      const overlayResponse = await overlayApp.handle(new Request(request))
      const contentType = overlayResponse.headers.get('content-type') ?? ''
      const isStructuredMiss =
        overlayResponse.status === 404 && !contentType.includes('application/json')
      return isStructuredMiss ? baseApp.handle(request) : overlayResponse
    }
  }
}
