import { afterAll, beforeAll } from 'bun:test'
import { captureOriginalFetch, restoreOriginalFetch } from './m-ui-bff.ts'

/**
 * 两个聚合测试文件分别恢复全局 fetch，避免测试结束后污染其他契约文件。
 */
export function installMUiBffFetchLifecycle(): void {
  beforeAll(async () => {
    captureOriginalFetch()
  })

  afterAll(() => {
    restoreOriginalFetch()
  })
}
