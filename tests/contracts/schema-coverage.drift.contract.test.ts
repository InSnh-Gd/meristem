import { describe, expect, it } from 'bun:test'
import { mExtensionEventContracts } from './_helpers/schema-coverage.m-extension.ts'
import { mPolicyEventContracts } from './_helpers/schema-coverage.m-policy.ts'
import { mTaskEventContracts } from './_helpers/schema-coverage.m-task.ts'
import { mnetEventContracts } from './_helpers/schema-coverage.mnet.ts'
import { sharedEventContracts } from './_helpers/schema-coverage.shared-domain.ts'
import {
  activePublisherSchemaContracts,
  eventCatalogUrl,
  extractCatalogSubjects,
  extractCoverageMapActiveSubjects,
  extractCoverageMapDeferredSubjects,
  getActivePublisherSubjects,
  schemaCoverageMapUrl,
  sorted
} from './_helpers/schema-coverage.ts'

const nonCatalogLogSubjects: readonly string[] = ['log.timeline.v0', 'log.full.v0']

function isCatalogTrackedSubject(subject: string): boolean {
  return !nonCatalogLogSubjects.some(nonCatalogSubject => nonCatalogSubject === subject)
}

const activeEventContractMap = new Map(
  [
    ...sharedEventContracts,
    ...mnetEventContracts,
    ...mTaskEventContracts,
    ...mPolicyEventContracts,
    ...mExtensionEventContracts,
    ...activePublisherSchemaContracts
  ].map(({ subject, schema }) => [subject, schema] as const)
)

describe('active event payload schemas', () => {
  it('maps every active publisher subject to a contract schema', async () => {
    const activePublisherSubjects = await getActivePublisherSubjects()
    const activeCatalogPublisherSubjects = sorted(
      Array.from(activePublisherSubjects).filter(isCatalogTrackedSubject)
    )

    expect(activeCatalogPublisherSubjects).toEqual(sorted(activeEventContractMap.keys()))
  })

  it('detects publish.post object-form subjects from real policy publishers', async () => {
    const activePublisherSubjects = await getActivePublisherSubjects()

    expect(activePublisherSubjects.has('policy.decision.created.v0')).toBe(true)
    expect(activePublisherSubjects.has('audit.entry.created.v0')).toBe(true)
  })
})

describe('schema coverage map drift guards', () => {
  it('keeps the documented active-event table aligned with real publishers', async () => {
    const [coverageMap, activePublisherSubjects] = await Promise.all([
      Bun.file(schemaCoverageMapUrl).text(),
      getActivePublisherSubjects()
    ])

    const activeCatalogPublisherSubjects = sorted(
      Array.from(activePublisherSubjects).filter(isCatalogTrackedSubject)
    )

    expect(sorted(extractCoverageMapActiveSubjects(coverageMap))).toEqual(
      activeCatalogPublisherSubjects
    )
  })

  it('marks every non-active catalog event as a post-v0.1 deferred contract', async () => {
    const [coverageMap, eventCatalog, activePublisherSubjects] = await Promise.all([
      Bun.file(schemaCoverageMapUrl).text(),
      Bun.file(eventCatalogUrl).text(),
      getActivePublisherSubjects()
    ])

    const deferredSubjects = extractCatalogSubjects(eventCatalog).filter(
      subject => !activePublisherSubjects.has(subject)
    )

    expect(coverageMap).toContain('## Non-active / deferred to post-v0.1 coverage')
    expect(sorted(extractCoverageMapDeferredSubjects(coverageMap))).toEqual(
      sorted(deferredSubjects)
    )
  })

  it('ignores non-catalog log subjects when checking deferred catalog drift', async () => {
    const [eventCatalog, activePublisherSubjects] = await Promise.all([
      Bun.file(eventCatalogUrl).text(),
      getActivePublisherSubjects()
    ])

    const catalogSubjects = extractCatalogSubjects(eventCatalog)

    const deferredSubjects = catalogSubjects.filter(
      subject => !activePublisherSubjects.has(subject)
    )

    for (const subject of nonCatalogLogSubjects) {
      expect(catalogSubjects).not.toContain(subject)
      expect(deferredSubjects).not.toContain(subject)
    }
  })
})
