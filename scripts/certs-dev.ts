/**
 * Join ingress 在 MVP 中自己终止 TLS。
 * 这个脚本为本地开发生成固定路径的自签名证书，避免手工拼接 openssl 参数。
 */
import { existsSync } from 'node:fs'

const certDir = '.local/certs'
const certFile = `${certDir}/join-ingress-cert.pem`
const keyFile = `${certDir}/join-ingress-key.pem`
const opensslBinary =
  process.env.MERISTEM_OPENSSL_BINARY_PATH ??
  (existsSync('/run/current-system/sw/bin/openssl')
    ? '/run/current-system/sw/bin/openssl'
    : 'openssl')

const mkdir = Bun.spawnSync(['mkdir', '-p', certDir], { stdout: 'inherit', stderr: 'inherit' })
if (mkdir.exitCode !== 0) {
  throw new Error(`failed to create ${certDir}`)
}

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
    '30',
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
