import { join } from 'node:path'
import { expect, type Page, test as playwrightTest } from '@playwright/test'

// Playwright exposes test.skip; retain the repository's skipIf convention for unavailable live stacks.
const test = Object.assign(playwrightTest, { skipIf: playwrightTest.skip })

const baseUrl = process.env.MERISTEM_MUI_OPERATOR_JOURNEYS_URL
const fixtureUrls = {
  pendingApproval: process.env.MERISTEM_MUI_PENDING_APPROVAL_URL,
  securityAdmin: process.env.MERISTEM_MUI_SECURITY_ADMIN_URL,
  approvedOperator: process.env.MERISTEM_MUI_APPROVED_OPERATOR_URL,
  mnet: process.env.MERISTEM_MUI_MNET_JOURNEY_URL,
  mdeploy: process.env.MERISTEM_MUI_MDEPLOY_JOURNEY_URL,
  audit: process.env.MERISTEM_MUI_AUDIT_JOURNEY_URL
}

function loginUrl() {
  return baseUrl ? new URL('/login', baseUrl).toString() : undefined
}

async function openJourney(page: Page, url: string | undefined, name: string) {
  test.skipIf(!url, `${name} requires a configured production M-UI fixture URL`)
  if (!url) return false

  const response = await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null)
  test.skipIf(!response?.ok(), `${name} skipped because the configured M-UI app is not running`)
  return response?.ok() ?? false
}

async function captureEvidence(page: Page, scenario: string) {
  await page.screenshot({
    path: join(import.meta.dir, '..', 'evidence', `m-ui-operator-journeys-${scenario}.png`),
    fullPage: true
  })
}

test('OIDC login renders the browser session entry point without token paste', async ({ page }) => {
  if (!(await openJourney(page, loginUrl(), 'OIDC login'))) return

  await expect(page.getByRole('heading', { name: '通过组织账号进入控制室' })).toBeVisible()
  await expect(page.getByTestId('oidc-login-link')).toHaveAttribute(
    'href',
    /\/api\/v0\/auth\/oidc\/login\?returnTo=%2Fcontrol-room$/
  )
  await expect(page.getByTestId('token-input')).toHaveCount(0)
  await expect(page.getByText('此浏览器不会接收或保存 OIDC token。')).toBeVisible()
  await captureEvidence(page, 'oidc-login')
})

test('pending OIDC principal waits for security-admin approval outside the workbench', async ({
  page
}) => {
  if (!(await openJourney(page, fixtureUrls.pendingApproval, 'pending-principal approval'))) return

  await expect(page.getByRole('heading', { name: /等待.*批准/ })).toBeVisible()
  await expect(page.getByText(/security-admin|安全管理员/)).toBeVisible()
  await expect(page.getByText(/OIDC|组织账号/)).toBeVisible()
  await expect(page.getByTestId('m-ui-top-app-bar')).toHaveCount(0)
  await expect(page.getByTestId('token-input')).toHaveCount(0)
  await captureEvidence(page, 'pending-approval')
})

test('security-admin approves a pending principal and exposes the approval audit trail', async ({
  page
}) => {
  if (!(await openJourney(page, fixtureUrls.securityAdmin, 'security-admin approval'))) return

  await expect(page.getByRole('heading', { name: /身份审批|待审批身份/ })).toBeVisible()
  await expect(page.getByText(/待批准/)).toBeVisible()
  await expect(page.getByRole('button', { name: /批准/ })).toBeVisible()
  await expect(page.getByText(/M-Policy|策略决策/)).toBeVisible()
  await expect(page.getByText(/Audit|审计/)).toBeVisible()
  await expect(page.getByText(/correlationId/)).toBeVisible()
  await captureEvidence(page, 'security-admin-approval')
})

test('approved operator sees permitted workbench routes and can end the local session', async ({
  page
}) => {
  if (!(await openJourney(page, fixtureUrls.approvedOperator, 'approved-operator session'))) return

  await expect(page.getByTestId('m-ui-top-app-bar')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await expect(page.getByRole('link', { name: /控制室/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /会话.*资料|个人资料/ })).toBeVisible()
  await page.getByRole('button', { name: /会话.*资料|个人资料/ }).click()
  await expect(page.getByText(/sessionId|会话 ID/)).toBeVisible()
  await expect(page.getByRole('button', { name: /退出登录/ })).toBeVisible()
  await captureEvidence(page, 'approved-session-profile')
})

test('M-Net shows topology, join approval, forced relay, and break-glass policy boundaries', async ({
  page
}) => {
  const mnetUrl = fixtureUrls.mnet
  if (!(await openJourney(page, mnetUrl, 'M-Net operator journey'))) return
  if (!mnetUrl) return

  await expect(page.getByRole('heading', { name: /M-Net.*拓扑|网络详情/ })).toBeVisible()
  await expect(page.getByText(/加入请求|Join Tickets/)).toBeVisible()
  await expect(page.getByRole('button', { name: /批准加入请求/ })).toBeVisible()
  await expect(page.getByText(/强制 Relay|forced relay/)).toBeVisible()
  await expect(page.getByText(/策略决策|M-Policy/)).toBeVisible()
  await expect(page.getByText(/Audit|审计/)).toBeVisible()

  await page.goto(new URL('/mnet/break-glass', mnetUrl).toString(), {
    waitUntil: 'domcontentloaded'
  })
  await page.getByLabel('网络 ID').fill('production-network')
  await page.getByLabel('操作确认指令').fill('break-glass-confirmed')
  await page.getByRole('button', { name: '验证紧急操作资格' }).click()
  await expect(page.getByTestId('command-well')).toContainText(/policy|required/)
  await expect(page.getByTestId('command-well')).toContainText(/audit|required/)
  await expect(page.getByText(/30.*分钟|TTL/)).toBeVisible()
  await captureEvidence(page, 'mnet-join-relay-break-glass')
})

test('M-Deploy shows topology, rollout and rollback confirmation, drift, and evidence linkage', async ({
  page
}) => {
  if (!(await openJourney(page, fixtureUrls.mdeploy, 'M-Deploy operator journey'))) return

  await expect(
    page.getByRole('heading', { name: /M-Deploy.*基础设施拓扑|节点、运行时与故障域/ })
  ).toBeVisible()
  await expect(page.getByText(/漂移|drift/)).toBeVisible()
  await expect(page.getByRole('heading', { name: '部署与回滚' })).toBeVisible()

  await page.getByLabel('proposalId').fill('proposal-production-rollout')
  await page.getByLabel('agentId').fill('agent-control-1')
  await page.getByRole('button', { name: '触发部署' }).click()
  await expect(page.getByRole('alert')).toContainText(/M-Policy.*Audit/)
  await expect(page.getByRole('button', { name: '确认提交' })).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()

  await page.getByLabel(/回滚 SHA-256 digest/).fill('a'.repeat(64))
  await page.getByRole('button', { name: '请求回滚' }).click()
  await expect(page.getByRole('alert')).toContainText(/请求回滚.*M-Policy.*Audit/)
  await page.getByRole('button', { name: '取消' }).click()

  await expect(page.getByText(/auditId/)).toBeVisible()
  await expect(page.getByText(/correlationId/)).toBeVisible()
  await captureEvidence(page, 'mdeploy-rollout-rollback-drift')
})

test('high-risk controls display impact, policy, and audit requirements before execution', async ({
  page
}) => {
  if (!(await openJourney(page, fixtureUrls.approvedOperator, 'high-risk CommandWell'))) return

  const commandWell = page.getByTestId('command-well')
  await expect(commandWell).toBeVisible()
  await expect(commandWell).toContainText(/requires/)
  await expect(commandWell).toContainText(/policy.*required/)
  await expect(commandWell).toContainText(/audit.*required/)
  await expect(commandWell).toContainText(/target|目标/)
  await expect(commandWell.getByTestId('command-confirm-btn')).toHaveCount(0)
  await captureEvidence(page, 'high-risk-command-preview')
})

test('audit and degraded states name their source and correlation details instead of relying on color', async ({
  page
}) => {
  if (!(await openJourney(page, fixtureUrls.audit, 'audit and degraded-state visibility'))) return

  await expect(page.getByRole('heading', { name: /审计|高可信审计账本/ })).toBeVisible()
  await expect(page.getByText(/来源|source/)).toBeVisible()
  await expect(page.getByText(/sourceId|来源 ID/)).toBeVisible()
  await expect(page.getByText(/correlationId/)).toBeVisible()
  await expect(page.getByText(/degraded|降级/)).toBeVisible()
  await expect(page.getByText(/原因|reason/)).toBeVisible()
  await captureEvidence(page, 'audit-degraded-traceability')
})
