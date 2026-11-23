import { expect, test, type Page } from '@playwright/test'
import {
  acceptanceBundle,
  acceptanceSummary,
  agentNode,
  mockWorkspace,
  sceneDetail,
  task,
} from './m6-helpers'

type WsRoute = Parameters<Parameters<Page['routeWebSocket']>[1]>[0]

function wsRecorder(commands: Array<{ type?: string; payload?: unknown }>) {
  return (ws: WsRoute) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string; payload?: unknown }
      if (!message.id) return
      commands.push(message)
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${message.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: { commandId: message.id, ok: true, data: {} },
        }),
      )
    })
  }
}

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

  await page.goto('/?workspace=w1')
  await expect(page.getByText('AC 2/3')).toBeVisible()
  await page.getByRole('button', { name: '查看证据' }).click()
  await expect(page.getByRole('heading', { name: '验收清单' })).toBeVisible()
  await page.getByRole('button', { name: '通过' }).click()
  await expect(page.getByText('仍有验收项未通过，仍要通过吗？')).toBeVisible()
  await page.getByLabel('通过理由').fill('已知风险')
  await page.getByRole('button', { name: '确认通过' }).click()

  await expect
    .poll(() => commands.find((command) => command.type === 'review.decide')?.payload)
    .toMatchObject({ decision: 'approve', overrideReason: '已知风险' })
})
