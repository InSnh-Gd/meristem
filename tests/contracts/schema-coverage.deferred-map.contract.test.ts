import { describe, expect, it } from 'bun:test'
import {
  deferredGapMapUrl,
  extractCoverageMapActiveSubjects,
  extractCoverageMapDeferredSubjects,
  extractDeferredGapMapSubjects,
  getActivePublisherSubjects,
  schemaCoverageMapUrl,
  sorted
} from './_helpers/schema-coverage.ts'

// 一致性测试：gap map 必须与 schema-coverage.md 中的 deferred 列表完全一致，
// 且不能包含任何 active subject（无论是文档中声明的 active 还是源码扫描到的 active publisher）。
describe('deferred event gap map consistency', () => {
  it('covers every deferred subject and excludes every active subject', async () => {
    const [coverageMap, gapMap, activePublisherSubjects] = await Promise.all([
      Bun.file(schemaCoverageMapUrl).text(),
      Bun.file(deferredGapMapUrl).text(),
      getActivePublisherSubjects()
    ])

    const documentedDeferredSubjects = sorted(extractCoverageMapDeferredSubjects(coverageMap))
    const documentedActiveSubjects = extractCoverageMapActiveSubjects(coverageMap)
    const gapMapSubjects = sorted(extractDeferredGapMapSubjects(gapMap))

    // gap map 中的 subject 集合必须等于 schema-coverage.md 中的 deferred 集合
    expect(gapMapSubjects).toEqual(documentedDeferredSubjects)

    // active subject 不能出现在 gap map 中
    const activeSubjects = new Set([...documentedActiveSubjects, ...activePublisherSubjects])
    for (const subject of activeSubjects) {
      expect(gapMapSubjects).not.toContain(subject)
    }
  })
})
