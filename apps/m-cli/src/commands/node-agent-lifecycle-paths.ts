import { lstat } from 'node:fs/promises'
import { dirname, isAbsolute, parse, resolve } from 'node:path'
import type { LifecycleConfig } from './node-agent-lifecycle-definitions.ts'

export async function assertSafeLifecyclePaths(lifecycle: LifecycleConfig): Promise<void> {
  const protectedConfigDir = resolve(lifecycle.configDir)
  const protectedRuntimeDir = resolve(dirname(lifecycle.runtimeStatePath))
  const configPaths = [
    lifecycle.configDir,
    lifecycle.envFilePath,
    lifecycle.joinTicketPath,
    lifecycle.nodeIdPath,
    lifecycle.runtimeTokenPath,
    lifecycle.acmeAccountKeyPath,
    lifecycle.wireGuardPrivateKeyPath,
    lifecycle.wireGuardPublicKeyPath,
    lifecycle.wireGuardMetadataPath
  ]

  for (const path of configPaths) {
    assertWithinRoot(path, protectedConfigDir)
    await assertNoExistingSymlinkInPath(path)
  }

  assertWithinRoot(lifecycle.runtimeStatePath, protectedRuntimeDir)
  await assertNoExistingSymlinkInPath(lifecycle.runtimeStatePath)
}

export async function assertSafeLifecycleFilePath(path: string): Promise<void> {
  if (!isAbsolute(path)) {
    throw new Error(`node-agent lifecycle path must be absolute: ${path}`)
  }
  await assertNoExistingSymlinkInPath(path)
}

function assertWithinRoot(path: string, root: string): void {
  const absolutePath = resolve(path)
  if (absolutePath !== root && !absolutePath.startsWith(`${root}/`)) {
    throw new Error(`node-agent lifecycle path escapes managed root: ${path}`)
  }
}

async function assertNoExistingSymlinkInPath(path: string): Promise<void> {
  const absolutePath = resolve(path)
  const root = parse(absolutePath).root
  const parts = absolutePath.slice(root.length).split('/').filter(Boolean)
  let current = root
  for (const part of parts) {
    current = resolve(current, part)
    try {
      const stats = await lstat(current)
      if (stats.isSymbolicLink()) {
        throw new Error(`node-agent lifecycle path uses symlink: ${current}`)
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('node-agent lifecycle path uses symlink')
      ) {
        throw error
      }
      return
    }
  }
}
