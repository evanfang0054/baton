import { expect, test } from '@playwright/test'
import {
  acceptanceBundle,
  acceptanceSummary,
  agentNode,
  mockWorkspace,
  sceneDetail,
  task,
  wsRecorder,
} from './m6-helpers'

test('review card opens evidence and AC override sends reason', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', wsRecorder(commands))

  const acceptance = acceptanceBundle()
  const summary = acceptanceSummary()
  const reviewTask = task({
    id: 't1',
    nodeId: 'a1',
    title: '待验收任务',
    status: 'review',
    attention: 'needs_review',
    acceptance: summary,
  })
  await mockWorkspace(page, {
    nodes: [agentNode('a1', 420, 80)],
    tasks: [reviewTask],
    taskDetail: sceneDetail(),
    acceptance,
  })

  await page.goto('/?workspace=w1&delivery=d1')
  await expect(
    page.getByRole('button', { name: '打开任务 待验收任务' }).getByText('AC 2/3'),
  ).toBeVisible()
  await page.getByRole('button', { name: '查看证据' }).click()
  await expect(page.getByRole('heading', { name: '验收清单' })).toBeVisible()
  await page.getByTestId('task-detail').getByRole('button', { name: '通过' }).click()
  await expect(page.getByText('仍有验收项未通过，仍要通过吗？')).toBeVisible()
  await page.getByLabel('通过理由').fill('已知风险')
  await page.getByTestId('task-detail').getByRole('button', { name: '确认通过' }).click()

  await expect
    .poll(() => commands.find((command) => command.type === 'review.decide')?.payload)
    .toMatchObject({ decision: 'approve', overrideReason: '已知风险' })
})
