import { expect, test, type Page } from '@playwright/test'

const workspace = {
  id: 'w1',
  name: 'demo',
  relPath: 'demo',
  trusted: true,
  projectHooks: 'off',
  trustedAt: 1,
  createdAt: 1,
}

const canvasNodes = [
  {
    id: 'n1',
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
]

function supervisorMessage(
  id: string,
  content: string,
  toolCalls: Array<Record<string, unknown>>,
) {
  return {
    id,
    threadId: 'th1',
    role: 'assistant' as const,
    content,
    toolCalls,
    decision: {
      id: `d-${id}`,
      threadId: 'th1',
      triggerId: 'r1',
      messageId: id,
      kind: 'chat',
      strength: 'explicit',
      mode: 'explicit',
      reason: 'e2e',
      taskId: null,
      toolCalls: [],
      createdAt: 2,
    },
    meta: null,
    status: 'ok' as const,
    error: null,
    createdAt: 2,
  }
}

async function mockRest(page: Page, getMessages: () => unknown[]) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/workspaces') return route.fulfill({ json: { workspaces: [workspace] } })
    if (path === '/api/canvas') {
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: canvasNodes,
          edges: [],
        },
      })
    }
    if (path === '/api/tasks') return route.fulfill({ json: { tasks: [] } })
    if (path === '/api/engines') {
      return route.fulfill({ json: { engines: [{ engine: 'fake', status: 'available' }] } })
    }
    if (path === '/api/supervisor/status') {
      return route.fulfill({
        json: { configured: true, model: 'demo', mode: 'explicit', policyVersion: 'p1' },
      })
    }
    if (path === '/api/supervisor/messages') {
      return route.fulfill({ json: { threadId: 'th1', messages: getMessages() } })
    }
    return route.fulfill({ status: 404, json: { code: 'not_found', message: 'not found' } })
  })
}

async function mockSupervisor(
  page: Page,
  respond: (turn: number) => ReturnType<typeof supervisorMessage>,
) {
  let messages: unknown[] = []
  let turn = 0
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const incoming = JSON.parse(String(raw)) as { id?: string; type?: string }
      if (!incoming.id || incoming.type !== 'supervisor.send') return
      const payload = respond(turn++)
      messages = [payload]
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${incoming.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: {
            commandId: incoming.id,
            ok: true,
            data: { threadId: 'th1', messageId: payload.id },
          },
        }),
      )
      ws.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'supervisor.message', payload }))
    })
  })
  return { getMessages: () => messages }
}

async function openSupervisor(page: Page) {
  await page.goto('/?workspace=w1')
  await page.getByRole('tab', { name: '总管' }).click()
}

test('batch creates three todo cards sharing one agent', async ({ page }) => {
  const { getMessages } = await mockSupervisor(page, () =>
    supervisorMessage('m-batch', '已批量建好 3 个待办。', [
      {
        id: 'tc-batch',
        name: 'create_tasks',
        args: { nodeIds: ['n1', 'n2', 'n3'] },
        ok: true,
        result: {
          created: ['需求 A', '需求 B', '需求 C'].map((title, index) => ({
            taskId: `task-${index + 1}`,
            title,
            target: { id: 'a1', title: 'Agent 1', engine: 'claude-sdk' },
            contextCount: 0,
            status: 'todo',
          })),
          failed: [],
        },
      },
    ]),
  )
  await mockRest(page, getMessages)
  await openSupervisor(page)
  await page.getByRole('textbox').fill('把这 3 个需求分别建任务')
  await page.getByRole('button', { name: '发送' }).click()

  await expect(page.getByText('需求 A')).toBeVisible()
  await expect(page.getByText('需求 B')).toBeVisible()
  await expect(page.getByText('需求 C')).toBeVisible()
})

test('retries a failed task from chat', async ({ page }) => {
  const { getMessages } = await mockSupervisor(page, () =>
    supervisorMessage('m-retry', '已重试，任务回到队列。', [
      {
        id: 'tc-retry',
        name: 'retry_task',
        args: { taskId: 'task-1' },
        ok: true,
        result: { ok: true, taskId: 'task-1', status: 'queued' },
      },
    ]),
  )
  await mockRest(page, getMessages)
  await openSupervisor(page)
  await page.getByRole('textbox').fill('重试那个失败的任务')
  await page.getByRole('button', { name: '发送' }).click()

  await expect(page.getByText('已重试，任务回到队列。')).toBeVisible()
  await expect(page.getByText('retry_task')).toBeVisible()
})

test('asks for confirmation before cancelling a running task', async ({ page }) => {
  const { getMessages } = await mockSupervisor(page, (turn) =>
    turn === 0
      ? supervisorMessage('m-cancel-1', '任务正在运行，确认取消吗？', [
          {
            id: 'tc-cancel-1',
            name: 'cancel_task',
            args: { taskId: 'task-1' },
            ok: false,
            error: 'confirmation_required',
            result: {
              ok: false,
              code: 'confirmation_required',
              message: 'confirm before cancelling a running task',
            },
          },
        ])
      : supervisorMessage('m-cancel-2', '已取消。', [
          {
            id: 'tc-cancel-2',
            name: 'cancel_task',
            args: { taskId: 'task-1', confirm: true },
            ok: true,
            result: { ok: true, taskId: 'task-1', status: 'cancelled' },
          },
        ]),
  )
  await mockRest(page, getMessages)
  await openSupervisor(page)
  await page.getByRole('textbox').fill('取消那个运行中的任务')
  await page.getByRole('button', { name: '发送' }).click()

  await expect(page.getByText('任务正在运行，确认取消吗？')).toBeVisible()
  await expect(page.getByText('已取消。')).not.toBeVisible()

  await page.getByRole('textbox').fill('确认')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText('已取消。')).toBeVisible()
  await expect(page.getByText('cancel_task')).toBeVisible()
})
