import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createOciBuildPlan,
  type OciTarget,
  validateOciBuildPreflight,
  validatePromotionMetadata
} from './oci-pipeline.ts'
import {
  type Digest,
  type OciReleaseInput,
  ociReleaseValidation,
  type ReleaseFailure,
  type ReleaseResult
} from './oci-release-validation.ts'

const { parseDigest } = ociReleaseValidation

function toolFailure(tool: string, exitCode: number, stderr: Uint8Array): ReleaseFailure {
  const output = new TextDecoder().decode(stderr).trim()
  return {
    code: 'release_execution_failed',
    message: `${tool} failed with exit ${exitCode}: ${output || 'no stderr output'}`
  }
}

function runTool(tool: string, args: readonly string[]): ReleaseResult<string> {
  const process = Bun.spawnSync({ cmd: [tool, ...args], stdout: 'pipe', stderr: 'pipe' })
  return process.exitCode !== 0
    ? { ok: false, error: toolFailure(tool, process.exitCode, process.stderr) }
    : { ok: true, value: new TextDecoder().decode(process.stdout) }
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

/** 执行 Podman 构建、推送、Cosign 证据生成与 promotion 元数据校验。 */
export async function release(input: OciReleaseInput): Promise<ReleaseResult<string>> {
  const externalPreflight = validateOciBuildPreflight({
    bunBaseImage: input.bunBaseImage,
    staticBaseImage: input.staticBaseImage,
    requireExternalTools: true
  })
  if (!externalPreflight.ok)
    return {
      ok: false,
      error: { code: 'release_environment_invalid', message: externalPreflight.error.message }
    }
  const targetPlan = createOciBuildPlan([`--target=${input.target}`], input)
  if (!targetPlan.ok)
    return {
      ok: false,
      error: { code: 'release_environment_invalid', message: targetPlan.error.message }
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
  if (!existsSync(digestPath))
    return {
      ok: false,
      error: { code: 'release_execution_failed', message: 'Podman did not emit an image digest' }
    }

  const imageDigest = parseDigest(readFileSync(digestPath, 'utf8').trim())
  if (!imageDigest)
    return {
      ok: false,
      error: { code: 'release_execution_failed', message: 'Podman emitted an invalid image digest' }
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
  if (!rollbackDigest)
    return {
      ok: false,
      error: {
        code: 'release_execution_failed',
        message: 'validated rollback digest became invalid'
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
  if (!validatedPromotion.ok)
    return {
      ok: false,
      error: { code: 'release_execution_failed', message: validatedPromotion.error.message }
    }
  writeFileSync(promotionPath, JSON.stringify(validatedPromotion.value, null, 2))
  return { ok: true, value: promotionPath }
}
