import { expect, test } from '@playwright/test'
import {
  acceptanceBundle,
  acceptanceSummary,
  agentNode,
  mockWorkspace,
  sceneDetail,
  task,
} from './m6-helpers'

test('needs me filter, stale and review card', async ({ page }) => {
  const commands: Array<{ type?: string }> = []
  const passSummary = acceptanceSummary({
    counts: { total: 1, pass: 1, fail: 0, pending: 0, waived: 0 },
    verdict: 'pass',
    topFailures: [],
  })
  const state = await mockWorkspace(page, {
    nodes: [agentNode('a1', 80, 80)],
    tasks: [
      task({
        id: 't1',
        nodeId: 'a1',
        title: '待验收任务',
        acceptance: passSummary,
      }),
      task({
        id: 't2',
        nodeId: null,
        title: '运行中',
        status: 'running',
        attention: 'none',
        waitingSince: null,
      }),
    ],
    taskDetail: sceneDetail(),
    reviewDetail: { preliminaryVerdict: 'pass', preliminaryReason: 'VERDICT: PASS' },
    acceptance: acceptanceBundle({ acceptance: passSummary }),
  })

  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string }
      if (!message.id) return
      commands.push({ type: message.type })
      if (message.type === 'review.decide') {
        state.tasks = state.tasks.map((item) =>
          item.id === 't1' ? { ...item, status: 'done', attention: 'none' } : item,
        )
        state.taskDetail = {
          ...state.taskDetail,
          task: { ...state.taskDetail.task, status: 'done' },
          attention: 'none',
          review: state.taskDetail.review
            ? { ...state.taskDetail.review, verdict: 'approved', decidedAt: 4 }
            : null,
        }
      }
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
  })

  await page.goto('/?workspace=w1')
  await page.getByRole('button', { name: '任务', exact: true }).click()

  const board = page.getByTestId('task-board')
  await board.getByRole('button', { name: '需要我' }).click()
  await expect(board.getByText('待验收任务')).toBeVisible()
  await expect(board.getByText('运行中')).toHaveCount(0)
  await expect(board.getByText(/超过 30 分钟/)).toBeVisible()

  await board.getByText('待验收任务').click()
  await expect(page.getByText('初步验收：PASS')).toBeVisible()
  await expect(page.getByRole('button', { name: '通过' })).toBeVisible()
  await page.getByRole('button', { name: '通过' }).click()

  await expect.poll(() => commands.some((command) => command.type === 'review.decide')).toBe(true)
  await page.getByRole('button', { name: '任务', exact: true }).click()
  await expect(page.getByTestId('task-board').getByText('待验收任务')).toHaveCount(0)
})
