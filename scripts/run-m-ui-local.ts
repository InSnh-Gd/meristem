const appRoot = `${import.meta.dir.replace(/\/scripts$/, '')}/apps/m-ui`
const buildRoot = `${appRoot}/build`
const buildOnly = Bun.argv.includes('--build-only')

function contentTypeFor(pathname: string): string | null {
  if (pathname.endsWith('.html')) return 'text/html; charset=utf-8'
  if (pathname.endsWith('.js')) return 'application/javascript; charset=utf-8'
  if (pathname.endsWith('.css')) return 'text/css; charset=utf-8'
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.woff2')) return 'font/woff2'
  return null
}

function sanitizePath(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname)
  if (decoded.includes('..')) return null
  if (decoded === '/') return '/index.html'
  return decoded
}

async function ensureUiBuild(): Promise<void> {
  const buildResult = Bun.spawnSync(['bun', 'run', 'build'], {
    cwd: appRoot,
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env
  })

  if (buildResult.exitCode !== 0) {
    throw new Error(`m-ui build failed with exit code ${buildResult.exitCode}`)
  }
}

async function main(): Promise<void> {
  await ensureUiBuild()

  if (buildOnly) return

  const port = Number(process.env.MERISTEM_UI_PORT ?? '5173')

  // 静态 shell 需要对未知前端路由统一回退到 index.html，保持 adapter-static 的 SPA 行为。
  const server = Bun.serve({
    hostname: '0.0.0.0',
    port,
    async fetch(request) {
      const pathname = sanitizePath(new URL(request.url).pathname)
      if (!pathname) return new Response('invalid path', { status: 400 })

      const assetPath = `${buildRoot}${pathname}`
      const assetFile = Bun.file(assetPath)
      if (await assetFile.exists()) {
        const headers = new Headers()
        const explicitContentType = contentTypeFor(pathname)
        if (explicitContentType) headers.set('content-type', explicitContentType)
        return new Response(assetFile, { headers })
      }

      if (pathname.includes('.')) {
        return new Response('not found', { status: 404 })
      }

      return new Response(Bun.file(`${buildRoot}/index.html`), {
        headers: {
          'content-type': 'text/html; charset=utf-8'
        }
      })
    },
    error() {
      return new Response('internal server error', { status: 500 })
    }
  })

  console.log(`m-ui static shell listening on http://0.0.0.0:${port}`)

  process.on('SIGINT', () => {
    server.stop(true)
    process.exit(0)
  })
}

if (import.meta.main) {
  await main()
}

export {}
