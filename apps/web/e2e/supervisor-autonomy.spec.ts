import { expect, test } from '@playwright/test'

const workspace = {
  id: 'w1',
  name: 'demo',
  relPath: 'demo',
  trusted: true,
  projectHooks: 'off',
  trustedAt: 1,
  createdAt: 1,
}

const plan = {
  triggerId: 'trigger-1',
  source: { nodeIds: ['n1'] },
  templateId: 'bugfix',
  contextDigest: [],
  items: [
    {
      title: '修复登录',
      templateId: 'bugfix',
      targetNodeId: null,
      agentTitle: 'Agent 1',
      contextNodeIds: ['n1'],
      engine: null,
    },
  ],
}

const message = {
  id: 'm1',
  threadId: 'th1',
  role: 'assistant',
  content: '这是计划，请确认。',
  toolCalls: [
    {
      id: 'tc-plan',
      name: 'plan_tasks',
      args: {},
      ok: true,
      result: { actionId: 'a1', status: 'proposed', plan },
    },
  ],
  decision: null,
  meta: null,
  status: 'ok',
  error: null,
  createdAt: 2,
}

test('plan card applies through WS and shows created count', async ({ page }) => {
  let applied = false
  let applies = 0
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const command = JSON.parse(String(raw)) as {
        id?: string
        type?: string
        payload?: { decision?: string }
      }
      if (!command.id) return
      if (command.type === 'supervisor.action.decide' && command.payload?.decision === 'apply') {
        applied = true
        applies += 1
      }
      if (command.type !== 'resume') {
        ws.send(
          JSON.stringify({
            v: 1,
            id: `ack-${command.id}`,
            type: 'ack',
            ts: Date.now(),
            payload: { commandId: command.id, ok: true, data: {} },
          }),
        )
      }
    })
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
    if (path === '/api/engines') return route.fulfill({ json: { engines: [] } })
    if (path === '/api/supervisor/status') {
      return route.fulfill({
        json: { configured: true, mode: 'explicit', policyVersion: 'p1' },
      })
    }
    if (path === '/api/supervisor/messages') {
      return route.fulfill({ json: { threadId: 'th1', messages: [message] } })
    }
    if (path === '/api/supervisor/actions/a1') {
      return route.fulfill({
        json: {
          action: {
            id: 'a1',
            workspaceId: 'w1',
            threadId: 'th1',
            taskId: null,
            kind: 'triage_plan',
            status: applied ? 'applied' : 'proposed',
            strength: 'inferred',
            mode: 'observe',
            reason: '计划',
            payload: plan,
            result: applied ? { createdTaskIds: ['t1'], failed: [] } : null,
            policyVersion: 'p1',
            mandateVersion: null,
            dedupeKey: 'plan:1',
            createdAt: 1,
            updatedAt: 2,
            expiresAt: 100,
            appliedAt: applied ? 2 : null,
            ignoredAt: null,
          },
        },
      })
    }
    return route.fulfill({ status: 404, json: { code: 'not_found', message: 'not found' } })
  })

  await page.goto('/')
  await expect(page.getByText('计划：1 个任务')).toBeVisible()
  await page.getByRole('button', { name: '应用全部' }).click()
  await expect(page.getByText(/已创建 1 个/)).toBeVisible()
  expect(applies).toBe(1)
  await expect(page.getByRole('button', { name: '应用全部' })).toHaveCount(0)
})

function digestReport(attention: unknown[]) {
  return {
    workspaceId: 'w1',
    windowStart: 0,
    windowEnd: 2,
    generatedAt: 2,
    policyVersion: 'p1',
    snapshot: {
      total: 1,
      unplanned: 0,
      todo: 0,
      running: 0,
      waiting: 0,
      review: 0,
      done: 0,
      closed: 0,
      attention: { needsApproval: 0, needsReply: 0, needsAttention: 1, needsReview: 0 },
    },
    ready: [],
    blocked: [],
    dropped: [],
    changes: {
      created: 0,
      updated: 1,
      completed: 0,
      failed: 1,
      cancelled: 0,
      retried: 0,
      autoAllowed: 0,
      autoDenied: 0,
    },
    attention: {
      items: attention,
      counts: { approval: 0, reply: 0, review: 0, failed: 1, stale: 0 },
    },
    oldestWaiting: null,
  }
}

function digestNotice(attention: unknown[]) {
  return {
    id: 'n1',
    workspaceId: 'w1',
    ts: 2,
    kind: 'digest',
    payload: digestReport(attention),
    readAt: 1,
  }
}

const failedTask = {
  id: 't1',
  workspaceId: 'w1',
  nodeId: 'a1',
  title: '失败的登录修复',
  prompt: '<task>SECRET_TRANSCRIPT_SHOULD_NOT_APPEAR</task>',
  status: 'failed',
  waitingReason: null,
  engine: 'claude-sdk',
  workspaceMode: 'main',
  branch: null,
  worktreePath: null,
  verifyCommand: 'pnpm test',
  dangerouslySkipPermissions: false,
  enqueuedAt: null,
  retryCount: 1,
  createdAt: 1,
  updatedAt: 2,
  attention: 'needs_attention',
  waitingSince: 2,
  acceptance: null,
}

const failedDetail = {
  task: {
    ...failedTask,
    context: null,
    origin: null,
  },
  contextInvalid: false,
  originInvalid: false,
  sessions: [],
  approvals: [],
  review: null,
  waitingSince: 2,
  attention: 'needs_attention',
  acceptance: null,
  lastFailure: {
    stage: 'verify',
    lastError: 'pnpm test failed at <workspace>/src/login.ts',
    retryable: true,
    affectedPaths: ['src/login.ts'],
    summary: '自动校验未通过',
    createdAt: 2,
  },
}

async function mockShell(
  page: import('@playwright/test').Page,
  options: {
    tasks?: () => unknown[]
    notices?: () => unknown[]
    taskDetail?: () => unknown
    automation?: unknown
  } = {},
) {
  const tasks = options.tasks ?? (() => [])
  const notices = options.notices ?? (() => [])
  const taskDetail = options.taskDetail ?? (() => failedDetail)
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/workspaces') return route.fulfill({ json: { workspaces: [workspace] } })
    if (path === '/api/canvas') {
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: [],
          edges: [],
        },
      })
    }
    if (path === '/api/tasks') return route.fulfill({ json: { tasks: tasks() } })
    if (path === '/api/engines') return route.fulfill({ json: { engines: [] } })
    if (path === '/api/supervisor/status') {
      return route.fulfill({ json: { configured: true, mode: 'explicit', policyVersion: 'p1' } })
    }
    if (path === '/api/supervisor/messages') {
      return route.fulfill({ json: { threadId: 'th1', messages: [] } })
    }
    if (path === '/api/notices') return route.fulfill({ json: { notices: notices() } })
    if (/^\/api\/notices\/[^/]+\/read$/.test(path)) {
      return route.fulfill({ json: { notice: notices()[0] ?? null } })
    }
    if (path === '/api/tasks/t1') return route.fulfill({ json: taskDetail() })
    if (path === '/api/tasks/t1/acceptance') {
      return route.fulfill({
        status: 404,
        json: { code: 'acceptance_not_found', message: 'acceptance not found' },
      })
    }
    if (path === '/api/tasks/t1/automation') {
      return route.fulfill({
        json: {
          taskId: 't1',
          retryCount: 1,
          lastVerifyExitCode: 1,
          lastPolicyVersion: null,
          autoDecisions: [],
        },
      })
    }
    if (path === '/api/workspaces/w1/automation' && options.automation) {
      return route.fulfill({ json: options.automation })
    }
    return route.fulfill({ status: 404, json: { code: 'not_found', message: 'not found' } })
  })
}

test('observe proposal applies only through the human digest action', async ({ page }) => {
  const commands: string[] = []
  let attention: unknown[] = [
    {
      taskId: 't1',
      title: '失败的登录修复',
      kind: 'failed',
      reason: '运行失败，建议重试',
      waitingSince: 2,
      proposalId: 'act-1',
      action: { type: 'apply_proposal', proposalId: 'act-1' },
    },
  ]
  let tasks: unknown[] = [failedTask]
  await mockShell(page, { tasks: () => tasks, notices: () => [digestNotice(attention)] })
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string }
      if (!message.id) return
      if (message.type !== 'resume') commands.push(message.type ?? '')
      if (message.type === 'supervisor.action.decide') {
        attention = []
        tasks = [{ ...failedTask, status: 'queued', title: '重试中的登录修复' }]
      }
      if (message.type !== 'resume') {
        ws.send(
          JSON.stringify({
            v: 1,
            id: `ack-${message.id}`,
            type: 'ack',
            ts: Date.now(),
            payload: { commandId: message.id, ok: true, data: {} },
          }),
        )
      }
    })
  })

  await page.goto('/?workspace=w1')
  await expect(page.getByLabel('需要你决定')).toBeVisible()
  await page.getByRole('button', { name: '应用建议' }).click()
  await expect.poll(() => commands).toContain('supervisor.action.decide')
  await expect(page.getByLabel('需要你决定')).toHaveCount(0)
  await page.getByRole('button', { name: '任务', exact: true }).click()
  await expect(page.getByTestId('task-board-overlay').getByText('重试中的登录修复')).toBeVisible()
})

test('mandate_revoked asks for reauthorize before retrying again', async ({ page }) => {
  const commands: string[] = []
  let retries = 0
  await mockShell(page, { tasks: () => [failedTask], taskDetail: () => failedDetail })
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string }
      if (!message.id) return
      if (message.type !== 'resume') commands.push(message.type ?? '')
      if (message.type === 'task.retry') {
        retries += 1
        if (retries === 1) {
          ws.send(
            JSON.stringify({
              v: 1,
              id: `err-${message.id}`,
              type: 'error',
              ts: Date.now(),
              payload: {
                commandId: message.id,
                code: 'mandate_revoked',
                message: '授权已失效',
              },
            }),
          )
          return
        }
      }
      if (message.type !== 'resume') {
        ws.send(
          JSON.stringify({
            v: 1,
            id: `ack-${message.id}`,
            type: 'ack',
            ts: Date.now(),
            payload: { commandId: message.id, ok: true, data: {} },
          }),
        )
      }
    })
  })

  await page.goto('/?workspace=w1&task=t1')
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByRole('button', { name: '确认重试' }).click()
  await page.getByRole('button', { name: '重新授权并继续' }).click()
  await expect.poll(() => commands).toContain('task.reauthorize')
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByRole('button', { name: '确认重试' }).click()
  await expect.poll(() => commands.filter((type) => type === 'task.retry')).toHaveLength(2)
})

test('task detail shows the failure summary without transcript text', async ({ page }) => {
  await mockShell(page, { tasks: () => [failedTask] })
  await page.goto('/?workspace=w1&task=t1')
  await expect(page.getByLabel('最近失败')).toBeVisible()
  await expect(page.getByText('自动校验', { exact: true })).toBeVisible()
  await expect(page.getByText('自动校验未通过')).toBeVisible()
  await expect(page.getByText('src/login.ts', { exact: true })).toBeVisible()
  await expect(page.getByText('SECRET_TRANSCRIPT_SHOULD_NOT_APPEAR')).toHaveCount(0)
})

test('kill switch keeps proposals visible and sends no automatic retry', async ({ page }) => {
  const commands: string[] = []
  await mockShell(page, {
    tasks: () => [failedTask],
    notices: () => [
      digestNotice([
        {
          taskId: 't1',
          title: '失败的登录修复',
          kind: 'failed',
          reason: '运行失败，建议重试',
          waitingSince: 2,
          proposalId: 'act-1',
          action: { type: 'apply_proposal', proposalId: 'act-1' },
        },
      ]),
    ],
    automation: {
      workspaceId: 'w1',
      trusted: true,
      policy: {
        verify: { command: 'pnpm test', timeoutSec: 900, maxOutputBytes: 262144 },
        approval: { default: 'ask', allow: ['Read'], deny: [], autoApproveMaxRisk: 'low' },
        autopilot: { enabled: true, retryMax: 2, digestCron: '0 9,21 * * *' },
        autonomy: { mode: 'auto', autoRetry: 'auto', attentionReminder: 'auto' },
      },
      policyVersion: 'p1',
      killSwitch: true,
      killSwitchForced: false,
      digestCronUnsupported: false,
    },
  })
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string }
      if (!message.id || message.type === 'resume') return
      commands.push(message.type ?? '')
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

  await page.goto('/?workspace=w1')
  await expect(page.getByLabel('需要你决定')).toBeVisible()
  await page.waitForTimeout(400)
  expect(commands).not.toContain('task.retry')
})
