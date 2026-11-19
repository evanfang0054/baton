import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

type Sent = { type: string; payload: Record<string, unknown> }

async function mockApi(page: Page, sent: Sent[], state: { paused: boolean }) {
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as {
        id?: string
        type?: string
        payload?: Record<string, unknown>
      }
      if (message.type && message.payload) {
        sent.push({ type: message.type, payload: message.payload })
      }
      if (!message.id) return
      const data =
        message.type === 'task.create'
          ? { taskId: 't1' }
          : message.type === 'node.create'
            ? { nodeId: 'n-new' }
            : message.type === 'task.enqueue' ||
                message.type === 'approval.decide' ||
                message.type === 'review.decide'
              ? {}
              : { cursor: 0, hasMore: false }
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${message.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: { commandId: message.id, ok: true, data },
        }),
      )
    })
  })

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
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
              id: 'a1',
              canvasId: 'c1',
              type: 'agent',
              x: 0,
              y: 0,
              w: 320,
              h: 200,
              groupId: null,
              createdAt: 1,
              updatedAt: 1,
              data: { title: '主 Agent', engine: 'fake', taskId: null },
            },
            {
              id: 'n1',
              canvasId: 'c1',
              type: 'text',
              x: 400,
              y: 0,
              w: 320,
              h: 200,
              groupId: null,
              createdAt: 1,
              updatedAt: 1,
              data: { content: '需求上下文' },
            },
          ],
          edges: [],
        },
      })
    }
    if (path === '/api/engines') {
      return route.fulfill({ json: { engines: [{ engine: 'fake', status: 'available' }] } })
    }
    if (path === '/api/tasks') return route.fulfill({ json: { tasks: [] } })
    if (path === '/api/notices') return route.fulfill({ json: { notices: [] } })
    if (path === '/api/workspaces/w1/automation') {
      return route.fulfill({
        json: {
          workspaceId: 'w1',
          trusted: true,
          policy: { autopilot: { enabled: true } },
          policyVersion: 'p1',
          killSwitch: state.paused,
          killSwitchForced: false,
          digestCronUnsupported: false,
        },
      })
    }
    if (path === '/api/audit') return route.fulfill({ json: { entries: [] } })
    if (path === '/api/automation/kill-switch') {
      const body = route.request().postDataJSON() as { enabled: boolean }
      state.paused = body.enabled
      return route.fulfill({ json: { killSwitch: state.paused, killSwitchForced: false } })
    }
    return route.fulfill({ json: {} })
  })
}

test('creates a task from mobile with agent and context', async ({ page }) => {
  const sent: Sent[] = []
  const state = { paused: false }
  await mockApi(page, sent, state)
  await page.goto('/')
  await expect(page.getByText('在线')).toBeVisible()

  await page.getByRole('button', { name: '更多' }).click()
  await page
    .getByRole('dialog', { name: '更多操作' })
    .getByRole('button', { name: '新建任务' })
    .click()

  await page.getByLabel('任务标题').fill('移动建任务')
  await page.getByLabel('任务 prompt').fill('改一个常量')
  await page.getByRole('button', { name: '选择节点' }).click()
  await page.getByRole('button', { name: /需求上下文/ }).click()
  await page.getByRole('button', { name: '确定' }).click()
  await page.getByRole('button', { name: '创建' }).click()

  await expect
    .poll(() => sent.find((item) => item.type === 'task.create')?.payload)
    .toMatchObject({
      nodeId: 'a1',
      contextNodeIds: ['n1'],
      title: '移动建任务',
      engine: 'fake',
    })
  await expect(page.getByLabel('任务标题')).toHaveCount(0)
})

test('creates a text node from the node list', async ({ page }) => {
  const sent: Sent[] = []
  const state = { paused: false }
  await mockApi(page, sent, state)
  await page.goto('/')

  await page.getByRole('button', { name: '更多' }).click()
  await page.getByRole('button', { name: '节点列表' }).click()
  await page.getByRole('button', { name: '新建文本' }).click()
  await page.getByLabel('文本内容').fill('新的上下文')
  await page.getByRole('button', { name: '保存' }).click()

  await expect
    .poll(() => sent.find((item) => item.type === 'node.create')?.payload)
    .toMatchObject({ canvasId: 'c1', node: { type: 'text', data: { content: '新的上下文' } } })
  await expect(page.getByLabel('文本内容')).toHaveCount(0)
})

test('pauses automation from the more menu', async ({ page }) => {
  const sent: Sent[] = []
  const state = { paused: false }
  await mockApi(page, sent, state)
  await page.goto('/')

  await page.getByRole('button', { name: '更多' }).click()
  const more = page.getByRole('dialog', { name: '更多操作' })
  await expect(more.getByTestId('automation-status').getByText('自动化运行中')).toBeVisible()
  await page.getByRole('button', { name: '暂停自动化' }).click()
  await expect(more.getByTestId('automation-status').getByText('自动化已暂停')).toBeVisible()
})
