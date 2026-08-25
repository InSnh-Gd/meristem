import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createOciBuildPlan,
  type OciTarget,
  validateOciBuildPreflight,
  validatePromotionMetadata
} from './oci-pipeline.ts'

type Digest = {
  readonly algorithm: 'sha256' | 'sha512'
  readonly value: string
}

export type OciReleaseInput = {
  readonly target: string
  readonly bunBaseImage: string
  readonly staticBaseImage: string
  readonly imageRepository: string
  readonly sourceCommit: string
  readonly sourceEnvironment: string
  readonly targetEnvironment: string
  readonly approvalActor: string
  readonly rollbackDigest: string
  readonly signerIdentity: string
  readonly signerIssuer: string
}

type ReleaseFailure = {
  readonly code:
    | 'release_environment_invalid'
    | 'release_execution_failed'
    | 'evidence_referrer_unavailable'
  readonly message: string
}

type ReleaseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ReleaseFailure }

function readString(input: unknown, field: string): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const value = Reflect.get(input, field)
  return typeof value === 'string' ? value.trim() : undefined
}

function parseDigest(value: string): Digest | undefined {
  const match = /^(sha256|sha512):([a-f0-9]{64}|[a-f0-9]{128})$/.exec(value)
  if (!match || match[1] === undefined || match[2] === undefined) return undefined
  const algorithm = match[1]
  if (algorithm !== 'sha256' && algorithm !== 'sha512') return undefined
  const expectedLength = algorithm === 'sha256' ? 64 : 128
  return match[2].length === expectedLength ? { algorithm, value: match[2] } : undefined
}

function isRepository(value: string): boolean {
  const imageName = value.slice(value.lastIndexOf('/') + 1)
  return (
    /^[a-z0-9][a-z0-9.:/_-]*$/i.test(value) &&
    value.includes('/') &&
    !value.includes('@') &&
    !imageName.includes(':')
  )
}

/** Validates release-only inputs before any registry or signing command is executed. */
export function validateOciReleaseInput(input: unknown): ReleaseResult<OciReleaseInput> {
  const target = readString(input, 'target')
  const bunBaseImage = readString(input, 'bunBaseImage')
  const staticBaseImage = readString(input, 'staticBaseImage')
  const imageRepository = readString(input, 'imageRepository')
  const sourceCommit = readString(input, 'sourceCommit')
  const sourceEnvironment = readString(input, 'sourceEnvironment')
  const targetEnvironment = readString(input, 'targetEnvironment')
  const approvalActor = readString(input, 'approvalActor')
  const rollbackDigest = readString(input, 'rollbackDigest')
  const signerIdentity = readString(input, 'signerIdentity')
  const signerIssuer = readString(input, 'signerIssuer')

  if (
    !target ||
    !bunBaseImage ||
    !staticBaseImage ||
    !imageRepository ||
    !sourceCommit ||
    !sourceEnvironment ||
    !targetEnvironment ||
    !approvalActor ||
    !rollbackDigest ||
    !signerIdentity ||
    !signerIssuer
  ) {
    return {
      ok: false,
      error: { code: 'release_environment_invalid', message: 'release environment is incomplete' }
    }
  }

  if (!isRepository(imageRepository)) {
    return {
      ok: false,
      error: {
        code: 'release_environment_invalid',
        message: 'OCI_RELEASE_IMAGE_REPOSITORY must be an untagged OCI repository'
      }
    }
  }
  if (!/^[a-f0-9]{40,64}$/.test(sourceCommit)) {
    return {
      ok: false,
      error: {
        code: 'release_environment_invalid',
        message: 'OCI_SOURCE_COMMIT must be a full immutable source commit'
      }
    }
  }
  if (sourceEnvironment === targetEnvironment) {
    return {
      ok: false,
      error: {
        code: 'release_environment_invalid',
        message: 'release source and target environments must differ'
      }
    }
  }
  if (!parseDigest(rollbackDigest)) {
    return {
      ok: false,
      error: {
        code: 'release_environment_invalid',
        message: 'OCI_ROLLBACK_DIGEST must be a canonical sha256 or sha512 digest'
      }
    }
  }

  const buildPlan = createOciBuildPlan([`--target=${target}`], {
    bunBaseImage,
    staticBaseImage
  })
  if (!buildPlan.ok) {
    return {
      ok: false,
      error: { code: 'release_environment_invalid', message: buildPlan.error.message }
    }
  }

  return {
    ok: true,
    value: {
      target,
      bunBaseImage,
      staticBaseImage,
      imageRepository,
      sourceCommit,
      sourceEnvironment,
      targetEnvironment,
      approvalActor,
      rollbackDigest,
      signerIdentity,
      signerIssuer
    }
  }
}

function toolFailure(tool: string, exitCode: number, stderr: Uint8Array): ReleaseFailure {
  const output = new TextDecoder().decode(stderr).trim()
  return {
    code: 'release_execution_failed',
    message: `${tool} failed with exit ${exitCode}: ${output || 'no stderr output'}`
  }
}

function runTool(tool: string, args: readonly string[]): ReleaseResult<string> {
  const process = Bun.spawnSync({ cmd: [tool, ...args], stdout: 'pipe', stderr: 'pipe' })
  if (process.exitCode !== 0) {
    return { ok: false, error: toolFailure(tool, process.exitCode, process.stderr) }
  }
  return { ok: true, value: new TextDecoder().decode(process.stdout) }
}

function fileDigest(path: string): Digest {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(readFileSync(path))
  return { algorithm: 'sha256', value: hasher.digest('hex') }
}

function ociEvidenceRef(
  imageRepository: string,
  imageDigest: Digest,
  artifact: 'signature' | 'attestation',
  predicateType: string | undefined,
  path: string
) {
  const selection = predicateType
    ? `artifact=${artifact}&predicateType=${predicateType}`
    : `artifact=${artifact}`
  return {
    uri: `oci://${imageRepository}@${imageDigest.algorithm}:${imageDigest.value}?${selection}`,
    digest: fileDigest(path),
    redactionStatus: 'metadata_only' as const,
    subjectDigest: imageDigest,
    artifact,
    ...(predicateType ? { predicateType } : {}),
    verification: {
      tool: 'cosign' as const,
      operation: predicateType ? ('download-attestation' as const) : ('download-signature' as const)
    }
  }
}

function persistDownloadedReferrer(
  result: ReleaseResult<string>,
  name: string,
  path: string
): ReleaseResult<string> {
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: 'evidence_referrer_unavailable',
        message: `${name} registry referrer could not be retrieved: ${result.error.message}`
      }
    }
  }
  if (result.value.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: 'evidence_referrer_unavailable',
        message: `${name} registry referrer was empty after creation`
      }
    }
  }
  writeFileSync(path, result.value)
  return { ok: true, value: path }
}

function buildArguments(
  target: OciTarget,
  input: OciReleaseInput,
  localImage: string
): readonly string[] {
  return [
    'build',
    '--tag',
    localImage,
    '--build-arg',
    `BUN_BASE_IMAGE=${input.bunBaseImage}`,
    ...(target.kind === 'static-artifact'
      ? ['--build-arg', `STATIC_BASE_IMAGE=${input.staticBaseImage}`]
      : ['--build-arg', `SERVICE_ENTRY=${target.entrypoint}`]),
    '--file',
    target.containerfile,
    '.'
  ]
}

function provenanceStatement(
  input: OciReleaseInput,
  imageRepository: string,
  imageDigest: Digest
): string {
  return JSON.stringify(
    {
      _type: 'https://in-toto.io/Statement/v1',
      subject: [{ name: imageRepository, digest: { [imageDigest.algorithm]: imageDigest.value } }],
      predicateType: 'https://slsa.dev/provenance/v1',
      predicate: {
        buildDefinition: {
          buildType: 'https://meristem.dev/oci/podman-build/v1',
          externalParameters: { target: input.target, sourceCommit: input.sourceCommit }
        },
        runDetails: { builder: { id: 'meristem-oci-release' } }
      }
    },
    null,
    2
  )
}

function environmentInput(): unknown {
  return {
    target: process.env.OCI_TARGET,
    bunBaseImage: process.env.OCI_BUN_BASE_IMAGE,
    staticBaseImage: process.env.OCI_STATIC_BASE_IMAGE,
    imageRepository: process.env.OCI_RELEASE_IMAGE_REPOSITORY,
    sourceCommit: process.env.OCI_SOURCE_COMMIT ?? process.env.GITHUB_SHA,
    sourceEnvironment: process.env.OCI_SOURCE_ENVIRONMENT,
    targetEnvironment: process.env.OCI_TARGET_ENVIRONMENT,
    approvalActor: process.env.OCI_APPROVAL_ACTOR,
    rollbackDigest: process.env.OCI_ROLLBACK_DIGEST,
    signerIdentity: process.env.COSIGN_IDENTITY,
    signerIssuer: process.env.COSIGN_OIDC_ISSUER
  }
}

async function release(input: OciReleaseInput): Promise<ReleaseResult<string>> {
  const externalPreflight = validateOciBuildPreflight({
    bunBaseImage: input.bunBaseImage,
    staticBaseImage: input.staticBaseImage,
    requireExternalTools: true
  })
  if (!externalPreflight.ok) {
    return {
      ok: false,
      error: { code: 'release_environment_invalid', message: externalPreflight.error.message }
    }
  }

  const targetPlan = createOciBuildPlan([`--target=${input.target}`], input)
  if (!targetPlan.ok) {
    return {
      ok: false,
      error: { code: 'release_environment_invalid', message: targetPlan.error.message }
    }
  }

  const outputDir =
    process.env.OCI_RELEASE_OUTPUT_DIR ?? mkdtempSync(join(tmpdir(), 'meristem-oci-release-'))
  mkdirSync(outputDir, { recursive: true })
  const localImage = `localhost/meristem-${input.target}:${input.sourceCommit}`
  const remoteTag = `docker://${input.imageRepository}:${input.sourceCommit}`
  const digestPath = join(outputDir, 'image.digest')

  const build = runTool('podman', buildArguments(targetPlan.value.target, input, localImage))
  if (!build.ok) return build
  const push = runTool('podman', ['push', '--digestfile', digestPath, localImage, remoteTag])
  if (!push.ok) return push
  if (!existsSync(digestPath)) {
    return {
      ok: false,
      error: { code: 'release_execution_failed', message: 'Podman did not emit an image digest' }
    }
  }

  const imageDigest = parseDigest(readFileSync(digestPath, 'utf8').trim())
  if (!imageDigest) {
    return {
      ok: false,
      error: { code: 'release_execution_failed', message: 'Podman emitted an invalid image digest' }
    }
  }
  const imageReference = `${input.imageRepository}@${imageDigest.algorithm}:${imageDigest.value}`
  const sbomPath = join(outputDir, 'sbom.spdx.json')
  const provenancePath = join(outputDir, 'provenance.intoto.json')
  const sbomReferrerPath = join(outputDir, 'sbom.referrer.json')
  const provenanceReferrerPath = join(outputDir, 'provenance.referrer.json')
  const signatureReferrerPath = join(outputDir, 'signature.referrer.json')
  const promotionPath = join(outputDir, 'promotion.json')

  const sbom = runTool('syft', [imageReference, '--output', 'spdx-json'])
  if (!sbom.ok) return sbom
  writeFileSync(sbomPath, sbom.value)
  writeFileSync(provenancePath, provenanceStatement(input, input.imageRepository, imageDigest))

  const sbomAttestation = runTool('cosign', [
    'attest',
    '--yes',
    '--type',
    'spdxjson',
    '--predicate',
    sbomPath,
    imageReference
  ])
  if (!sbomAttestation.ok) return sbomAttestation
  const provenanceAttestation = runTool('cosign', [
    'attest',
    '--yes',
    '--type',
    'slsaprovenance',
    '--predicate',
    provenancePath,
    imageReference
  ])
  if (!provenanceAttestation.ok) return provenanceAttestation
  const signature = runTool('cosign', ['sign', '--yes', imageReference])
  if (!signature.ok) return signature

  const persistedSbom = persistDownloadedReferrer(
    runTool('cosign', ['download', 'attestation', '--predicate-type', 'spdxjson', imageReference]),
    'SPDX SBOM attestation',
    sbomReferrerPath
  )
  if (!persistedSbom.ok) return persistedSbom
  const persistedProvenance = persistDownloadedReferrer(
    runTool('cosign', [
      'download',
      'attestation',
      '--predicate-type',
      'slsaprovenance',
      imageReference
    ]),
    'SLSA provenance attestation',
    provenanceReferrerPath
  )
  if (!persistedProvenance.ok) return persistedProvenance
  const persistedSignature = persistDownloadedReferrer(
    runTool('cosign', ['download', 'signature', imageReference]),
    'Cosign signature',
    signatureReferrerPath
  )
  if (!persistedSignature.ok) return persistedSignature

  const verificationArguments = [
    '--certificate-identity',
    input.signerIdentity,
    '--certificate-oidc-issuer',
    input.signerIssuer
  ]
  const signatureVerification = runTool('cosign', [
    'verify',
    ...verificationArguments,
    imageReference
  ])
  if (!signatureVerification.ok) return signatureVerification
  const verifiedSbom = runTool('cosign', [
    'verify-attestation',
    '--type',
    'spdxjson',
    ...verificationArguments,
    imageReference
  ])
  if (!verifiedSbom.ok) return verifiedSbom
  const verifiedProvenance = runTool('cosign', [
    'verify-attestation',
    '--type',
    'slsaprovenance',
    ...verificationArguments,
    imageReference
  ])
  if (!verifiedProvenance.ok) return verifiedProvenance

  const rollbackDigest = parseDigest(input.rollbackDigest)
  if (!rollbackDigest) {
    return {
      ok: false,
      error: {
        code: 'release_execution_failed',
        message: 'validated rollback digest became invalid'
      }
    }
  }
  const promotion = {
    schemaVersion: 'mdeploy.promotion@0.1.0',
    promotionId: `promotion-${input.target}-${input.sourceCommit.slice(0, 12)}`,
    sourceEnvironment: input.sourceEnvironment,
    targetEnvironment: input.targetEnvironment,
    artifact: {
      schemaVersion: 'mdeploy.image-artifact@0.1.0',
      imageReference,
      digest: imageDigest,
      sbomRef: ociEvidenceRef(
        input.imageRepository,
        imageDigest,
        'attestation',
        'spdxjson',
        persistedSbom.value
      ),
      provenanceRef: ociEvidenceRef(
        input.imageRepository,
        imageDigest,
        'attestation',
        'slsaprovenance',
        persistedProvenance.value
      ),
      signatureRef: ociEvidenceRef(
        input.imageRepository,
        imageDigest,
        'signature',
        undefined,
        persistedSignature.value
      ),
      signer: {
        kind: 'cosign-keyless',
        identity: input.signerIdentity,
        issuer: input.signerIssuer
      },
      verifiedAt: new Date().toISOString()
    },
    approvalActor: input.approvalActor,
    rollbackPointer: {
      environment: input.targetEnvironment,
      digest: rollbackDigest,
      promotionId: `previous-${input.targetEnvironment}`
    },
    promotedAt: new Date().toISOString(),
    correlationId: `oci-release-${input.sourceCommit}`
  }
  const validatedPromotion = validatePromotionMetadata(promotion)
  if (!validatedPromotion.ok) {
    return {
      ok: false,
      error: { code: 'release_execution_failed', message: validatedPromotion.error.message }
    }
  }
  writeFileSync(promotionPath, JSON.stringify(validatedPromotion.value, null, 2))
  return { ok: true, value: promotionPath }
}

async function main(): Promise<void> {
  const input = validateOciReleaseInput(environmentInput())
  if (!input.ok) throw new Error(`${input.error.code}: ${input.error.message}`)
  const result = await release(input.value)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  console.log(JSON.stringify({ status: 'released', promotion: result.value }, null, 2))
}

if (import.meta.main) await main()
