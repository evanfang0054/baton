import { expect, test } from '@playwright/test'
import { mockWorkspace, sceneDetail, task } from './m6-helpers'

test('right panel task detail scrolls when content overflows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 380 })
  await mockWorkspace(page, {
    tasks: [task({ id: 't1', nodeId: 'a1', title: '长任务详情', status: 'review' })],
    taskDetail: sceneDetail(),
  })
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string }
      if (!message.id) return
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

  await page.goto('/?workspace=w1&task=t1')
  const panel = page.getByTestId('task-detail')
  await expect(panel).toBeVisible()

  const metrics = await panel.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  expect(metrics.overflowY).toBe('auto')

  // 会话区不能被上方内容挤成 0 高；它应保留可用的自身滚动高度。
  const transcriptHeight = await page
    .getByTestId('transcript-section')
    .evaluate((element) => element.clientHeight)
  expect(transcriptHeight).toBeGreaterThan(120)
})
