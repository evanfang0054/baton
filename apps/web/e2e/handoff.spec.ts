import { expect, test, type Page } from '@playwright/test'
import { mockDelivery, mockDeliveryDetail } from './m6-helpers'

const workspace = {
  id: 'w1',
  name: 'demo',
  relPath: 'demo',
  trusted: true,
  projectHooks: 'off',
  trustedAt: 1,
  createdAt: 1,
}

const baseNodes = [
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

const handoffNode = {
  id: 'handoff-1',
  canvasId: 'c1',
  type: 'text',
  x: 760,
  y: 160,
  w: 360,
  h: 260,
  groupId: null,
  data: { content: '【交接】登录页改造\n<handoff>已完成登录页改造。</handoff>' },
  createdAt: 2,
  updatedAt: 2,
}

const handoffNode2 = {
  id: 'handoff-2',
  canvasId: 'c1',
  type: 'text',
  x: 760,
  y: 440,
  w: 360,
  h: 260,
  groupId: null,
  data: { content: '【交接】登录页改造（第二次快照）\n<handoff>第二次快照。</handoff>' },
  createdAt: 3,
  updatedAt: 3,
}

const task = {
  id: 'task-1',
  workspaceId: 'w1',
  nodeId: 'a1',
  title: '登录页改造',
  prompt: '<task>把登录页改成双栏布局</task>',
  status: 'review',
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
  deliveryId: 'd1',
  stageKey: 'requirement',
}

const review = {
  id: 'review-1',
  taskId: 'task-1',
  verdict: null,
  verifyExitCode: 0,
  verifyOutput: '',
  diffStat: { filesChanged: 1, insertions: 10, deletions: 2 },
  decidedAt: null,
  diffAvailable: true,
}

async function mockRest(
  page: Page,
  options: { handoffCount?: () => number; getMessages?: () => unknown[] } = {},
) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/workspaces') return route.fulfill({ json: { workspaces: [workspace] } })
    if (path === '/api/deliveries') {
      return route.fulfill({ json: { deliveries: [mockDelivery] } })
    }
    if (path === '/api/deliveries/d1') {
      return route.fulfill({ json: { delivery: mockDeliveryDetail } })
    }
    if (path === '/api/deliveries/d1/artifacts') {
      return route.fulfill({ json: { artifacts: [] } })
    }
    if (path === '/api/attention') {
      return route.fulfill({ json: { items: [], total: 0 } })
    }
    if (path === '/api/canvas') {
      const count = options.handoffCount?.() ?? 0
      const nodes =
        count >= 2
          ? [...baseNodes, handoffNode, handoffNode2]
          : count === 1
            ? [...baseNodes, handoffNode]
            : baseNodes
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes,
          edges: [],
        },
      })
    }
    if (path === '/api/tasks') return route.fulfill({ json: { tasks: [task] } })
    if (path === '/api/tasks/task-1') {
      return route.fulfill({
        json: {
          task,
          contextInvalid: false,
          originInvalid: false,
          sessions: [],
          approvals: [],
          review,
          waitingSince: null,
          attention: 'needs_review',
        },
      })
    }
    if (path === '/api/tasks/task-1/history') {
      return route.fulfill({
        json: { taskId: 'task-1', statusEvents: [], sessions: [], reviews: [review] },
      })
    }
    if (path === '/api/tasks/task-1/automation') {
      return route.fulfill({
        json: {
          taskId: 'task-1',
          retryCount: 0,
          lastVerifyExitCode: 0,
          lastPolicyVersion: null,
          autoDecisions: [],
        },
      })
    }
    if (path === '/api/engines') {
      return route.fulfill({
        json: { engines: [{ engine: 'claude-sdk', status: 'available' }] },
      })
    }
    if (path === '/api/supervisor/status') {
      return route.fulfill({
        json: { configured: true, model: 'demo', mode: 'explicit', policyVersion: 'p1' },
      })
    }
    if (path === '/api/supervisor/messages') {
      return route.fulfill({
        json: { threadId: 'th1', messages: options.getMessages?.() ?? [] },
      })
    }
    if (path === '/api/notices') return route.fulfill({ json: { notices: [] } })
    return route.fulfill({ status: 404, json: { code: 'not_found', message: 'not found' } })
  })
}

async function mockHandoffCommand(page: Page) {
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const incoming = JSON.parse(String(raw)) as { id?: string; type?: string }
      if (!incoming.id || incoming.type !== 'task.handoff') return
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${incoming.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: {
            commandId: incoming.id,
            ok: true,
            data: { taskId: 'task-1', nodeId: 'handoff-1', warnings: [] },
          },
        }),
      )
    })
  })
}

test('creates a handoff node from the task detail and refreshes the canvas', async ({ page }) => {
  let handoffCount = 0
  await mockRest(page, { handoffCount: () => handoffCount })
  await mockHandoffCommand(page)
  await page.goto('/?workspace=w1&delivery=d1&task=task-1')

  await expect(page.getByRole('button', { name: '生成交接节点' })).toBeVisible()
  handoffCount = 1
  await page.getByRole('button', { name: '生成交接节点' }).click()

  await expect(page.getByText('已生成交接节点，可在画布中选中它创建下一个任务')).toBeVisible()
  await expect(page.getByText('【交接】登录页改造')).toBeVisible()
})

test('keeps both snapshots when handoff is repeated', async ({ page }) => {
  let handoffCount = 0
  await mockRest(page, { handoffCount: () => handoffCount })
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const incoming = JSON.parse(String(raw)) as { id?: string; type?: string }
      if (!incoming.id || incoming.type !== 'task.handoff') return
      handoffCount += 1
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${incoming.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: {
            commandId: incoming.id,
            ok: true,
            data: { taskId: 'task-1', nodeId: `handoff-${handoffCount}`, warnings: [] },
          },
        }),
      )
    })
  })
  await page.goto('/?workspace=w1&delivery=d1&task=task-1')

  await page.getByRole('button', { name: '生成交接节点' }).click()
  await expect(page.getByText('【交接】登录页改造')).toBeVisible()
  await page.getByRole('button', { name: '生成交接节点' }).click()
  await expect(page.getByText('【交接】登录页改造（第二次快照）')).toBeVisible()
  await expect(page.getByText('已完成登录页改造。')).toBeVisible()
})

test('shows a handoff card with its source and worktree warning in the supervisor', async ({
  page,
}) => {
  let messages: unknown[] = []
  await mockRest(page, { getMessages: () => messages })
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const incoming = JSON.parse(String(raw)) as { id?: string; type?: string }
      if (!incoming.id || incoming.type !== 'supervisor.send') return
      const message = {
        id: 'm-handoff',
        threadId: 'th1',
        role: 'assistant',
        content: '已把结果交给新任务。',
        toolCalls: [
          {
            id: 'tc-handoff',
            name: 'handoff_task',
            args: { fromTaskId: 'task-1', note: '继续修改登录页' },
            ok: true,
            result: {
              task: {
                taskId: 'task-2',
                title: '跟进：登录页改造',
                target: { id: 'a1', title: 'Agent 1', engine: 'claude-sdk' },
                contextCount: 1,
                status: 'todo',
              },
              handoff: {
                nodeId: 'handoff-1',
                fromTaskId: 'task-1',
                fromTitle: '登录页改造',
                fromStatus: 'review',
                worktree: true,
                warnings: ['源任务在隔离 worktree，变更文件在主项目不可读。'],
              },
            },
          },
        ],
        decision: {
          id: 'd-m-handoff',
          threadId: 'th1',
          triggerId: 'r1',
          messageId: 'm-handoff',
          kind: 'create_task',
          strength: 'explicit',
          mode: 'explicit',
          reason: 'e2e',
          taskId: 'task-2',
          toolCalls: [],
          createdAt: 2,
        },
        meta: null,
        status: 'ok',
        error: null,
        createdAt: 2,
      }
      messages = [message]
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${incoming.id}`,
          type: 'ack',
          ts: Date.now(),
          payload: {
            commandId: incoming.id,
            ok: true,
            data: { threadId: 'th1', messageId: message.id },
          },
        }),
      )
      ws.send(
        JSON.stringify({ v: 1, ts: Date.now(), type: 'supervisor.message', payload: message }),
      )
    })
  })

  await page.goto('/?workspace=w1')
  const composer = page.getByRole('textbox', { name: '对总管说' })
  await composer.fill('把登录页的结果交给新任务继续修改')
  await expect(composer).toHaveValue('把登录页的结果交给新任务继续修改')
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled()
  await page.getByRole('button', { name: '发送' }).click()

  await expect(page.getByText('跟进：登录页改造')).toBeVisible()
  await expect(page.getByText(/交接自《登录页改造》/)).toBeVisible()
  await expect(page.getByText(/变更文件在主项目不可读/)).toBeVisible()
})
