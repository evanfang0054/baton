import { expect, test } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('creates a task with canvas context', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  let created = false

  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string; payload?: unknown }
      if (!message.id) return
      commands.push(message)
      if (message.type === 'task.create') created = true
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${message.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: {
            commandId: message.id,
            ok: true,
            data: created ? { taskId: 't1' } : { cursor: 0, hasMore: false },
          },
        }),
      )
    })
  })

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/workspaces') {
      return route.fulfill({
        json: {
          workspaces: [
            {
              id: 'w1',
              name: 'demo',
              relPath: 'demo',
              trusted: true,
              projectHooks: 'off',
              trustedAt: 1,
              createdAt: 1,
            },
          ],
        },
      })
    }
    if (path === '/api/canvas') {
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: [
            {
              id: 't1',
              canvasId: 'c1',
              type: 'text',
              x: 80,
              y: 80,
              w: 240,
              h: 120,
              groupId: null,
              data: { content: '需求 A' },
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 't2',
              canvasId: 'c1',
              type: 'text',
              x: 80,
              y: 260,
              w: 240,
              h: 120,
              groupId: null,
              data: { content: '需求 B' },
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'a1',
              canvasId: 'c1',
              type: 'agent',
              x: 480,
              y: 160,
              w: 240,
              h: 120,
              groupId: null,
              data: { title: 'Agent 1', engine: 'fake', taskId: null },
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          edges: [],
        },
      })
    }
    if (path === '/api/tasks') {
      return route.fulfill({ json: { tasks: [] } })
    }
    if (path === '/api/engines') {
      return route.fulfill({ json: { engines: [{ engine: 'fake', status: 'available' }] } })
    }
    if (path === '/api/tasks/t1') {
      return route.fulfill({
        json: {
          task: {
            id: 't1',
            workspaceId: 'w1',
            nodeId: 'a1',
            title: 'Agent 1',
            prompt: '<task>开始</task>',
            status: 'todo',
            waitingReason: null,
            engine: 'fake',
            workspaceMode: 'main',
            branch: null,
            worktreePath: null,
            verifyCommand: null,
            dangerouslySkipPermissions: false,
            retryCount: 0,
            createdAt: 1,
            updatedAt: 1,
            context: {
              included: [
                { id: 't1', type: 'text', title: '需求 A', depth: 0, chars: 6 },
                { id: 't2', type: 'text', title: '需求 B', depth: 0, chars: 6 },
              ],
              dropped: [],
              truncated: false,
              redactedPaths: [],
              relations: [],
              relationsTruncated: false,
            },
          },
          sessions: [],
          approvals: [],
          review: null,
          waitingSince: null,
          attention: 'none',
        },
      })
    }
    return route.fulfill({ status: 404, json: { code: 'not_found', message: 'not found' } })
  })

  await page.goto('/?workspace=w1')
  await expect(page.getByText('需求 A')).toBeVisible()

  await page.locator('.react-flow__node', { hasText: '需求 A' }).click({ modifiers: [modifier] })
  await page.locator('.react-flow__node', { hasText: '需求 B' }).click({ modifiers: [modifier] })
  await page.locator('.react-flow__node', { hasText: 'Agent 1' }).click()

  const panel = page.getByTestId('node-detail')
  await expect(panel.getByTestId('context-chips')).toContainText('需求 A')
  await expect(panel.getByTestId('context-chips')).toContainText('需求 B')

  await page.getByLabel('任务说明').fill('总结两个需求')
  await page.getByRole('button', { name: '创建任务' }).click()

  await expect
    .poll(() => {
      const create = commands.find((message) => message.type === 'task.create')
      const payload = create?.payload as { contextNodeIds?: string[] } | undefined
      return payload?.contextNodeIds?.slice().sort().join(',') ?? ''
    })
    .toBe('t1,t2')

  await expect(page.getByText('上下文快照')).toBeVisible()
  await expect(page.getByText('注入 2 个')).toBeVisible()
})
