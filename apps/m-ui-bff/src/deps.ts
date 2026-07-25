export type ServiceFetchResult = {
  ok: boolean
  status: number
  data: unknown
}

export type ServiceFetch = (
  path: string,
  token: string,
  init?: RequestInit
) => Promise<ServiceFetchResult>

/**
 * M-Deploy workbench BFF 只依赖 Core public facade，避免浏览器接触内部服务端口。
 */
export type MDeployBffRouteDeps = {
  coreFetch: ServiceFetch
}
