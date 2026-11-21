import { expect, test } from '@playwright/test'
import { agentNode, imageNode, mockWorkspace, sceneDetail, task, textNode } from './m6-helpers'

test('image node and task scene', async ({ page }) => {
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
    nodes: [
      imageNode('i1', '.baton/uploads/a.png', 80, 80),
      agentNode('a1', 420, 80),
      textNode('n1', 80, 320),
    ],
    edges: [{ id: 'e1', canvasId: 'c1', sourceId: 'n1', targetId: 'i1', type: 'context' }],
    tasks: [task({ id: 't1', nodeId: 'a1', title: '任务' })],
    taskDetail: sceneDetail(),
  })

  await page.goto('/?workspace=w1')
  await expect(page.locator('.react-flow__node[data-id="i1"]')).toBeVisible()
  await expect(page.getByRole('img', { name: '图片' })).toBeVisible()

  const edge = page.locator('.react-flow__edge-interaction').first()
  await expect(edge).toBeAttached()
  await edge.dispatchEvent('click')
  await expect(page.getByRole('button', { name: '删除连线' })).toBeVisible()

  await page.getByRole('button', { name: '展开看板' }).click()
  await page.getByRole('button', { name: '看现场' }).click()
  await expect(page.getByTestId('task-scene-bar')).toBeVisible()
  await expect(page.getByTestId('task-scene-bar')).toContainText('任务')
  await expect(page.getByTestId('task-scene-bar')).toContainText('上下文 2 个')
  await expect(page.getByTestId('task-scene-bar')).toContainText('verify 0')
  await expect(page.getByRole('button', { name: '删除连线' })).toHaveCount(0)

  await page.getByRole('button', { name: '回到全局' }).click()
  await expect(page.getByTestId('task-scene-bar')).toHaveCount(0)
  expect(commands.every((command) => command.type !== 'node.update')).toBe(true)
  expect(commands.every((command) => command.type !== 'edge.delete')).toBe(true)
})
