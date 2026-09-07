/**
 * 静态站点 Bun-only 文件服务器：服务 m-ui 静态构建产物并提供 SPA 回退。
 * 只做文件读取与 MIME 映射，不承担任何业务语义；路径穿越在 resolve 后显式拦截。
 */
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '.')
const port = Number(process.env.PORT ?? '4173')
const hostname = process.env.MERISTEM_STATIC_HOST ?? '0.0.0.0'

const mimeByExtension: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
}

const indexHtml = join(root, 'index.html')

async function readStaticFile(path: string): Promise<Response | null> {
  const normalized = normalize(path)
  const absolute = resolve(join(root, normalized))
  // 归一化后必须仍位于根目录内，阻止 ../ 路径穿越
  if (!absolute.startsWith(root)) return null
  const file = Bun.file(absolute)
  if (!(await file.exists())) return null
  const contentType = mimeByExtension[extname(absolute)] ?? 'application/octet-stream'
  return new Response(file, { headers: { 'content-type': contentType } })
}

Bun.serve({
  hostname,
  port,
  async fetch(request) {
    const url = new URL(request.url)
    const pathname = decodeURIComponent(url.pathname)
    const candidate =
      pathname === '/' ? await readStaticFile('index.html') : await readStaticFile(pathname)
    if (candidate) return candidate
    // SPA 回退：未知路径统一返回 index.html，由前端路由接管
    const fallback = await readStaticFile('index.html')
    if (fallback) return fallback
    return new Response('not found', { status: 404 })
  },
  error() {
    return new Response('internal server error', { status: 500 })
  }
})

console.log(`static server serving ${root} on http://${hostname}:${port} (index: ${indexHtml})`)
