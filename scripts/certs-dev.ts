/**
 * Join ingress 在 MVP 中自己终止 TLS。
 * 这个脚本为本地开发生成固定路径的自签名证书，避免手工拼接 openssl 参数。
 * 可选第一个参数覆盖输出目录（生产 bootstrap 容器用它把证书写入挂载卷）。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argDir = Bun.argv[2]
const certDir = argDir ? resolve(argDir) : '.local/certs'
const certFile = join(certDir, 'join-ingress-cert.pem')
const keyFile = join(certDir, 'join-ingress-key.pem')
const certValidityDays = process.env.MERISTEM_CERT_VALIDITY_DAYS ?? '30'
const opensslBinary =
  process.env.MERISTEM_OPENSSL_BINARY_PATH ??
  (existsSync('/run/current-system/sw/bin/openssl')
    ? '/run/current-system/sw/bin/openssl'
    : 'openssl')

mkdirSync(certDir, { recursive: true })

const generated = Bun.spawnSync(
  [
    opensslBinary,
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-days',
    certValidityDays,
    '-subj',
    '/CN=localhost',
    '-keyout',
    keyFile,
    '-out',
    certFile
  ],
  {
    stdout: 'inherit',
    stderr: 'inherit'
  }
)

if (generated.exitCode !== 0) {
  throw new Error('failed to generate self-signed join ingress certificate')
}

console.log(`generated ${certFile}`)
console.log(`generated ${keyFile}`)
