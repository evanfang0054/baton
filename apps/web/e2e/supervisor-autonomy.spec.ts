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
      budgetUsd: null,
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
  await page.getByRole('tab', { name: '总管' }).click()
  await expect(page.getByText('计划：1 个任务')).toBeVisible()
  await page.getByRole('button', { name: '应用全部' }).click()
  await expect(page.getByText(/已创建 1 个/)).toBeVisible()
})
