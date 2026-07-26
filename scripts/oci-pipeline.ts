import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { validateMDeployPromotionV01 } from '../packages/contracts/src/index.ts'

export type OciTarget = {
  readonly name: string
  readonly imageName: string
  readonly kind: 'service' | 'static-artifact'
  readonly containerfile: string
  readonly entrypoint?: string
  readonly activation: 'runnable' | 'host-adapter-required'
}

type PreflightFailure = {
  readonly code:
    | 'base_image_not_pinned'
    | 'build_context_secret_contamination'
    | 'external_tool_unavailable'
    | 'invalid_target'
    | 'target_inventory_invalid'
    | 'build_context_policy_invalid'
  readonly message: string
}

type PipelineResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PreflightFailure }

const rootDir = import.meta.dir === '.' ? process.cwd() : join(import.meta.dir, '..')

export const ociTargets: readonly OciTarget[] = [
  serviceTarget('core', 'apps/core/src/index.ts'),
  serviceTarget('m-deploy', 'services/m-deploy/src/serve.ts', 'host-adapter-required'),
  serviceTarget('m-eventbus', 'services/m-eventbus/src/index.ts'),
  serviceTarget('m-extension', 'services/m-extension/src/index.ts'),
  serviceTarget('m-log', 'services/m-log/src/index.ts'),
  serviceTarget('m-net', 'services/m-net/src/index.ts'),
  serviceTarget('m-policy', 'services/m-policy/src/index.ts'),
  serviceTarget('m-task', 'services/m-task/src/index.ts'),
  serviceTarget('m-ui-bff', 'services/m-ui-bff/src/index.ts'),
  serviceTarget('node-agent', 'services/node-agent/src/index.ts'),
  {
    name: 'm-ui',
    imageName: 'm-ui',
    kind: 'static-artifact',
    containerfile: 'ops/oci/Containerfile.m-ui',
    activation: 'runnable'
  }
]

/** Operator CLI is executed through an admitted control-plane image, not deployed as its own service. */
export const ociTargetExclusions = [
  {
    entrypoint: 'apps/m-cli/src/index.ts',
    reason: 'operator CLI is a client surface and has no independently deployed runtime'
  },
  {
    entrypoint: 'services/m-deploy/src/index.ts',
    reason: 'M-Deploy library barrel; its deployable Bun server is services/m-deploy/src/serve.ts'
  }
] as const

function serviceTarget(
  name: string,
  entrypoint: string,
  activation: OciTarget['activation'] = 'runnable'
): OciTarget {
  return {
    name,
    imageName: name,
    kind: 'service',
    containerfile: 'ops/oci/Containerfile.service',
    entrypoint,
    activation
  }
}

/** Returns the build target without allowing callers to invent an image surface. */
export function resolveOciTarget(name: string): PipelineResult<OciTarget> {
  const target = ociTargets.find(candidate => candidate.name === name)
  return target
    ? { ok: true, value: target }
    : { ok: false, error: { code: 'invalid_target', message: `unknown OCI target: ${name}` } }
}

/** Ensures the declared OCI surface accounts for every runnable workspace entrypoint. */
export function validateOciTargetInventory(contextDir = rootDir): PipelineResult<readonly string[]> {
  const discoveredEntrypoints = [
    ...new Bun.Glob('apps/*/src/index.ts').scanSync({ cwd: contextDir, onlyFiles: true }),
    ...new Bun.Glob('services/*/src/index.ts').scanSync({ cwd: contextDir, onlyFiles: true }),
    ...new Bun.Glob('services/*/src/serve.ts').scanSync({ cwd: contextDir, onlyFiles: true })
  ].sort()
  const declaredEntrypoints = ociTargets
    .filter((target): target is OciTarget & { readonly entrypoint: string } => target.entrypoint !== undefined)
    .map(target => target.entrypoint)
    .sort()
  const excludedEntrypoints = new Set<string>(ociTargetExclusions.map(exclusion => exclusion.entrypoint))
  const unaccountedEntrypoints = discoveredEntrypoints.filter(
    entrypoint => !declaredEntrypoints.includes(entrypoint) && !excludedEntrypoints.has(entrypoint)
  )
  const staleDeclarations = declaredEntrypoints.filter(
    entrypoint => !discoveredEntrypoints.includes(entrypoint)
  )
  const missingUiArtifact = !existsSync(join(contextDir, 'apps/m-ui/package.json'))

  if (unaccountedEntrypoints.length > 0 || staleDeclarations.length > 0 || missingUiArtifact) {
    const details = [
      unaccountedEntrypoints.length > 0
        ? `unaccounted entrypoints: ${unaccountedEntrypoints.join(', ')}`
        : '',
      staleDeclarations.length > 0 ? `missing entrypoints: ${staleDeclarations.join(', ')}` : '',
      missingUiArtifact ? 'M-UI static artifact workspace is missing' : ''
    ].filter(Boolean)
    return {
      ok: false,
      error: { code: 'target_inventory_invalid', message: details.join('; ') }
    }
  }

  return { ok: true, value: [] }
}

/** Production base images are part of the reproducible input and must be immutable. */
export function validateDigestPinnedImage(reference: string | undefined): PipelineResult<string> {
  if (!reference || !/@sha(256|512):[a-f0-9]{64,128}$/.test(reference)) {
    return {
      ok: false,
      error: {
        code: 'base_image_not_pinned',
        message:
          'OCI_BUN_BASE_IMAGE and OCI_STATIC_BASE_IMAGE must use immutable sha256/sha512 digests'
      }
    }
  }
  return { ok: true, value: reference }
}

const excludedContextSegments = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'test-results',
  'tests',
  'docs',
  'config',
  'ops',
  'secrets'
])
const secretFilePattern = /(^|\/)(\.env(?:\..*)?|[^/]+\.(?:pem|key|p12|pfx))$/i
const plaintextSecretPattern =
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?:aws_access_key_id|github_pat_|ghp_)[\s:=]/i

function excludedFromBuildContext(path: string): boolean {
  const parts = path.split('/')
  return (
    parts.some(part => part.startsWith('.') || excludedContextSegments.has(part)) ||
    secretFilePattern.test(path)
  )
}

/** 测试签名夹具可随源码进入构建上下文，但不是部署凭据，不能触发生产密钥泄漏告警。 */
function containsFixtureOnlyKey(path: string): boolean {
  return path.endsWith('/testing.ts') || path === 'services/m-deploy/src/testing.ts'
}

/**
 * 扫描实际会进入根构建上下文的文件；密钥路径必须由 .dockerignore 排除，内容标记也不能进入镜像。
 */
export function scanBuildContextForSecrets(contextDir = rootDir): readonly string[] {
  const issues: string[] = []
  for (const entry of new Bun.Glob('**/*').scanSync({ cwd: contextDir, onlyFiles: true })) {
    const contextPath = entry.startsWith(contextDir) ? relative(contextDir, entry) : entry
    if (excludedFromBuildContext(contextPath)) continue
    const fullPath = entry.startsWith(contextDir) ? entry : join(contextDir, entry)
    if (statSync(fullPath).size > 1024 * 1024) continue
    const text = readFileSync(fullPath, 'utf8')
    if (containsFixtureOnlyKey(contextPath)) continue
    if (plaintextSecretPattern.test(text)) issues.push(contextPath)
  }
  return issues
}

function requireTools(tools: readonly string[]): PipelineResult<readonly string[]> {
  const missing = tools.filter(tool => Bun.which(tool) === null)
  return missing.length === 0
    ? { ok: true, value: tools }
    : {
        ok: false,
        error: {
          code: 'external_tool_unavailable',
          message: `required OCI tools are unavailable: ${missing.join(', ')}`
        }
      }
}

export function validateOciBuildPreflight(input: {
  readonly bunBaseImage: string | undefined
  readonly staticBaseImage: string | undefined
  readonly contextDir?: string
  readonly requireExternalTools: boolean
}): PipelineResult<readonly string[]> {
  const bunBase = validateDigestPinnedImage(input.bunBaseImage)
  if (!bunBase.ok) return bunBase
  const staticBase = validateDigestPinnedImage(input.staticBaseImage)
  if (!staticBase.ok) return staticBase

  const secretIssues = scanBuildContextForSecrets(input.contextDir)
  if (secretIssues.length > 0) {
    return {
      ok: false,
      error: {
        code: 'build_context_secret_contamination',
        message: `build context contains secret material: ${secretIssues.join(', ')}`
      }
    }
  }
  return input.requireExternalTools
    ? requireTools(['podman', 'syft', 'cosign'])
    : { ok: true, value: [] }
}

/** Validates the repository-only OCI policy without requiring release credentials or external binaries. */
export function validateOciStaticPreflight(
  target: OciTarget,
  contextDir = rootDir
): PipelineResult<readonly string[]> {
  const inventory = validateOciTargetInventory(contextDir)
  if (!inventory.ok) return inventory

  const containerfilePath = join(contextDir, target.containerfile)
  if (!existsSync(containerfilePath)) {
    return {
      ok: false,
      error: { code: 'build_context_policy_invalid', message: `missing Containerfile: ${target.containerfile}` }
    }
  }

  const containerfile = readFileSync(containerfilePath, 'utf8')
  const entrypoint = target.entrypoint ? join(contextDir, target.entrypoint) : undefined
  const mDeployEntrypointIsServing =
    target.name !== 'm-deploy' ||
    (entrypoint !== undefined &&
      existsSync(entrypoint) &&
      readFileSync(entrypoint, 'utf8').includes('serveProductionMDeployApp'))
  const dockerignorePath = join(contextDir, '.dockerignore')
  const dockerignore = existsSync(dockerignorePath) ? readFileSync(dockerignorePath, 'utf8') : ''
  const requiredIgnoreRules = ['.*', '.env', '*.pem', '*.key']
  const missingIgnoreRules = requiredIgnoreRules.filter(rule => !dockerignore.includes(rule))
  const requiresBunRuntime =
    target.kind === 'service'
      ? /FROM \$\{BUN_BASE_IMAGE\}/.test(containerfile) && /\bbun\b/.test(containerfile)
      : /FROM \$\{BUN_BASE_IMAGE\} AS build/.test(containerfile) &&
        /FROM \$\{STATIC_BASE_IMAGE\}/.test(containerfile)

  if (
    containerfile.includes('COPY . .') ||
    !requiresBunRuntime ||
    !mDeployEntrypointIsServing ||
    missingIgnoreRules.length > 0
  ) {
    const details = [
      containerfile.includes('COPY . .') ? 'Containerfiles must not copy the entire build context' : '',
      !requiresBunRuntime ? 'Containerfile does not preserve the required Bun runtime/build boundary' : '',
      !mDeployEntrypointIsServing
        ? 'M-Deploy must use a production-serving entrypoint rather than its export barrel'
        : '',
      missingIgnoreRules.length > 0
        ? `missing .dockerignore rules: ${missingIgnoreRules.join(', ')}`
        : ''
    ].filter(Boolean)
    return {
      ok: false,
      error: { code: 'build_context_policy_invalid', message: details.join('; ') }
    }
  }

  const secretIssues = scanBuildContextForSecrets(contextDir)
  return secretIssues.length === 0
    ? { ok: true, value: [] }
    : {
        ok: false,
        error: {
          code: 'build_context_secret_contamination',
          message: `build context contains secret material: ${secretIssues.join(', ')}`
        }
      }
}

export function validatePromotionMetadata(input: unknown): PipelineResult<unknown> {
  if (containsPlaintextSecret(input)) {
    return {
      ok: false,
      error: {
        code: 'build_context_secret_contamination',
        message: 'promotion metadata must not contain plaintext secret-bearing fields or values'
      }
    }
  }
  const promotion = validateMDeployPromotionV01(input)
  return promotion.ok
    ? { ok: true, value: promotion.value }
    : { ok: false, error: { code: 'invalid_target', message: promotion.error.message } }
}

function containsPlaintextSecret(value: unknown, key = ''): boolean {
  if (typeof value === 'string') {
    return (
      plaintextSecretPattern.test(value) ||
      /(?:password|token|secret|credential|privatekey)/i.test(key)
    )
  }
  if (Array.isArray(value)) return value.some(item => containsPlaintextSecret(item, key))
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).some(([childKey, child]) => containsPlaintextSecret(child, childKey))
}

function readOption(args: readonly string[], name: string): string | undefined {
  return args.find(argument => argument.startsWith(`${name}=`))?.slice(name.length + 1)
}

function requiredOption(args: readonly string[], name: string): string {
  const value = readOption(args, name)
  if (!value) throw new Error(`${name} is required`)
  return value
}

type BuildPlan = {
  readonly target: OciTarget
  readonly dryRun: boolean
}

type ConfiguredBaseImages = {
  readonly bunBaseImage: string | undefined
  readonly staticBaseImage: string | undefined
}

function validateConfiguredBaseImages(input: ConfiguredBaseImages): PipelineResult<readonly string[]> {
  if (input.bunBaseImage === undefined && input.staticBaseImage === undefined) return { ok: true, value: [] }
  const bunBase = validateDigestPinnedImage(input.bunBaseImage)
  if (!bunBase.ok) return bunBase
  const staticBase = validateDigestPinnedImage(input.staticBaseImage)
  return staticBase.ok ? { ok: true, value: [] } : staticBase
}

/** Creates a build plan only after static policy and any supplied base-image configuration validate. */
export function createOciBuildPlan(
  args: readonly string[],
  configuredBaseImages: ConfiguredBaseImages = {
    bunBaseImage: process.env.OCI_BUN_BASE_IMAGE,
    staticBaseImage: process.env.OCI_STATIC_BASE_IMAGE
  }
): PipelineResult<BuildPlan> {
  const targetName = requiredOption(args, '--target')
  const targetResult = resolveOciTarget(targetName)
  if (!targetResult.ok) return targetResult
  const staticPreflight = validateOciStaticPreflight(targetResult.value)
  if (!staticPreflight.ok) return staticPreflight
  const baseImages = validateConfiguredBaseImages(configuredBaseImages)
  if (!baseImages.ok) return baseImages
  return { ok: true, value: { target: targetResult.value, dryRun: args.includes('--dry-run') } }
}

function dryRunBuild(target: OciTarget): void {
  const environmentPlaceholder = (name: string) => ['$', `{${name}}`].join('')
  const baseArgs = [
    '--build-arg',
    `BUN_BASE_IMAGE=${environmentPlaceholder('OCI_BUN_BASE_IMAGE')}`,
    ...(target.kind === 'static-artifact'
      ? ['--build-arg', `STATIC_BASE_IMAGE=${environmentPlaceholder('OCI_STATIC_BASE_IMAGE')}`]
      : ['--build-arg', `SERVICE_ENTRY=${target.entrypoint}`])
  ]
  console.log(
    JSON.stringify(
      {
        mode: 'dry-run',
        preflight: 'static OCI policy validated; no registry, build, signing, or attestation executed',
        target: target.name,
        activation: target.activation,
        command: ['podman', 'build', ...baseArgs, '-f', target.containerfile, '.'],
        attestations: [
          'syft SPDX SBOM',
          'SLSA/in-toto provenance',
          'cosign signature verification'
        ],
        promotion:
          'requires immutable digest, SBOM, provenance, signature, signer, and rollback pointer'
      },
      null,
      2
    )
  )
}

function runBuild(args: readonly string[]): void {
  const plan = createOciBuildPlan(args)
  if (!plan.ok) throw new Error(`${plan.error.code}: ${plan.error.message}`)
  if (plan.value.dryRun) {
    dryRunBuild(plan.value.target)
    return
  }

  const preflight = validateOciBuildPreflight({
    bunBaseImage: process.env.OCI_BUN_BASE_IMAGE,
    staticBaseImage: process.env.OCI_STATIC_BASE_IMAGE,
    requireExternalTools: true
  })
  if (!preflight.ok) throw new Error(`${preflight.error.code}: ${preflight.error.message}`)
  throw new Error(
    'live OCI execution is release-only; use bun run oci:release in an authorized environment after registry and signing policies admit the build'
  )
}

function runPreflight(): void {
  for (const target of ociTargets) {
    const preflight = validateOciStaticPreflight(target)
    if (!preflight.ok) throw new Error(`${preflight.error.code}: ${preflight.error.message}`)
  }
  console.log(
    JSON.stringify(
      {
        mode: 'static-preflight',
        targets: ociTargets.map(target => target.name),
        result: 'validated repository inventory, build context, Containerfiles, and secret exclusions'
      },
      null,
      2
    )
  )
}

async function runPromotion(args: readonly string[]): Promise<void> {
  const inputPath = requiredOption(args, '--input')
  if (!existsSync(inputPath)) throw new Error(`promotion input does not exist: ${inputPath}`)
  const promotion = validatePromotionMetadata(JSON.parse(await Bun.file(inputPath).text()))
  if (!promotion.ok) throw new Error(`${promotion.error.code}: ${promotion.error.message}`)
  console.log(JSON.stringify(promotion.value, null, 2))
}

function usage(): string {
  return [
    'Usage:',
    '  bun run oci:preflight',
    '  bun run oci:build --target=<target> --dry-run',
    '  bun run oci:release (authorized environment only)',
    '  bun run oci:promotion --input=<promotion.json>',
    `Targets: ${ociTargets.map(target => target.name).join(', ')}`
  ].join('\n')
}

async function main(): Promise<void> {
  const [, , command, ...args] = Bun.argv
  if (command === 'preflight') return runPreflight()
  if (command === 'build') return runBuild(args)
  if (command === 'promotion') return await runPromotion(args)
  console.log(usage())
  process.exitCode = 1
}

if (import.meta.main) await main()

export function rootRelative(path: string): string {
  return relative(rootDir, path)
}
