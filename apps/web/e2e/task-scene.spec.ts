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

  await page.goto('/?workspace=w1&delivery=d1')
  await expect(page.locator('.react-flow__node[data-id="i1"]')).toBeVisible()
  await expect(page.getByRole('img', { name: '图片' })).toBeVisible()

  const edge = page.locator('.react-flow__edge-interaction').first()
  await expect(edge).toBeAttached()
  await edge.dispatchEvent('click')
  const deleteButton = page.getByRole('button', { name: '删除连线' })
  await expect(deleteButton).toBeVisible()
  await deleteButton.click()
  await expect(deleteButton).toHaveCount(0)
  await expect
    .poll(() => commands.filter((command) => command.type === 'edge.delete').length)
    .toBe(1)

  // 再选中一次边，进入现场后入口必须消失；命令数保持在 1 才能证明现场没有发删除。
  await page.locator('.react-flow__edge-interaction').first().dispatchEvent('click')
  await expect(deleteButton).toBeVisible()

  await page.getByRole('button', { name: '任务', exact: true }).click()
  await page.getByTestId('task-card-t1').click()
  await expect(page.getByRole('dialog', { name: '阶段现场' })).toBeVisible()
  await expect(page.getByTestId('task-detail')).toContainText('任务')
  await expect(deleteButton).toHaveCount(0)

  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '阶段现场' })).toHaveCount(0)
  expect(commands.every((command) => command.type !== 'node.update')).toBe(true)
  expect(commands.filter((command) => command.type === 'edge.delete')).toHaveLength(1)
})
