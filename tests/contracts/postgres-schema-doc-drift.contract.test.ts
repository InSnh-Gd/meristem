import { describe, expect, it } from 'bun:test'
import { getTableName } from 'drizzle-orm'
import * as schema from '../../packages/db/src/schema.ts'

const TABLE_HEADING_PATTERN = /^#{3,4}\s+`([a-z][a-z0-9_]*)`$/

/**
 * 提取 Drizzle schema 导出的 PostgreSQL 表名，作为文档漂移校验的权威集合。
 */
const extractSchemaTableNames = (): string[] => {
  const tableNames = new Set<string>()

  for (const value of Object.values(schema)) {
    if (typeof value !== 'object' || value === null) {
      continue
    }

    try {
      const tableName = getTableName(value as Parameters<typeof getTableName>[0])
      if (typeof tableName === 'string' && tableName.length > 0) {
        tableNames.add(tableName)
      }
    } catch {
      continue
    }
  }

  return [...tableNames].sort()
}

/**
 * 仅从表标题中读取文档声明的表名，避免把列名、约束名或示例值误判为表。
 * Approval appendix 暂不视为主 schema section，Phase 20 先用这个红线固定文档补齐基线。
 */
const extractDocumentedTableNames = (documentText: string): string[] => {
  const tableNames = new Set<string>()
  let insideApprovalAppendix = false

  for (const line of documentText.split('\n')) {
    if (line === '### Phase 12 Approval Tables') {
      insideApprovalAppendix = true
      continue
    }

    if (insideApprovalAppendix && line.startsWith('---')) {
      insideApprovalAppendix = false
      continue
    }

    if (insideApprovalAppendix) {
      continue
    }

    const match = line.match(TABLE_HEADING_PATTERN)
    const tableName = match?.[1]
    if (tableName) {
      tableNames.add(tableName)
    }
  }

  return [...tableNames].sort()
}

const buildDriftMessage = (missingFromDoc: string[], extraInDoc: string[]): string => {
  const formatSection = (title: string, tableNames: string[]) =>
    `${title}:\n${tableNames.map(tableName => `- ${tableName}`).join('\n')}`

  return [
    'PostgreSQL schema documentation drift detected.',
    formatSection('Missing from doc', missingFromDoc),
    formatSection('Extra in doc', extraInDoc)
  ].join('\n\n')
}

describe('PostgreSQL schema documentation drift contract', () => {
  it('keeps documented table headings aligned with the Drizzle schema', async () => {
    const documentText = await Bun.file('docs/data/POSTGRES-SCHEMA-MVP.md').text()
    const schemaTableNames = extractSchemaTableNames()
    const documentedTableNames = extractDocumentedTableNames(documentText)

    const missingFromDoc = schemaTableNames.filter(tableName => !documentedTableNames.includes(tableName))
    const extraInDoc = documentedTableNames.filter(tableName => !schemaTableNames.includes(tableName))

    expect(
      { missingFromDoc, extraInDoc },
      buildDriftMessage(missingFromDoc, extraInDoc)
    ).toEqual({ missingFromDoc: [], extraInDoc: [] })
  })
})
