import { expect, test } from '@playwright/test'
import { groupNode, mockWorkspace, textNode } from './m6-helpers'

test('group drag persists children in one command', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', (ws) => {
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
  })
  await mockWorkspace(page, {
    nodes: [groupNode('g1', 120, 220), textNode('n1', 220, 320, { groupId: 'g1' })],
    tasks: [],
  })

  await page.goto('/?workspace=w1&delivery=d1')
  await page.addStyleTag({
    content: '[data-testid="delivery-summary-card"]{display:none}',
  })
  const group = page.locator('.react-flow__node[data-id="g1"]')
  await expect(group).toBeVisible()
  // fitView 在首帧后还会调整一次视口，等布局稳定再拖。
  await page.waitForTimeout(400)
  const box = await group.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return

  const startX = box.x + 60
  const startY = box.y + 24
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.waitForTimeout(100)
  await page.mouse.move(startX + 100, startY + 100, { steps: 20 })
  await page.mouse.up()

  await expect
    .poll(() => commands.find((command) => command.type === 'node.move_many'), {
      timeout: 10_000,
    })
    .toBeTruthy()
  const move = commands.find((command) => command.type === 'node.move_many')
  const payload = move?.payload as {
    canvasId?: string
    moves?: Array<{ nodeId: string; x: number; y: number }>
  }
  expect(payload?.canvasId).toBe('c1')
  const movedGroup = payload?.moves?.find((item) => item.nodeId === 'g1')
  const movedChild = payload?.moves?.find((item) => item.nodeId === 'n1')
  expect(movedGroup).toBeTruthy()
  expect(movedChild).toBeTruthy()
  // 拖拽像素会受浏览器/缩放取整影响；关键是一次命令里 group 与子节点位移一致。
  expect((movedGroup?.x ?? 0) - 120).toBeCloseTo((movedChild?.x ?? 0) - 220, 5)
  expect((movedGroup?.y ?? 0) - 220).toBeCloseTo((movedChild?.y ?? 0) - 320, 5)
  expect(movedGroup?.x ?? 0).toBeGreaterThan(120)
  expect(movedGroup?.y ?? 0).toBeGreaterThan(220)
})
