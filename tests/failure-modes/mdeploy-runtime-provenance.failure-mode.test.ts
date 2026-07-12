import { describe, expect, it } from 'bun:test'
import {
  validateMDeployImageArtifactV01,
  validateMDeployRuntimeDriverSelectionV01
} from '../../packages/contracts/src/index.ts'

const digest = {
  algorithm: 'sha256',
  value: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
} as const

const storageRef = (name: string) => ({
  uri: `oci://registry.example/meristem/metadata/${name}`,
  digest,
  redactionStatus: 'metadata_only' as const
})

function imageArtifact() {
  return {
    schemaVersion: 'mdeploy.image-artifact@0.1.0',
    imageReference: `registry.example/meristem/core@sha256:${digest.value}`,
    digest,
    sbomRef: storageRef('core.sbom.spdx.json'),
    provenanceRef: storageRef('core.intoto.jsonl'),
    signatureRef: storageRef('core.sigstore.json'),
    signer: {
      kind: 'cosign-keyless',
      identity: 'release@meristem.example',
      issuer: 'https://token.actions.githubusercontent.com'
    },
    verifiedAt: '2026-07-13T00:01:00.000Z'
  }
}

describe('M-Deploy runtime and provenance failure modes', () => {
  it('rejects tag-only and otherwise mutable production image references', () => {
    for (const imageReference of [
      'registry.example/meristem/core:production',
      'registry.example/meristem/core:latest',
      `registry.example/meristem/core:production@sha256:${digest.value}`
    ]) {
      const result = validateMDeployImageArtifactV01({
        ...imageArtifact(),
        imageReference
      })

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected mutable image reference rejection')
      expect(result.error.code).toBe('mutable_image_reference')
    }
  })

  it('rejects image metadata without complete provenance', () => {
    for (const field of ['sbomRef', 'provenanceRef', 'signatureRef', 'signer'] as const) {
      const incomplete = { ...imageArtifact() }
      Reflect.deleteProperty(incomplete, field)
      const result = validateMDeployImageArtifactV01(incomplete)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected missing provenance rejection')
      expect(result.error.code).toBe('missing_provenance')
    }
  })

  it('rejects an immutable reference whose digest does not match metadata', () => {
    const result = validateMDeployImageArtifactV01({
      ...imageArtifact(),
      imageReference:
        'registry.example/meristem/core@sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected digest mismatch rejection')
    expect(result.error.code).toBe('image_digest_mismatch')
  })

  it('rejects Docker as a production runtime configuration', () => {
    const result = validateMDeployRuntimeDriverSelectionV01({
      schemaVersion: 'mdeploy.runtime-driver-selection@0.1.0',
      runtimeClass: 'production',
      runtimeDriver: 'docker',
      unitManager: 'docker-compose',
      iacDriver: 'opentofu',
      selectedAt: '2026-07-13T00:00:00.000Z',
      selectedBy: 'm-deploy-controller'
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected production Docker rejection')
    expect(result.error.code).toBe('runtime_configuration_invalid')
  })

  it('rejects Podman configured with Docker Compose compatibility semantics', () => {
    const result = validateMDeployRuntimeDriverSelectionV01({
      schemaVersion: 'mdeploy.runtime-driver-selection@0.1.0',
      runtimeClass: 'compatibility',
      runtimeDriver: 'podman',
      unitManager: 'docker-compose',
      iacDriver: 'disabled',
      selectedAt: '2026-07-13T00:00:00.000Z',
      selectedBy: 'compatibility-harness'
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected invalid Podman compatibility configuration')
    expect(result.error.code).toBe('runtime_configuration_invalid')
  })
})
