/**
 * 生产 bootstrap init 任务：按顺序执行数据库迁移、种子数据、Join Ingress 证书生成
 * 与初始 admin actor token 铸造。任何一步失败都立即以非零码退出，
 * 使 `compose up --wait` 整体失败并中止后续服务启动，由运维重跑部署。
 *
 * 环境变量：
 * - DATABASE_URL：PostgreSQL 连接串（迁移与种子）
 * - MERISTEM_JWT_SECRET：token 铸造签名密钥
 * - MERISTEM_BOOTSTRAP_CERT_DIR：证书输出目录（默认 /bootstrap/certs）
 * - MERISTEM_BOOTSTRAP_TOKEN_DIR：token 输出目录（默认 /bootstrap/tokens）
 * - MERISTEM_BOOTSTRAP_ACTORS：逗号分隔的初始 actor 列表（默认 admin）
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { join } from 'node:path'

const certDir = process.env.MERISTEM_BOOTSTRAP_CERT_DIR ?? '/bootstrap/certs'
const tokenDir = process.env.MERISTEM_BOOTSTRAP_TOKEN_DIR ?? '/bootstrap/tokens'
const actors = (process.env.MERISTEM_BOOTSTRAP_ACTORS ?? 'admin')
  .split(',')
  .map(actor => actor.trim())
  .filter(actor => actor.length > 0)

function runStep(name: string, command: string[]) {
  console.log(`[bootstrap] ${name}: ${command.join(' ')}`)
  const proc = Bun.spawnSync(command, {
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env as Record<string, string>
  })
  if (proc.exitCode !== 0) {
    console.error(`[bootstrap] ${name} failed with exit code ${proc.exitCode}`)
    process.exit(proc.exitCode ?? 1)
  }
}

// 1. 数据库迁移 + 种子（幂等，可重复执行）
runStep('db migrate', ['bun', 'run', 'packages/db/src/migrate.ts'])
runStep('db seed', ['bun', 'run', 'packages/db/src/seed.ts'])

// 2. Join Ingress 证书：优先复用已挂载的既有证书，缺失时才生成
mkdirSync(certDir, { recursive: true })
const certFile = join(certDir, 'join-ingress-cert.pem')
const keyFile = join(certDir, 'join-ingress-key.pem')
if (Bun.file(certFile).size > 0 && Bun.file(keyFile).size > 0) {
  console.log(`[bootstrap] join ingress certificate already present at ${certDir}`)
} else {
  runStep('join ingress certificates', ['bun', 'run', 'scripts/certs-dev.ts', certDir])
}
// openssl 默认把私钥写成 0600 root，而 m-net 以非 root 用户挂载本卷读取；
// 卷只在容器网络内可见且以 ro 挂载，放宽为 0444 不扩大暴露面。
chmodSync(certFile, 0o444)
chmodSync(keyFile, 0o444)

// 2.1 网络地图签名密钥（Ed25519）：M-Net 渲染签名地图的必需材料，
// 与证书一样进 certs 卷随 m-net 只读挂载；已存在则复用。
const signingFile = join(certDir, 'network-map-signing-private.pem')
if (existsSync(signingFile)) {
  console.log(`[bootstrap] network-map signing key already present at ${signingFile}`)
} else {
  const { privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(signingFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o444 })
  console.log(`[bootstrap] generated network-map signing key -> ${signingFile}`)
}
chmodSync(signingFile, 0o444)

// 3. 初始 actor token 铸造：写入挂载目录供运维取出，绝不打印 token 本体
if (!process.env.MERISTEM_JWT_SECRET) {
  console.error('[bootstrap] MERISTEM_JWT_SECRET is required for token minting')
  process.exit(1)
}
mkdirSync(tokenDir, { recursive: true })
for (const actor of actors) {
  const mint = Bun.spawnSync(['bun', 'run', 'packages/auth/src/mint-token.ts', '--actor', actor], {
    stdout: 'pipe',
    stderr: 'inherit',
    env: process.env as Record<string, string>
  })
  if (mint.exitCode !== 0) {
    console.error(`[bootstrap] token mint for ${actor} failed`)
    process.exit(mint.exitCode ?? 1)
  }
  const token = new TextDecoder().decode(mint.stdout).trim()
  if (!token) {
    console.error(`[bootstrap] token mint for ${actor} produced no output`)
    process.exit(1)
  }
  const tokenFile = join(tokenDir, `${actor}.token`)
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 })
  console.log(`[bootstrap] minted ${actor} token -> ${tokenFile}`)
}

console.log('[bootstrap] all bootstrap steps completed')
