import { expect, test } from '@playwright/test'

test('launches the configured Chromium runtime', async ({ browserName, page }) => {
  // 这个 smoke test 只验证 Playwright + Nix 浏览器运行时接线，
  // 不承担 M-UI 契约或现有 e2e 全链路责任。
  expect(browserName).toBe('chromium')

  await page.goto(
    'data:text/html,<title>Meristem Playwright smoke</title><main><h1>Meristem Playwright smoke</h1></main>'
  )

  await expect(page).toHaveTitle('Meristem Playwright smoke')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Meristem Playwright smoke')
})
