import { expect, test, type Page } from '@playwright/test'
import {
  acceptanceBundle,
  acceptanceSummary,
  mockWorkspace,
  sceneDetail,
  task,
  wsRecorder,
} from './m6-helpers'

async function evidenceShot(page: Page, name: string): Promise<void> {
  const dir = process.env.BATON_M8_EVIDENCE_DIR
  if (!dir) return
  await page.screenshot({ path: `${dir}/${name}` })
}

test('supervisor approval gate card sends approval.decide once', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', wsRecorder(commands, { compact: true, skipResumeAck: true }))

  const detail = sceneDetail()
  detail.task = {
    ...detail.task,
    title: '登录页修复',
    status: 'waiting_input',
    waitingReason: 'approval',
  }
  detail.attention = 'needs_approval'
  detail.review = null
  detail.acceptance = null
  detail.approvals = [
    {
      id: 'a1',
      sessionId: 's1',
      request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'high' },
      decision: null,
      decidedBy: null,
      decidedAt: null,
      response: null,
    },
  ]
  await mockWorkspace(page, {
    tasks: [
      task({
        id: 't1',
        title: '登录页修复',
        status: 'waiting_input',
        waitingReason: 'approval',
        attention: 'needs_approval',
      }),
    ],
    taskDetail: detail,
  })

  await page.goto('/?workspace=w1')
  await expect(page.getByText('待我处理 1')).toBeVisible()
  await expect(page.getByText('登录页修复')).toBeVisible()
  await expect(page.getByText('Bash')).toBeVisible()
  await expect(page.getByText('高风险', { exact: true })).toBeVisible()
  await expect(page.locator('[aria-label="总管对话"]').getByText('允许')).toHaveCount(0)
  await evidenceShot(page, 'm8-gate-approval-desktop.png')

  await page.getByRole('button', { name: '允许' }).click()
  await expect
    .poll(() => commands.find((command) => command.type === 'approval.decide')?.payload)
    .toEqual({ approvalId: 'a1', decision: 'allow' })
  expect(commands.filter((command) => command.type === 'approval.decide')).toHaveLength(1)
  await expect(page.getByRole('button', { name: '允许' })).toBeHidden()
})

test('supervisor approval gate card can deny and then disappears', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', wsRecorder(commands, { compact: true, skipResumeAck: true }))

  const detail = sceneDetail()
  detail.task = {
    ...detail.task,
    title: '登录页修复',
    status: 'waiting_input',
    waitingReason: 'approval',
  }
  detail.attention = 'needs_approval'
  detail.review = null
  detail.acceptance = null
  detail.approvals = [
    {
      id: 'a1',
      sessionId: 's1',
      request: { toolName: 'Bash', input: { command: 'rm -rf build' }, risk: 'high' },
      decision: null,
      decidedBy: null,
      decidedAt: null,
      response: null,
    },
  ]
  await mockWorkspace(page, {
    tasks: [
      task({
        id: 't1',
        title: '登录页修复',
        status: 'waiting_input',
        waitingReason: 'approval',
        attention: 'needs_approval',
      }),
    ],
    taskDetail: detail,
  })

  await page.goto('/?workspace=w1')
  await expect(page.getByText('待我处理 1')).toBeVisible()
  await page.getByRole('button', { name: '拒绝' }).click()
  await expect
    .poll(() => commands.find((command) => command.type === 'approval.decide')?.payload)
    .toEqual({ approvalId: 'a1', decision: 'deny' })
  await expect(page.getByRole('button', { name: '拒绝' })).toBeHidden()
})

test('supervisor review gate card requires override reason before approving', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', wsRecorder(commands, { compact: true, skipResumeAck: true }))
  await page.setViewportSize({ width: 390, height: 844 })

  const detail = sceneDetail()
  detail.task = { ...detail.task, title: '优惠券领取页', status: 'review', waitingReason: null }
  detail.attention = 'needs_review'
  detail.acceptance = acceptanceSummary()
  if (detail.review) {
    detail.review = { ...detail.review, verifyExitCode: 1 }
  }
  await mockWorkspace(page, {
    tasks: [
      task({
        id: 't1',
        title: '优惠券领取页',
        status: 'review',
        waitingReason: null,
        attention: 'needs_review',
      }),
    ],
    taskDetail: detail,
    acceptance: acceptanceBundle(),
  })

  await page.goto('/?workspace=w1')
  await page.getByRole('button', { name: '总管', exact: true }).click()
  await expect(page.getByText('待我处理 1')).toBeVisible()
  await expect(page.getByText(/退出码 1/)).toBeVisible()
  await expect(page.getByText(/AC \d+\/\d+/)).toBeVisible()
  await expect(page.getByText(/Git \d+ · \+\d+ -\d+/)).toBeVisible()

  await page.getByRole('button', { name: '通过' }).click()
  await expect(page.getByLabel('通过理由')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认通过' })).toBeDisabled()
  await page.getByLabel('通过理由').fill('已知风险')
  await evidenceShot(page, 'm8-gate-review-mobile.png')
  await page.getByRole('button', { name: '确认通过' }).click()

  await expect
    .poll(() => commands.find((command) => command.type === 'review.decide')?.payload)
    .toEqual({ reviewId: detail.review?.id, decision: 'approve', overrideReason: '已知风险' })
})
