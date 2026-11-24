import { expect, test } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

interface SupervisorPayload {
  id: string
  threadId: string
  role: 'assistant'
  content: string
  toolCalls: Array<Record<string, unknown>>
  decision: Record<string, unknown>
  meta: null
  status: 'ok'
  error: null
  createdAt: number
}

function assistantMessage(
  content: string,
  options: { id?: string; toolCalls?: Array<Record<string, unknown>>; kind?: string } = {},
): SupervisorPayload {
  const id = options.id ?? 'm1'
  return {
    id,
    threadId: 'th1',
    role: 'assistant',
    content,
    toolCalls: options.toolCalls ?? [],
    decision: {
      id: `d-${id}`,
      threadId: 'th1',
      triggerId: 'r1',
      messageId: id,
      kind: options.kind ?? 'chat',
      strength: 'explicit',
      mode: 'explicit',
      reason: 'e2e',
      taskId: 'task-1',
      toolCalls: [],
      createdAt: 2,
    },
    meta: null,
    status: 'ok',
    error: null,
    createdAt: 2,
  }
}

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
    data: { title: 'Agent 1', engine: 'claude-sdk', taskId: null },
    createdAt: 1,
    updatedAt: 1,
  },
]

async function mockSupervisorRest(
  page: import('@playwright/test').Page,
  getMessages: () => unknown[],
) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/workspaces') {
      return route.fulfill({ json: { workspaces: [workspace] } })
    }
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
      return route.fulfill({ json: { engines: [{ engine: 'claude-sdk', status: 'available' }] } })
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

async function selectContextAndAgent(page: import('@playwright/test').Page) {
  await page.locator('.react-flow__node', { hasText: '需求 A' }).click()
  await page.getByRole('button', { name: '关闭节点详情' }).click()
  await page.locator('.react-flow__node', { hasText: 'Agent 1' }).click({ modifiers: [modifier] })
}

test('creates a todo task from canvas context without starting it', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  let messages: unknown[] = []

  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as {
        id?: string
        type?: string
        payload?: { text?: unknown }
      }
      if (!message.id) return
      commands.push(message)

      if (message.type === 'supervisor.send') {
        ws.send(
          JSON.stringify({
            v: 1,
            id: `ack-${message.id}`,
            type: 'ack',
            ts: Date.now(),
            payload: {
              commandId: message.id,
              ok: true,
              data: { threadId: 'th1', messageId: 'm1' },
            },
          }),
        )
        ws.send(
          JSON.stringify({
            v: 1,
            ts: Date.now(),
            type: 'supervisor.delta',
            payload: { threadId: 'th1', messageId: 'm1', delta: '正在建任务' },
          }),
        )
        ws.send(
          JSON.stringify({
            v: 1,
            ts: Date.now(),
            type: 'supervisor.tool',
            payload: {
              threadId: 'th1',
              messageId: 'm1',
              toolCallId: 'tc1',
              name: 'create_task',
              phase: 'end',
              ok: true,
              summary: '已建到待办',
            },
          }),
        )
        const final = assistantMessage('已建到待办，请打开任务后点「立即开工」。', {
          id: 'm1',
          kind: 'create_task',
          toolCalls: [
            {
              id: 'tc1',
              name: 'create_task',
              args: {},
              ok: true,
              result: {
                taskId: 'task-1',
                title: '登录页暗黑模式',
                target: { id: 'a1', title: 'Agent 1', engine: 'claude-sdk' },
                contextCount: 1,
                status: 'todo',
              },
            },
          ],
        })
        messages = [final]
        ws.send(
          JSON.stringify({ v: 1, ts: Date.now(), type: 'supervisor.message', payload: final }),
        )
        return
      }

      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${message.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: { commandId: message.id, ok: true, data: { cursor: 0, hasMore: false } },
        }),
      )
    })
  })

  await mockSupervisorRest(page, () => messages)
  await page.goto('/?workspace=w1')
  await expect(page.getByText('需求 A')).toBeVisible()

  await selectContextAndAgent(page)
  await page.getByLabel('对总管说').fill('给这个 Agent 建个任务')
  await page.getByRole('button', { name: '发送' }).click()

  await expect(page.getByText('已建到待办，请打开任务后点「立即开工」。')).toBeVisible()
  await expect(page.getByText('登录页暗黑模式')).toBeVisible()
  await expect(page.getByRole('button', { name: '打开任务' })).toBeVisible()

  const sent = commands.find((command) => command.type === 'supervisor.send')
  expect(sent?.payload).toMatchObject({
    workspaceId: 'w1',
    text: '给这个 Agent 建个任务',
    contextNodeIds: ['n1'],
    targetNodeId: 'a1',
  })
  expect(commands.some((command) => command.type === 'task.enqueue')).toBe(false)
})

test('answers attention query and refuses to start work', async ({ page }) => {
  const commands: Array<{ type?: string }> = []
  let messages: unknown[] = []

  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as {
        id?: string
        type?: string
        payload?: { text?: unknown }
      }
      if (!message.id) return
      commands.push(message)
      if (message.type === 'supervisor.send') {
        const text = String(message.payload?.text)
        const content = text.includes('开工')
          ? '请打开任务卡，点「立即开工」；总管不替你开工。'
          : '待处理：task-1（review，已等 3 分钟）。'
        const final = assistantMessage(content, {
          id: `m${messages.length + 1}`,
          kind: 'query_status',
        })
        messages = [...messages, final]
        ws.send(
          JSON.stringify({
            v: 1,
            id: `ack-${message.id}`,
            type: 'ack',
            ts: Date.now(),
            payload: {
              commandId: message.id,
              ok: true,
              data: { threadId: 'th1', messageId: 'm1' },
            },
          }),
        )
        ws.send(
          JSON.stringify({
            v: 1,
            ts: Date.now(),
            type: 'supervisor.message',
            payload: final,
          }),
        )
        return
      }
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${message.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: { commandId: message.id, ok: true, data: { cursor: 0, hasMore: false } },
        }),
      )
    })
  })

  await mockSupervisorRest(page, () => messages)
  await page.goto('/?workspace=w1')
  await page.getByLabel('对总管说').fill('现在哪些任务在等我')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText(/task-1/)).toBeVisible()
  await expect(page.getByText(/review/)).toBeVisible()

  await page.getByLabel('对总管说').fill('帮我把 task-1 开工')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByText(/总管不替你开工/)).toBeVisible()
  expect(commands.some((command) => command.type === 'task.enqueue')).toBe(false)
})

test('shows the unconfigured hint', async ({ page }) => {
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage(() => undefined)
  })
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/workspaces') {
      return route.fulfill({ json: { workspaces: [workspace] } })
    }
    if (path === '/api/canvas') {
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: [],
          edges: [],
        },
      })
    }
    if (path === '/api/tasks') return route.fulfill({ json: { tasks: [] } })
    if (path === '/api/supervisor/status') {
      return route.fulfill({
        json: {
          configured: false,
          mode: 'explicit',
          policyVersion: 'p1',
          errorCode: 'supervisor_unavailable',
        },
      })
    }
    if (path === '/api/supervisor/messages') {
      return route.fulfill({ json: { threadId: null, messages: [] } })
    }
    return route.fulfill({ status: 404, json: { code: 'not_found', message: 'not found' } })
  })
  await page.goto('/?workspace=w1')
  await expect(page.getByText('总管未配置模型')).toBeVisible()
  await expect(page.getByRole('button', { name: '检查配置' })).toBeVisible()
})
