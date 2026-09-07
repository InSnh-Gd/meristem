// bun.lock workspace 清单与依赖安装镜像 deps 阶段 COPY 清单的一致性检查。
// 独立成文件以守住 oci-pipeline.ts 的 500 行模块化上限；由 oci:preflight 门禁调用。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const rootDir = join(import.meta.dir, '..')

export type ManifestCoverageFailure = {
  readonly code: 'workspace_manifest_drift'
  readonly message: string
}

type ManifestCoverageResult =
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly error: ManifestCoverageFailure }

// 依赖安装镜像的 deps 阶段必须 COPY bun.lock 登记的每个 workspace manifest；
// bun ≤1.3.x 的 frozen lockfile 校验会把缺失 workspace 视为变更直接失败，
// 1.4.x 虽然容忍但会静默跳过该 workspace 的依赖安装，漂移必须在这里拦截。
const manifestDockerfiles = [
  'ops/docker/Dockerfile.service',
  'ops/docker/Dockerfile.bootstrap',
  'apps/m-ui/Dockerfile'
] as const
const workspaceKeyPattern = /"((?:apps|packages|services)\/[A-Za-z0-9._-]+)":\s*\{/g
const copyManifestPattern =
  /^COPY\s+((?:apps|packages|services)\/[A-Za-z0-9._-]+\/package\.json)(?=\s|$)/gm

/**
 * ops/oci/Containerfile.m-ui 只 COPY 根清单与 apps/m-ui 整树，缺失 workspace 依赖
 * bun 1.4.x 的静默跳过语义；apps/m-ui 一旦声明 workspace:* 依赖就必须回到显式清单，
 * 这里作为 fail-closed 守卫拦截该漂移。
 */
function muiWorkspaceDependencyDrift(contextDir: string): string | null {
  const manifestPath = join(contextDir, 'apps/m-ui/package.json')
  if (!existsSync(manifestPath)) return 'apps/m-ui/package.json is missing'
  let manifest: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return 'apps/m-ui/package.json is malformed and cannot be checked for workspace dependencies'
  }
  const workspaceDeps = Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies
  })
    .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('workspace:'))
    .map(([name]) => name)
  return workspaceDeps.length > 0
    ? `ops/oci/Containerfile.m-ui installs only root manifests but apps/m-ui declares workspace dependencies: ${workspaceDeps.join(', ')}`
    : null
}

/**
 * 校验 bun.lock workspace 清单与依赖安装镜像的 COPY 清单一致，防止两份清单漂移。
 */
export function validateWorkspaceManifestCoverage(contextDir = rootDir): ManifestCoverageResult {
  const lockfilePath = join(contextDir, 'bun.lock')
  if (!existsSync(lockfilePath)) {
    return {
      ok: false,
      error: {
        code: 'workspace_manifest_drift',
        message: 'bun.lock is missing from the repository'
      }
    }
  }
  const lockfile = readFileSync(lockfilePath, 'utf8')
  const workspaces = new Set<string>()
  for (const match of lockfile.matchAll(workspaceKeyPattern)) {
    if (match[1]) workspaces.add(match[1])
  }

  const drift: string[] = []
  for (const dockerfile of manifestDockerfiles) {
    const dockerfilePath = join(contextDir, dockerfile)
    if (!existsSync(dockerfilePath)) {
      drift.push(`${dockerfile}: manifest Dockerfile is missing`)
      continue
    }
    const copied = new Set<string>()
    for (const match of readFileSync(dockerfilePath, 'utf8').matchAll(copyManifestPattern)) {
      if (match[1]) {
        copied.add(match[1].replace(/\/package\.json$/, ''))
      }
    }
    for (const workspace of workspaces) {
      if (!copied.has(workspace)) {
        drift.push(`${dockerfile}: missing COPY for ${workspace}/package.json`)
      }
    }
    for (const entry of copied) {
      if (!workspaces.has(entry)) {
        drift.push(`${dockerfile}: COPY of non-workspace manifest ${entry}/package.json`)
      }
    }
  }

  const muiDrift = muiWorkspaceDependencyDrift(contextDir)
  if (muiDrift) drift.push(muiDrift)

  if (drift.length > 0) {
    return {
      ok: false,
      error: { code: 'workspace_manifest_drift', message: drift.join('; ') }
    }
  }
  return { ok: true, value: [...workspaces].sort() }
}
