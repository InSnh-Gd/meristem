import { describe, expect, it } from 'bun:test'
import { mExtensionEventContracts } from './_helpers/schema-coverage.m-extension.ts'
import { mnetEventContracts } from './_helpers/schema-coverage.mnet.ts'
import { mPolicyEventContracts } from './_helpers/schema-coverage.m-policy.ts'
import { mTaskEventContracts } from './_helpers/schema-coverage.m-task.ts'
import { sharedEventContracts } from './_helpers/schema-coverage.shared-domain.ts'
import {
  eventCatalogUrl,
  extractCatalogSubjects,
  extractCoverageMapActiveSubjects,
  extractCoverageMapDeferredSubjects,
  getActivePublisherSubjects,
  schemaCoverageMapUrl,
  sorted
} from './_helpers/schema-coverage.ts'

const activeEventContractMap = new Map(
  [
    ...sharedEventContracts,
    ...mnetEventContracts,
    ...mTaskEventContracts,
    ...mPolicyEventContracts,
    ...mExtensionEventContracts
  ].map(({ subject, schema }) => [subject, schema] as const)
)

describe('active event payload schemas', () => {
  it('maps every active publisher subject to a contract schema', async () => {
    const activePublisherSubjects = await getActivePublisherSubjects()
    expect(sorted(activePublisherSubjects)).toEqual(sorted(activeEventContractMap.keys()))
  })
})

describe('schema coverage map drift guards', () => {
  it('keeps the documented active-event table aligned with real publishers', async () => {
    const [coverageMap, activePublisherSubjects] = await Promise.all([
      Bun.file(schemaCoverageMapUrl).text(),
      getActivePublisherSubjects()
    ])

    expect(sorted(extractCoverageMapActiveSubjects(coverageMap))).toEqual(
      sorted(activePublisherSubjects)
    )
  })

  it('marks every non-active catalog event as a Phase 20 deferred contract', async () => {
    const [coverageMap, eventCatalog, activePublisherSubjects] = await Promise.all([
      Bun.file(schemaCoverageMapUrl).text(),
      Bun.file(eventCatalogUrl).text(),
      getActivePublisherSubjects()
    ])

    const deferredSubjects = extractCatalogSubjects(eventCatalog).filter(
      subject => !activePublisherSubjects.has(subject)
    )

    expect(coverageMap).toContain('## Non-active / deferred to Phase 20')
    expect(sorted(extractCoverageMapDeferredSubjects(coverageMap))).toEqual(
      sorted(deferredSubjects)
    )
  })
})
