import { expect, test, type Page } from '@playwright/test'

type Sent = { type: string; payload: Record<string, unknown> }

async function mockWorkspace(page: Page, sent: Sent[], status: 'failed' | 'done') {
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

  const task = {
    id: 't1',
    workspaceId: 'w1',
    nodeId: null,
    title: '售后任务',
    prompt: '',
    status,
    waitingReason: null,
    engine: 'claude-sdk',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    dangerouslySkipPermissions: false,
    enqueuedAt: null,
    retryCount: 0,
    createdAt: 1,
    updatedAt: 2,
    context: null,
    origin: null,
  }

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
    if (path === '/api/engines') {
      return route.fulfill({ json: { engines: [{ engine: 'claude-sdk', status: 'available' }] } })
    }
    if (path === '/api/notices') return route.fulfill({ json: { notices: [] } })
    if (path === '/api/canvas') {
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: [],
          edges: [],
        },
      })
    }
    if (path === '/api/tasks') {
      return route.fulfill({
        json: {
          tasks: [
            {
              ...task,
              attention: 'none',
              waitingSince: null,
            },
          ],
        },
      })
    }
    if (path === '/api/tasks/t1') {
      return route.fulfill({
        json: {
          task,
          sessions: [
            {
              id: 's1',
              taskId: 't1',
              adapter: 'claude-sdk',
              engineSessionId: null,
              status: 'ended',
              outcome: 'ready',
              startedAt: 1,
              endedAt: 2,
            },
          ],
          approvals: [],
          review: null,
          waitingSince: null,
          attention: 'none',
          contextInvalid: false,
          originInvalid: false,
        },
      })
    }
    if (path === '/api/tasks/t1/automation') {
      return route.fulfill({
        json: {
          taskId: 't1',
          retryCount: 0,
          lastVerifyExitCode: null,
          lastPolicyVersion: null,
          autoDecisions: [],
        },
      })
    }
    if (path === '/api/tasks/t1/history') {
      return route.fulfill({
        json: {
          taskId: 't1',
          statusEvents: [
            {
              ordinal: 3,
              ts: 3,
              status,
              previousStatus: 'running',
              retryCount: 0,
            },
          ],
          sessions: [
            {
              id: 's1',
              taskId: 't1',
              adapter: 'claude-sdk',
              engineSessionId: null,
              status: 'ended',
              outcome: 'ready',
              startedAt: 1,
              endedAt: 2,
            },
          ],
          reviews: [],
        },
      })
    }
    return route.fulfill({ json: {} })
  })
}

test('retries a failed task with a note', async ({ page }) => {
  const sent: Sent[] = []
  await mockWorkspace(page, sent, 'failed')
  await page.goto('/?workspace=w1&task=t1')

  await page.getByRole('button', { name: '重试' }).click()
  await page.getByLabel('重试备注').fill('再试一次')
  await page.getByRole('button', { name: '确认重试' }).click()

  await expect
    .poll(() => sent.find((message) => message.type === 'task.retry'))
    .toEqual({ type: 'task.retry', payload: { taskId: 't1', note: '再试一次' } })
})

test('reopens a done task and shows history', async ({ page }) => {
  const sent: Sent[] = []
  await mockWorkspace(page, sent, 'done')
  await page.goto('/?workspace=w1&task=t1')

  await page.getByRole('button', { name: '历史' }).click()
  await expect(page.getByText(/会话 已结束/)).toBeVisible()

  await page.getByRole('button', { name: '重新打开' }).click()
  await page.getByRole('button', { name: '确认重新打开' }).click()
  await expect
    .poll(() => sent.find((message) => message.type === 'task.reopen'))
    .toEqual({
      type: 'task.reopen',
      payload: { taskId: 't1' },
    })
})

test('keeps retry available in the mobile footer', async ({ page }) => {
  const sent: Sent[] = []
  await page.setViewportSize({ width: 390, height: 844 })
  await mockWorkspace(page, sent, 'failed')
  await page.goto('/?workspace=w1&task=t1')
  await expect(
    page.getByTestId('mobile-task-footer').getByRole('button', { name: '重试' }),
  ).toBeVisible()
})
