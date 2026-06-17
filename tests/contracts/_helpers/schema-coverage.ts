import { expect } from 'bun:test'
import * as Schema from 'effect/Schema'
import * as Contracts from '../../../packages/contracts/src/index.ts'

export { Contracts, Schema }

export type EventContract = {
  subject: string
  schema: Schema.Schema.AnyNoContext
  fixture: unknown
}

export type ResponseContract = {
  route: string
  schema: Schema.Schema.AnyNoContext
  fixture: unknown
}

export type EventSchemaContract = EventContract & {
  schema: Schema.Schema.AnyNoContext
}

export const schemaCoverageMapUrl = new URL('../schema-coverage.md', import.meta.url)
export const eventCatalogUrl = new URL('../../../docs/events/EVENT-CATALOG.md', import.meta.url)
export const deferredGapMapUrl = new URL(
  '../../../docs/events/DEFERRED-EVENT-GAP-MAP.md',
  import.meta.url
)

const literalPublishSubjectPattern = /publish\(\s*['"`]([^'"`]+\.v\d+)['"`]/g
const taskLifecyclePublishSubjectPattern = /publishTaskEvent\(\s*deps,\s*['"`]([^'"`]+\.v\d+)['"`]/g
// Object-form internal event-bus publishers use `.publish.post({ subject: 'x.v0', event })`.
// This scanner only extracts literal subjects from the call site; it does not resolve
// computed variables, helper wrappers, or other dynamic subject construction.
const objectFormPublishSubjectPattern = /publish\.post\(\{\s*subject:\s*['"`]([^'"`]+\.v\d+)['"`]/g
// Extracted workflow helpers may carry literal subjects in named options instead of direct publish args.
const workflowSubjectOptionPattern = /requestedSubject:\s*['"`]([^'"`]+\.v\d+)['"`]/g
const extensionSubjectReferencePattern = /mExtensionEventSubjects\.(\w+)/g

const policyApprovalDynamicSubjects = [
  'policy.approval.created.v0',
  'policy.approval.approved.v0',
  'policy.approval.rejected.v0',
  'policy.approval.expired.v0',
  'policy.approval.vote.approved.v0',
  'policy.approval.vote.rejected.v0'
] as const

export function assertRoundTrip(schema: Schema.Schema.AnyNoContext, value: unknown) {
  const decoded = Schema.decodeUnknownSync(schema)(value)
  const encoded = Schema.encodeSync(schema)(decoded)
  expect(Schema.decodeUnknownSync(schema)(encoded)).toEqual(decoded)
}

export function sorted(values: Iterable<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right))
}

function definedMatchGroup(match: RegExpMatchArray, index = 1): string {
  const value = match[index]
  if (typeof value !== 'string') throw new Error(`expected regex group ${index} to be present`)
  return value
}

export function extractCoverageMapActiveSubjects(markdown: string): string[] {
  const start = markdown.indexOf('### Active emitted events')
  const end = markdown.indexOf('### Active REST responses')
  const section = markdown.slice(start, end)
  const subjects: string[] = []
  for (const match of section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm))
    subjects.push(definedMatchGroup(match))
  return subjects
}

export function extractCoverageMapDeferredSubjects(markdown: string): string[] {
  const start = markdown.indexOf('## Non-active / deferred to post-v0.1 coverage')
  const end = markdown.indexOf('## Explicit exclusions from this wave')
  const section = markdown.slice(start, end)
  const subjects: string[] = []
  for (const match of section.matchAll(/- `([^`]+)`/g)) subjects.push(definedMatchGroup(match))
  return subjects
}

export function extractDeferredGapMapSubjects(markdown: string): string[] {
  const start = markdown.indexOf('## Deferred event gap map')
  const section = markdown.slice(start)
  const subjects: string[] = []
  for (const match of section.matchAll(/^\|\s*`([^`]+\.v\d+)`\s*\|/gm))
    subjects.push(definedMatchGroup(match))
  return subjects
}

export function extractCatalogSubjects(markdown: string): string[] {
  const start = markdown.indexOf('## 3. Initial Catalog')
  const end = markdown.indexOf('MVP sync HTTP/Eden boundaries:')
  const section = markdown.slice(start, end)
  const subjects: string[] = []
  for (const match of section.matchAll(/\|\s*`([^`]+\.v\d+)`\s*\|/g))
    subjects.push(definedMatchGroup(match))
  return subjects
}

let activePublisherSubjectsPromise: Promise<Set<string>> | undefined

export async function getActivePublisherSubjects(): Promise<Set<string>> {
  if (activePublisherSubjectsPromise) return activePublisherSubjectsPromise

  activePublisherSubjectsPromise = (async () => {
    const subjects = new Set<string>()
    const publisherSourceGlobs = ['apps/core/src/**/*.ts', 'services/*/src/**/*.ts'] as const

    for (const pattern of publisherSourceGlobs) {
      const glob = new Bun.Glob(pattern)
      for await (const relativePath of glob.scan({
        cwd: process.cwd(),
        absolute: false,
        onlyFiles: true
      })) {
        if (typeof relativePath !== 'string') continue
        const source = await Bun.file(relativePath).text()

        for (const match of source.matchAll(literalPublishSubjectPattern)) {
          subjects.add(definedMatchGroup(match))
        }

        for (const match of source.matchAll(taskLifecyclePublishSubjectPattern)) {
          subjects.add(definedMatchGroup(match))
        }

        for (const match of source.matchAll(objectFormPublishSubjectPattern)) {
          subjects.add(definedMatchGroup(match))
        }

        for (const match of source.matchAll(workflowSubjectOptionPattern)) {
          subjects.add(definedMatchGroup(match))
        }

        if (relativePath.startsWith('services/m-extension/src/')) {
          for (const match of source.matchAll(extensionSubjectReferencePattern)) {
            const key = match[1] as keyof typeof Contracts.mExtensionEventSubjects
            const subject = Contracts.mExtensionEventSubjects[key]
            if (subject) subjects.add(subject)
          }
        }
      }
    }

    for (const subject of policyApprovalDynamicSubjects) subjects.add(subject)
    return subjects
  })()

  return activePublisherSubjectsPromise
}

export const activePublisherSchemaContracts: EventSchemaContract[] = [
  {
    subject: 'policy.decision.created.v0',
    schema: Contracts.PolicyDecisionCreatedPayloadSchema,
    fixture: {
      decisionId: 'pd-1',
      actor: 'operator',
      action: 'core:read',
      resource: 'core',
      result: 'allow',
      reasons: []
    }
  },
  {
    subject: 'audit.entry.created.v0',
    schema: Contracts.AuditEntryCreatedPayloadSchema,
    fixture: {
      auditId: 'audit-1',
      actor: 'operator',
      action: 'core:read',
      resource: 'core',
      decisionId: 'pd-1'
    }
  },
  {
    subject: 'policy.approval.vote.approved.v0',
    schema: Contracts.PolicyApprovalVoteEventPayloadSchema,
    fixture: {
      approvalId: 'approval-vote-approved',
      actor: 'security-admin',
      vote: 'approve',
      reason: 'looks safe',
      timestamp: '2026-06-04T10:30:00.000Z'
    }
  },
  {
    subject: 'policy.approval.vote.rejected.v0',
    schema: Contracts.PolicyApprovalVoteEventPayloadSchema,
    fixture: {
      approvalId: 'approval-vote-rejected',
      actor: 'admin',
      vote: 'reject',
      timestamp: '2026-06-04T10:45:00.000Z'
    }
  }
]
