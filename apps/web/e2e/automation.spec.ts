import type { Notice } from '@baton/protocol'
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

function taskSummary(id: string, title: string, nodeId: string) {
  return {
    id,
    workspaceId: 'w1',
    nodeId,
    title,
    prompt: '',
    status: 'todo',
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
    updatedAt: 1,
    attention: 'none',
    waitingSince: null,
  }
}

function digestPayload(workspaceId: string, generatedAt: number) {
  return {
    workspaceId,
    windowStart: 0,
    windowEnd: generatedAt,
    generatedAt,
    policyVersion: 'abc123abc123',
    snapshot: {
      total: 3,
      unplanned: 0,
      todo: 0,
      running: 0,
      waiting: 1,
      review: 2,
      done: 0,
      closed: 0,
      attention: { needsApproval: 0, needsReply: 1, needsAttention: 0, needsReview: 2 },
    },
    ready: [],
    blocked: [
      {
        id: 't1',
        title: '任务一',
        status: 'waiting_input',
        attention: 'needs_reply',
        waitingSince: 10,
        retryCount: 0,
      },
    ],
    dropped: [],
    changes: {
      created: 2,
      updated: 2,
      completed: 0,
      failed: 0,
      cancelled: 0,
      retried: 1,
      autoAllowed: 1,
      autoDenied: 0,
    },
    oldestWaiting: {
      id: 't1',
      title: '任务一',
      status: 'waiting_input',
      attention: 'needs_reply',
      waitingSince: 10,
      retryCount: 0,
    },
  }
}

function digestNotice(id: string, ts: number, readAt: number | null): Notice {
  return { id, workspaceId: 'w1', ts, kind: 'digest', payload: digestPayload('w1', ts), readAt }
}

interface PatchBody {
  autopilot?: { enabled?: boolean; retryMax?: number }
  approval?: { autoApproveMaxRisk?: 'low' | 'medium' }
}

interface MockOptions {
  taskCount?: number
  trusted?: boolean
  killSwitchForced?: boolean
}

async function mockAutomationApi(page: Page, options: MockOptions = {}) {
  const automation = {
    workspaceId: 'w1',
    trusted: options.trusted ?? true,
    policy: {
      verify: { command: 'pnpm test', timeoutSec: 900, maxOutputBytes: 262144 },
      approval: {
        default: 'ask',
        allow: ['Read'],
        deny: ['Bash:sudo *'],
        autoApproveMaxRisk: 'low',
      },
      autopilot: { enabled: true, retryMax: 2, digestCron: '0 9,21 * * *' },
    },
    policyVersion: 'abc123abc123',
    killSwitch: options.killSwitchForced ?? false,
    killSwitchForced: options.killSwitchForced ?? false,
    digestCronUnsupported: false,
  }
  const tasks = Array.from({ length: options.taskCount ?? 2 }, (_, index) =>
    taskSummary(
      `t${index + 1}`,
      index === 0 ? '任务一' : index === 1 ? '任务二' : `任务${index + 1}`,
      `a${index + 1}`,
    ),
  )
  const notices: Notice[] = [digestNotice('n2', 200, null), digestNotice('n1', 100, 100)]
  const audit: Array<Record<string, unknown>> = []
  const requests: Array<{ method: string; path: string; body?: unknown }> = []

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const rawBody = request.postData()
    const body: unknown = rawBody ? JSON.parse(rawBody) : undefined
    requests.push({ method, path, body })

    if (path === '/api/workspaces') {
      return route.fulfill({ json: { workspaces: [workspace] } })
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
              x: 40,
              y: 40,
              w: 240,
              h: 120,
              groupId: null,
              data: { title: 'Agent 1', engine: 'claude-sdk', taskId: null },
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'a2',
              canvasId: 'c1',
              type: 'agent',
              x: 340,
              y: 40,
              w: 240,
              h: 120,
              groupId: null,
              data: { title: 'Agent 2', engine: 'claude-sdk', taskId: null },
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          edges: [],
        },
      })
    }
    if (path === '/api/tasks') return route.fulfill({ json: { tasks } })
    if (path === '/api/engines') {
      return route.fulfill({ json: { engines: [{ engine: 'claude-sdk', status: 'available' }] } })
    }
    if (path === '/api/supervisor/status') {
      return route.fulfill({
        json: { configured: true, mode: 'explicit', policyVersion: 'p1' },
      })
    }
    if (path === '/api/supervisor/messages') {
      return route.fulfill({ json: { threadId: 'th1', messages: [] } })
    }
    if (path === '/api/workspaces/w1/automation') {
      if (method === 'PATCH') {
        const patch = body as PatchBody
        automation.policy = {
          ...automation.policy,
          autopilot: { ...automation.policy.autopilot, ...(patch.autopilot ?? {}) },
          approval: { ...automation.policy.approval, ...(patch.approval ?? {}) },
        }
        audit.unshift({
          id: `a${audit.length + 1}`,
          ts: Date.now(),
          actor: 'user',
          action: 'automation.policy.update',
          detail: {},
        })
      }
      return route.fulfill({ json: automation })
    }
    if (path === '/api/automation/kill-switch' && method === 'PUT') {
      if (automation.killSwitchForced) {
        return route.fulfill({ json: { killSwitch: true, killSwitchForced: true } })
      }
      const patch = body as { enabled?: boolean }
      automation.killSwitch = Boolean(patch.enabled)
      audit.unshift({
        id: `a${audit.length + 1}`,
        ts: Date.now(),
        actor: 'user',
        action: 'automation.kill_switch',
        detail: { enabled: automation.killSwitch },
      })
      return route.fulfill({
        json: { killSwitch: automation.killSwitch, killSwitchForced: false },
      })
    }
    if (path === '/api/notices' && method === 'GET') {
      const kind = url.searchParams.get('kind')
      const limit = Number(url.searchParams.get('limit') ?? '50')
      const filtered = kind ? notices.filter((notice) => notice.kind === kind) : notices
      return route.fulfill({ json: { notices: filtered.slice(0, limit) } })
    }
    if (/^\/api\/notices\/[^/]+\/read$/.test(path) && method === 'POST') {
      const id = path.split('/')[3]
      const notice = notices.find((item) => item.id === id)
      if (notice) notice.readAt = Date.now()
      return route.fulfill({ json: { notice } })
    }
    if (path === '/api/workspaces/w1/digest' && method === 'POST') {
      const notice = digestNotice(`n${notices.length + 1}`, Date.now(), null)
      notices.unshift(notice)
      return route.fulfill({ json: { notice } })
    }
    if (path === '/api/audit') {
      return route.fulfill({
        json: { entries: audit.slice(0, Number(url.searchParams.get('limit') ?? '20')) },
      })
    }
    const automationMatch = path.match(/^\/api\/tasks\/([^/]+)\/automation$/)
    if (automationMatch) {
      const taskId = automationMatch[1]
      return route.fulfill({
        json:
          taskId === 't1'
            ? {
                taskId,
                retryCount: 1,
                lastVerifyExitCode: 1,
                lastPolicyVersion: 'abc123abc123',
                autoDecisions: [
                  {
                    approvalId: 'ap1',
                    decision: 'allow',
                    toolName: 'Bash',
                    risk: 'low',
                    decidedAt: 10,
                    policyVersion: 'abc123abc123',
                  },
                ],
              }
            : {
                taskId,
                retryCount: 0,
                lastVerifyExitCode: null,
                lastPolicyVersion: null,
                autoDecisions: [],
              },
      })
    }
    const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/)
    if (taskMatch && method === 'GET') {
      const task = tasks.find((item) => item.id === taskMatch[1])
      if (!task) {
        return route.fulfill({ status: 404, json: { code: 'not_found', message: 'not found' } })
      }
      return route.fulfill({
        json: {
          task: { ...task, context: null, origin: null },
          sessions: [],
          approvals: [],
          review: null,
          waitingSince: null,
          attention: 'none',
          contextInvalid: false,
          originInvalid: false,
        },
      })
    }
    return route.fulfill({ status: 404, json: { code: 'not_found', message: 'not found' } })
  })

  return { requests, notices }
}

async function routeCommands(
  page: Page,
  commands: Array<Record<string, unknown>>,
  failTaskIds: string[] = [],
) {
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as Record<string, unknown>
      if (!message.id) return
      commands.push(message)
      const taskId = (message.payload as { taskId?: string } | undefined)?.taskId
      if (message.type === 'task.enqueue' && taskId && failTaskIds.includes(taskId)) {
        ws.send(
          JSON.stringify({
            v: 1,
            ts: Date.now(),
            type: 'error',
            payload: {
              code: 'enqueue_failed',
              message: 'mock enqueue failed',
              commandId: message.id,
            },
          }),
        )
        return
      }
      ws.send(
        JSON.stringify({
          v: 1,
          id: `ack-${String(message.id)}`,
          type: 'ack',
          ts: Date.now(),
          payload: { commandId: message.id, ok: true, data: {} },
        }),
      )
    })
  })
}

test('edits automation policy and drives the kill switch', async ({ page }) => {
  const commands: Array<Record<string, unknown>> = []
  await routeCommands(page, commands)
  const { requests } = await mockAutomationApi(page)
  await page.goto('/?workspace=w1')

  await expect(page.getByText('自动化运行中')).toBeVisible()
  await page.getByRole('button', { name: '设置' }).click()
  const dialog = page.getByTestId('automation-settings')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('checkbox', { name: '自动驾驶' }).uncheck()
  await dialog.getByLabel('最大自动重试次数').fill('4')
  await dialog.getByLabel('自动批准风险上限').selectOption('medium')
  await dialog.getByRole('button', { name: '保存' }).click()

  await expect(page.getByText('自动化关闭')).toBeVisible()
  const patch = requests.find((item) => item.method === 'PATCH')
  expect(patch?.body).toEqual({
    autopilot: { enabled: false, retryMax: 4 },
    approval: { autoApproveMaxRisk: 'medium' },
  })

  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('checkbox', { name: '自动驾驶' }).check()
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('自动化运行中')).toBeVisible()

  await page.getByRole('button', { name: '暂停自动化' }).click()
  await expect(page.getByTestId('automation-status').getByText('自动化已暂停')).toBeVisible()
  expect(
    requests.some(
      (item) =>
        item.path === '/api/automation/kill-switch' &&
        (item.body as { enabled?: boolean } | undefined)?.enabled === true,
    ),
  ).toBe(true)

  await page.getByRole('button', { name: '恢复' }).click()
  await page.getByRole('button', { name: '恢复自动化' }).click()
  await expect(page.getByText('自动化运行中')).toBeVisible()
})

test('blocks automation settings in an untrusted workspace', async ({ page }) => {
  await routeCommands(page, [])
  await mockAutomationApi(page, { trusted: false })
  await page.goto('/?workspace=w1')

  await expect(page.getByTestId('automation-status').getByText('自动化关闭')).toBeVisible()
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByText('先信任项目，才能启用自动化。')).toBeVisible()
  await expect(page.getByRole('button', { name: '保存' })).toBeDisabled()
})

test('shows env-forced pause without a restore action', async ({ page }) => {
  await routeCommands(page, [])
  await mockAutomationApi(page, { killSwitchForced: true })
  await page.goto('/?workspace=w1')

  await expect(page.getByText('由环境变量强制暂停')).toBeVisible()
  await expect(page.getByTestId('automation-status').getByText('自动化已暂停')).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复' })).toHaveCount(0)
})

test('keeps the supervisor panel as a chat stream', async ({ page }) => {
  await routeCommands(page, [])
  await mockAutomationApi(page)
  await page.goto('/?workspace=w1')

  await expect(page.getByLabel('总管对话')).toBeVisible()
  await expect(page.getByRole('heading', { name: '本轮汇报' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '生成汇报' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '历史' })).toHaveCount(0)
  await expect(page.getByText('待我处理 1')).toHaveCount(0)
})

test('batch starts todo tasks and shows task automation', async ({ page }) => {
  const commands: Array<Record<string, unknown>> = []
  await routeCommands(page, commands)
  await mockAutomationApi(page)
  await page.goto('/?workspace=w1')

  await page.getByRole('button', { name: '任务', exact: true }).click()
  await page.getByRole('button', { name: '批量开工' }).click()
  await page.getByRole('checkbox', { name: '选择 任务一' }).check()
  await page.getByRole('checkbox', { name: '选择 任务二' }).check()
  await page.getByRole('button', { name: '开工 2 个' }).click()

  await expect
    .poll(() => commands.filter((command) => command.type === 'task.enqueue').length)
    .toBe(2)
  const enqueued = commands
    .filter((command) => command.type === 'task.enqueue')
    .map((command) => (command.payload as { taskId: string }).taskId)
  expect(enqueued).toEqual(['t1', 't2'])

  await page.locator('#task-board').getByText('任务一').click()
  await expect(page.getByTestId('task-automation')).toContainText('自动批准 1 次')
  await expect(page.getByTestId('task-automation')).toContainText('自动重试 1 次')

  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '任务', exact: true }).click()
  await page.locator('#task-board').getByText('任务二').click()
  await expect(page.getByTestId('task-automation')).toContainText('本任务没有自动决策')
})

test('selects all todos up to the limit and reports partial failure', async ({ page }) => {
  const commands: Array<Record<string, unknown>> = []
  await routeCommands(page, commands, ['t2'])
  await mockAutomationApi(page, { taskCount: 21 })
  await page.goto('/?workspace=w1')

  await page.getByRole('button', { name: '任务', exact: true }).click()
  await page.getByRole('button', { name: '批量开工' }).click()
  await page.getByRole('button', { name: '全选待办' }).click()
  await expect(page.getByRole('button', { name: '开工 20 个' })).toBeEnabled()
  await expect(page.getByRole('checkbox', { name: '选择 任务21' })).not.toBeChecked()

  await page.getByRole('button', { name: '开工 20 个' }).click()
  await expect(page.getByText('已开工 19 个，1 个失败')).toBeVisible()
  await expect
    .poll(() => commands.filter((command) => command.type === 'task.enqueue').length)
    .toBe(20)
})
