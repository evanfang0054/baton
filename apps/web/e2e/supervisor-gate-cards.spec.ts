import { expect, test, type Page } from '@playwright/test'
import { acceptanceBundle, acceptanceSummary, mockWorkspace, sceneDetail, task } from './m6-helpers'

type WsRoute = Parameters<Parameters<Page['routeWebSocket']>[1]>[0]

async function evidenceShot(page: Page, name: string): Promise<void> {
  const dir = process.env.M8_EVIDENCE_DIR
  if (!dir) return
  await page.screenshot({ path: `${dir}/${name}` })
}

function wsRecorder(commands: Array<{ type?: string; payload?: unknown }>) {
  return (ws: WsRoute) => {
    ws.onMessage((raw) => {
      const command = JSON.parse(String(raw)) as { id?: string; type?: string; payload?: unknown }
      if (!command.id) return
      commands.push({ type: command.type, payload: command.payload })
      if (command.type === 'resume') return
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${command.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: { commandId: command.id, ok: true, data: {} },
        }),
      )
    })
  }
}

test('supervisor approval gate card sends approval.decide once', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', wsRecorder(commands))

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
  await evidenceShot(page, 'm8-gate-approval-desktop.png')

  await page.getByRole('button', { name: '允许' }).click()
  await expect
    .poll(() => commands.find((command) => command.type === 'approval.decide')?.payload)
    .toEqual({ approvalId: 'a1', decision: 'allow' })
  expect(commands.filter((command) => command.type === 'approval.decide')).toHaveLength(1)
})

test('supervisor review gate card requires override reason before approving', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', wsRecorder(commands))
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
