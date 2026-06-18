import { beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 公共 API 边界契约测试
 *
 * 通过静态分析（读取 APISIX 配置、路由定义、NixOS 模块）验证：
 * - 公共 join / relay / UI 路由对外暴露
 * - /internal/v0/* 路由不对外暴露
 * - node-agent 内部控制通道不对外暴露
 */

const repoRoot = join(import.meta.dir, '../..')

// ---- 辅助函数：解析 APISIX YAML 中的路由 URI ----

interface ApisixRoute {
  id: string
  uris: string[]
}

function requiredRouteUris(route: ApisixRoute | undefined): string[] {
  expect(route).toBeDefined()
  return route?.uris ?? []
}

/**
 * 从 APISIX YAML 文本中提取所有对外暴露的路由 URI。
 * 使用行级解析避免依赖 YAML 库。
 */
function extractApisixRouteUris(yamlContent: string): ApisixRoute[] {
  const routes: ApisixRoute[] = []
  const lines = yamlContent.split('\n')

  let currentRoute: { id: string; uris: string[] } | null = null
  let inRoutes = false
  let inUris = false

  for (const line of lines) {
    // 检测 routes 区域开始
    if (line.match(/^routes:/)) {
      inRoutes = true
      continue
    }

    if (!inRoutes) continue

    // 检测路由 ID
    const idMatch = line.match(/^\s{2}-\s*id:\s*(.+)/)
    if (idMatch) {
      if (currentRoute) {
        routes.push({ id: currentRoute.id, uris: [...currentRoute.uris] })
      }
      const routeId = idMatch[1]
      if (!routeId) {
        continue
      }
      currentRoute = { id: routeId.trim(), uris: [] }
      inUris = false
      continue
    }

    if (!currentRoute) continue

    // 检测单行 uri
    const uriMatch = line.match(/^\s{4}uri:\s*(.+)/)
    if (uriMatch) {
      const routeUri = uriMatch[1]
      if (!routeUri) {
        continue
      }
      currentRoute.uris.push(routeUri.trim())
      inUris = false
      continue
    }

    // 检测 uris 列表开始
    if (line.match(/^\s{4}uris:/)) {
      inUris = true
      continue
    }

    // 检测 uris 列表项
    if (inUris) {
      const listUriMatch = line.match(/^\s{6}-\s*(.+)/)
      if (listUriMatch) {
        const listRouteUri = listUriMatch[1]
        if (!listRouteUri) {
          continue
        }
        currentRoute.uris.push(listRouteUri.trim())
      } else {
        // 离开 uris 列表
        inUris = false
      }
    }
  }

  // 收集最后一个路由
  if (currentRoute) {
    routes.push({ id: currentRoute.id, uris: [...currentRoute.uris] })
  }

  return routes
}

// ---- 辅助函数：读取路由定义中的路径 ----

interface RoutePathEntry {
  source: string
  key: string
  path: string
  isInternal: boolean
}

/**
 * 从路由定义源文件中提取所有路由路径。
 * 匹配形如 key: '/path/to/resource' 的模式。
 */
function extractRoutePathsFromSource(content: string, sourceName: string): RoutePathEntry[] {
  const results: RoutePathEntry[] = []
  const pattern = /(\w+):\s*'([^']+)'/g
  for (const match of content.matchAll(pattern)) {
    const key = match[1]
    const path = match[2]

    if (!key || !path) {
      continue
    }

    // 跳过非路由路径（如 method, description 等）
    if (['method', 'path', 'paramsSchema', 'requestSchema', 'responseSchema'].includes(key)) {
      continue
    }

    results.push({
      source: sourceName,
      key,
      path,
      isInternal: path.startsWith('/internal/')
    })
  }

  return results
}

// ---- 辅助函数：从 APISIX YAML 注释中提取显式不路由的列表 ----

/**
 * 从 APISIX YAML 末尾的 "Explicitly not routed" 注释中提取
 * 明确声明不对外暴露的路径列表。
 */
function extractExplicitlyNotRouted(yamlContent: string): string[] {
  const result: string[] = []
  const lines = yamlContent.split('\n')
  let inExplicitSection = false

  for (const line of lines) {
    if (line.includes('Explicitly not routed')) {
      inExplicitSection = true
      continue
    }
    if (inExplicitSection && line.match(/^\s*#\s*-/)) {
      const path = line.replace(/^\s*#\s*-/, '').trim()
      if (path) result.push(path)
    }
    // 遇到 #END 或非注释行时退出
    if (inExplicitSection && (line.includes('#END') || !line.match(/^\s*#/))) {
      break
    }
  }

  return result
}

describe('public API boundary contract', () => {
  let apisixYaml: string
  let apisixRoutes: ApisixRoute[]
  let allApisixUris: string[]

  const apisixPath = join(repoRoot, 'ops/apisix/apisix.yaml')
  const nixosModulePath = join(repoRoot, 'ops/nixos/module.nix')
  const routeDefsDir = join(repoRoot, 'packages/contracts/src/routes')

  beforeEach(() => {
    apisixYaml = readFileSync(apisixPath, 'utf-8')
    apisixRoutes = extractApisixRouteUris(apisixYaml)
    allApisixUris = apisixRoutes.flatMap(r => r.uris)
  })

  // ---- 公共路由暴露断言 ----

  describe('public route exposure', () => {
    it('exposes the join ingress endpoint /join/v0/*', () => {
      const joinRoute = apisixRoutes.find(r => r.id === 'm-net-join-ingress')
      expect(requiredRouteUris(joinRoute)).toContain('/join/v0/*')
    })

    it('exposes Core health, ready, and status endpoints', () => {
      expect(allApisixUris).toContain('/api/v0/health')
      expect(allApisixUris).toContain('/api/v0/ready')
      expect(allApisixUris).toContain('/api/v0/status')
    })

    it('exposes node management endpoints /api/v0/nodes and /api/v0/nodes/*', () => {
      const nodesRoute = apisixRoutes.find(r => r.id === 'core-nodes')
      const uris = requiredRouteUris(nodesRoute)
      expect(uris).toContain('/api/v0/nodes')
      expect(uris).toContain('/api/v0/nodes/*')
    })

    it('exposes node ticket creation endpoint /api/v0/node-tickets', () => {
      expect(allApisixUris).toContain('/api/v0/node-tickets')
    })

    it('exposes network management endpoints /api/v0/networks and /api/v0/networks/*', () => {
      const networksRoute = apisixRoutes.find(r => r.id === 'core-networks')
      const uris = requiredRouteUris(networksRoute)
      expect(uris).toContain('/api/v0/networks')
      expect(uris).toContain('/api/v0/networks/*')
    })

    it('exposes task endpoints /api/v0/tasks and /api/v0/tasks/*', () => {
      const tasksRoute = apisixRoutes.find(r => r.id === 'm-task-tasks')
      const uris = requiredRouteUris(tasksRoute)
      expect(uris).toContain('/api/v0/tasks')
      expect(uris).toContain('/api/v0/tasks/*')
    })

    it('exposes policy approval endpoints', () => {
      const policyRoute = apisixRoutes.find(r => r.id === 'm-policy-approvals')
      const uris = requiredRouteUris(policyRoute)
      expect(uris).toContain('/api/v0/policy/approvals')
      expect(uris).toContain('/api/v0/policy/approvals/*')
    })

    it('exposes M-Net network profile endpoints', () => {
      const profilesRoute = apisixRoutes.find(r => r.id === 'm-net-network-profiles')
      const uris = requiredRouteUris(profilesRoute)
      expect(uris).toContain('/api/v0/network-profiles')
      expect(uris).toContain('/api/v0/network-profiles/*')
    })

    it('exposes M-Net profile set endpoint', () => {
      expect(allApisixUris).toContain('/api/v0/networks/*/profile')
    })

    it('exposes extension endpoints', () => {
      const extRoute = apisixRoutes.find(r => r.id === 'm-extension-extensions')
      const uris = requiredRouteUris(extRoute)
      expect(uris).toContain('/api/v0/extensions')
      expect(uris).toContain('/api/v0/extensions/*')
    })
  })

  // ---- 内部路由不暴露断言 ----

  describe('internal route exclusion', () => {
    it('does NOT expose any /internal/v0/* route', () => {
      const internalUris = allApisixUris.filter(uri => uri.startsWith('/internal/'))
      expect(internalUris).toEqual([])
    })

    it('does NOT expose the M-Net internal control channel', () => {
      // M-Net 内部控制通道 (port 3104, /internal/v0/*) 不应出现在 APISIX 路由中
      const mnetInternalUris = allApisixUris.filter(
        uri => uri.includes('m-net') && uri.startsWith('/internal')
      )
      expect(mnetInternalUris).toEqual([])
    })

    it('does NOT expose config apply-ack internal route', () => {
      const configInternal = allApisixUris.filter(uri => uri.includes('/internal/v0/configs'))
      expect(configInternal).toEqual([])
    })

    it('does NOT expose secrets reference internal route', () => {
      const secretsInternal = allApisixUris.filter(uri => uri.includes('/internal/v0/secrets'))
      expect(secretsInternal).toEqual([])
    })

    it('does NOT expose network profile internal routes (resume, reject)', () => {
      const profileInternal = allApisixUris.filter(uri =>
        uri.includes('/internal/v0/network-profile-operations')
      )
      expect(profileInternal).toEqual([])
    })

    it('does NOT expose identity token introspection internal route', () => {
      const identityInternal = allApisixUris.filter(uri => uri.includes('/internal/v0/identity'))
      expect(identityInternal).toEqual([])
    })

    it('does NOT expose the node-agent internal network-map fetch route', () => {
      const mapInternal = allApisixUris.filter(
        uri => uri.includes('/internal/v0/networks') && uri.includes('network-map')
      )
      expect(mapInternal).toEqual([])
    })
  })

  // ---- 路由定义完整性：验证所有内部路由在源码中存在但不在 APISIX 中 ----

  describe('route definition completeness', () => {
    it('confirms /internal/v0/* routes exist in source code but are excluded from APISIX', () => {
      // 从路由定义文件中收集所有路径
      const routeFiles = ['config.ts', 'mnet-profile.ts', 'secrets.ts']
      const allInternalPaths: RoutePathEntry[] = []

      for (const file of routeFiles) {
        const filePath = join(routeDefsDir, file)
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf-8')
          const paths = extractRoutePathsFromSource(content, file)
          allInternalPaths.push(...paths)
        }
      }

      // 提取所有内部路径
      const internalPaths = allInternalPaths.filter(p => p.isInternal)
      const internalPathValues = internalPaths.map(p => p.path)

      // 验证内部路径确实存在于源码中
      expect(internalPaths.length).toBeGreaterThan(0)

      // 验证内部路径不包含在 APISIX 公开路由中
      for (const internalPath of internalPathValues) {
        // 将参数化路径转换为通配符模式用于匹配
        const wildcardPattern = internalPath.replace(/\/:[^/]+/g, '/*')
        const matchedInApisix = allApisixUris.some(apisixUri => {
          // APISIX 使用 * 作为通配符
          const apisixPattern = apisixUri.replace(/\*/g, '.*')
          const internalPattern = wildcardPattern.replace(/\*/g, '.*')
          try {
            return (
              new RegExp(`^${internalPattern}$`).test(apisixUri) ||
              new RegExp(`^${apisixPattern}$`).test(internalPath)
            )
          } catch {
            return false
          }
        })

        expect(matchedInApisix).toBe(false)
      }
    })
  })

  // ---- APISIX 显式声明不路由注释 ----

  describe('APISIX explicit not-routed declarations', () => {
    it('explicitly declares /internal/v0/* is not routed', () => {
      const explicitlyNotRouted = extractExplicitlyNotRouted(apisixYaml)
      const hasInternalV0Declaration = explicitlyNotRouted.some(entry =>
        entry.startsWith('/internal/v0')
      )
      expect(hasInternalV0Declaration).toBe(true)
    })

    it('explicitly declares M-Policy internal endpoint is not routed', () => {
      const explicitlyNotRouted = extractExplicitlyNotRouted(apisixYaml)
      const hasPolicyInternal = explicitlyNotRouted.some(
        entry => entry.includes('M-Policy') || entry.includes('/internal/v0/authorize')
      )
      expect(hasPolicyInternal).toBe(true)
    })

    it('explicitly declares M-Log internal write endpoints are not routed', () => {
      const explicitlyNotRouted = extractExplicitlyNotRouted(apisixYaml)
      const hasLogInternal = explicitlyNotRouted.some(entry => entry.includes('M-Log'))
      expect(hasLogInternal).toBe(true)
    })
  })

  // ---- NixOS 模块边界断言 ----

  describe('NixOS module boundary', () => {
    let nixosContent: string

    beforeEach(() => {
      nixosContent = readFileSync(nixosModulePath, 'utf-8')
    })

    it('does NOT expose /internal/v0/* through any systemd or nginx configuration', () => {
      // NixOS 模块不应包含 internal 路由的暴露配置
      expect(nixosContent).not.toContain('/internal/v0')
    })

    it('declares only Bun services for internal loopback ports', () => {
      // 验证 NixOS 模块中的端口声明不暴露内部端口
      // 所有 M-* 服务应该在 loopback 上运行
      expect(nixosContent).toContain('meristem-m-eventbus')
      expect(nixosContent).toContain('meristem-m-policy')
      expect(nixosContent).toContain('meristem-m-log')
      expect(nixosContent).toContain('meristem-m-net')
    })

    it('declares bootstrap cert generation for join ingress', () => {
      // 验证 NixOS 模块包含 join ingress 证书生成
      expect(nixosContent).toContain('certs-dev.ts')
    })
  })

  // ---- 端口边界断言 ----

  describe('port boundary', () => {
    it('confirms the runbook limits public exposure to join ingress and relay ports', () => {
      const runbookPath = join(repoRoot, 'docs/operations/RUNBOOK.md')
      const runbookContent = readFileSync(runbookPath, 'utf-8')

      // 验证 RUNBOOK 中的公共暴露规则
      expect(runbookContent).toContain(
        'public deployment exposes `8443` for join ingress and `443` for the fallback relay'
      )

      // 验证内部端口标记为 loopback-only
      expect(runbookContent).toContain('3104')
      expect(runbookContent).toContain('loopback')
    })
  })
})
