import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { chromium, type Browser, type Page } from 'playwright'

const MUI_URL = 'http://localhost:5173'

let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
})

afterAll(async () => {
  await browser.close()
})

describe('Phase 9 Playwright functional demo', () => {
  describe('happy path: operator executes noop task and views policy summary', () => {
    it('navigates to M-UI and submits operator token', async () => {
      await page.goto(MUI_URL)

      const tokenInput = page.locator('[data-testid="token-input"]')
      await tokenInput.waitFor({ state: 'visible' })
      await tokenInput.fill('operator')

      const submitBtn = page.locator('[data-testid="token-submit"]')
      await submitBtn.click()

      // Wait for overview to load — a node chip should appear
      await page.waitForSelector('[data-testid^="node-chip-"]', { timeout: 10_000 })
    })

    it('selects a Leaf node and sees the command button enabled', async () => {
      // Click the first Leaf node chip
      const leafChip = page.locator('[data-testid^="node-chip-"]').first()
      await leafChip.click()

      const commandBtn = page.locator('[data-testid="command-btn"]')
      await commandBtn.waitFor({ state: 'visible', timeout: 5000 })
      expect(await commandBtn.isEnabled()).toBe(true)
    })

    it('confirms noop execution and sees task result', async () => {
      await page.locator('[data-testid="command-btn"]').click()
      await page.locator('[data-testid="command-confirm-btn"]').waitFor({ state: 'visible', timeout: 3000 })
      await page.locator('[data-testid="command-confirm-btn"]').click()

      await page.waitForSelector('[data-testid="task-result"]', { timeout: 10_000 })
      const taskResult = page.locator('[data-testid="task-result"]')
      expect(await taskResult.isVisible()).toBe(true)
      const text = await taskResult.textContent()
      expect(text).toContain('task.id')
    })

    it('clicks policyDecisionId to reveal policy summary', async () => {
      const policyLink = page.locator('.kv-link')
      await policyLink.waitFor({ state: 'visible', timeout: 3000 })
      await policyLink.click()

      const policySummary = page.locator('[data-testid="policy-summary"]')
      await policySummary.waitFor({ state: 'visible', timeout: 5000 })
      expect(await policySummary.isVisible()).toBe(true)
      const summaryText = await policySummary.textContent()
      expect(summaryText).toContain('策略决策摘要')
    })
  })

  describe('missing permission: viewer token shows disabled reason', () => {
    it('viewer token sees command-disabled-reason with task:assign', async () => {
      await page.goto(MUI_URL)

      const tokenInput = page.locator('[data-testid="token-input"]')
      await tokenInput.waitFor({ state: 'visible' })
      await tokenInput.fill('viewer')

      await page.locator('[data-testid="token-submit"]').click()
      await page.waitForSelector('[data-testid^="node-chip-"]', { timeout: 10_000 })

      // Click the first node
      await page.locator('[data-testid^="node-chip-"]').first().click()

      const disabledReason = page.locator('[data-testid="command-disabled-reason"]')
      await disabledReason.waitFor({ state: 'visible', timeout: 5000 })
      const reasonText = await disabledReason.textContent()
      expect(reasonText).toContain('task:assign')
    })
  })

  describe('token switch: security-admin sees audit section', () => {
    it('security-admin token reveals audit section', async () => {
      await page.goto(MUI_URL)

      const tokenInput = page.locator('[data-testid="token-input"]')
      await tokenInput.waitFor({ state: 'visible' })
      await tokenInput.fill('security-admin')

      await page.locator('[data-testid="token-submit"]').click()
      await page.waitForSelector('[data-testid^="node-chip-"]', { timeout: 10_000 })

      const auditSection = page.locator('[data-testid="audit-section"]')
      await auditSection.waitFor({ state: 'visible', timeout: 10_000 })
      expect(await auditSection.isVisible()).toBe(true)
    })
  })

  describe('mobile viewport smoke', () => {
    it('renders without horizontal overflow at iPhone SE size', async () => {
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto(MUI_URL)

      const tokenInput = page.locator('[data-testid="token-input"]')
      await tokenInput.waitFor({ state: 'visible' })
      expect(await tokenInput.isVisible()).toBe(true)

      await tokenInput.fill('viewer')
      await page.locator('[data-testid="token-submit"]').click()

      // Check that the page body does not have horizontal overflow
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1)
    })
  })
})
