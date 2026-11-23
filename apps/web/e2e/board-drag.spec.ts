import { expect, test, type Locator, type Page } from '@playwright/test'
import { acceptanceSummary, mockWorkspace, reviewView, sceneDetail, task } from './m6-helpers'

async function dragAfterLongPress(page: Page, card: Locator, column: Locator) {
  const cardBox = await card.boundingBox()
  const columnBox = await column.boundingBox()
  if (!cardBox || !columnBox) throw new Error('drag source or target is not visible')
  await page.mouse.move(cardBox.x + 24, cardBox.y + 16)
  await page.mouse.down()
  await page.waitForTimeout(380)
  await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + 40, { steps: 10 })
  await page.mouse.up()
}

test('long press drags tasks into valid status columns', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const commands: Array<{ type?: string; payload?: { taskId?: string } }> = []
  const pass = acceptanceSummary({
    counts: { total: 1, pass: 1, fail: 0, pending: 0, waived: 0 },
    verdict: 'pass',
    topFailures: [],
  })
  const detail = sceneDetail()
  const reviewDetail = {
    ...detail,
    task: { ...detail.task, id: 't3', title: '待验收任务', status: 'review' as const },
    attention: 'needs_review' as const,
    review: reviewView({ id: 'r3', taskId: 't3', verifyExitCode: 0, verdict: null }),
    acceptance: pass,
  }

  await mockWorkspace(page, {
    tasks: [
      task({
        id: 't1',
        nodeId: null,
        title: '待办任务',
        status: 'todo',
        attention: 'none',
        waitingSince: null,
      }),
      task({
        id: 't2',
        nodeId: null,
        title: '运行任务',
        status: 'running',
        attention: 'none',
        waitingSince: null,
      }),
      task({
        id: 't3',
        nodeId: null,
        title: '待验收任务',
        status: 'review',
        acceptance: pass,
      }),
    ],
  })
  // mockWorkspace 只为 t1 固定了详情；验收拖拽需要当前待验收任务的 review id。
  await page.route('**/api/tasks/t3', (route) => route.fulfill({ json: reviewDetail }))

  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string; payload?: unknown }
      if (!message.id) return
      commands.push({
        ...(message.type ? { type: message.type } : {}),
        ...(message.payload ? { payload: message.payload as { taskId?: string } } : {}),
      })
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
  const board = page.getByTestId('task-board-overlay')

  await dragAfterLongPress(
    page,
    board.getByTestId('task-card-t1'),
    board.locator('[data-column="running"]'),
  )
  await expect
    .poll(() => commands.filter((command) => command.type === 'task.enqueue').length)
    .toBe(1)
  expect(commands.find((command) => command.type === 'task.enqueue')?.payload?.taskId).toBe('t1')

  await dragAfterLongPress(
    page,
    board.getByTestId('task-card-t2'),
    board.locator('[data-column="closed"]'),
  )
  await expect(page.getByRole('heading', { name: '取消任务？' })).toBeVisible()
  await page.getByRole('button', { name: '确认取消' }).click()
  await expect
    .poll(() => commands.filter((command) => command.type === 'task.cancel').length)
    .toBe(1)
  expect(commands.find((command) => command.type === 'task.cancel')?.payload?.taskId).toBe('t2')
  // 等取消命令的 ack 回来、确认框收起后再拖下一张；拖拽入口会拒绝 pending 中的操作。
  await expect(page.getByRole('heading', { name: '取消任务？' })).toHaveCount(0)

  await dragAfterLongPress(
    page,
    board.getByTestId('task-card-t3'),
    board.locator('[data-column="done"]'),
  )
  await expect
    .poll(() => commands.filter((command) => command.type === 'review.decide').length)
    .toBe(1)
})
