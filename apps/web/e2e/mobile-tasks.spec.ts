import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

type Sent = { type: string; payload: Record<string, unknown> }

async function mockWorkspace(page: Page, sent: Sent[]) {
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
          payload: { commandId: message.id, ok: true, data: { cursor: 0, hasMore: false } },
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
          nodes: [],
          edges: [],
        },
      })
    }
    if (path === '/api/workspaces/w1/automation') {
      return route.fulfill({
        json: {
          workspaceId: 'w1',
          trusted: true,
          policy: {},
          policyVersion: 'p1',
          killSwitch: false,
          killSwitchForced: false,
          digestCronUnsupported: false,
        },
      })
    }
    if (path === '/api/notices') return route.fulfill({ json: { notices: [] } })
    return route.fulfill({ json: {} })
  })
}

test('approves a waiting task on mobile', async ({ page }) => {
  const sent: Sent[] = []
  let approved = false
  await mockWorkspace(page, sent)

  await page.route(/\/api\/tasks(\?.*)?$/, async (route) => {
    return route.fulfill({
      json: {
        tasks: [
          {
            id: 't1',
            workspaceId: 'w1',
            nodeId: 'n1',
            title: '移动审批',
            prompt: '',
            status: approved ? 'running' : 'waiting_input',
            waitingReason: approved ? null : 'approval',
            engine: 'fake',
            workspaceMode: 'main',
            branch: null,
            worktreePath: null,
            verifyCommand: null,
            dangerouslySkipPermissions: false,
            retryCount: 0,
            createdAt: 1,
            updatedAt: 2,
            attention: approved ? 'none' : 'needs_approval',
            waitingSince: approved ? null : 2,
          },
        ],
      },
    })
  })

  await page.route(/\/api\/tasks\/t1$/, async (route) => {
    return route.fulfill({
      json: {
        task: {
          id: 't1',
          workspaceId: 'w1',
          nodeId: 'n1',
          title: '移动审批',
          prompt: '',
          status: approved ? 'running' : 'waiting_input',
          waitingReason: approved ? null : 'approval',
          engine: 'fake',
          workspaceMode: 'main',
          branch: null,
          worktreePath: null,
          verifyCommand: null,
          dangerouslySkipPermissions: false,
          retryCount: 0,
          createdAt: 1,
          updatedAt: 2,
          context: null,
          origin: null,
        },
        sessions: [],
        approvals: [
          {
            id: 'a1',
            sessionId: 's1',
            request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
            decision: approved ? 'allow' : null,
            decidedBy: approved ? 'user' : null,
            decidedAt: approved ? 3 : null,
            response: null,
          },
        ],
        review: null,
        waitingSince: approved ? null : 2,
        attention: approved ? 'none' : 'needs_approval',
        contextInvalid: false,
        originInvalid: false,
      },
    })
  })

  await page.route(/\/api\/tasks\/t1\/automation$/, (route) =>
    route.fulfill({
      json: {
        taskId: 't1',
        retryCount: 0,
        lastVerifyExitCode: null,
        lastPolicyVersion: null,
        autoDecisions: [],
      },
    }),
  )

  await page.goto('/')
  await expect(page.getByTestId('mobile-board')).toBeVisible()
  await page.getByRole('button', { name: /移动审批/ }).click()
  await expect(page.getByTestId('mobile-task-detail')).toBeVisible()
  await expect(page.getByText('需要授权')).toBeVisible()

  approved = true
  await page.getByRole('button', { name: '允许' }).click()
  await expect(page.getByText('需要授权')).toHaveCount(0)
})

test('batch starts two todo tasks', async ({ page }) => {
  const sent: Sent[] = []
  await mockWorkspace(page, sent)

  await page.route(/\/api\/tasks(\?.*)?$/, async (route) => {
    return route.fulfill({
      json: {
        tasks: ['t1', 't2'].map((id, index) => ({
          id,
          workspaceId: 'w1',
          nodeId: `n${index}`,
          title: `待办 ${index + 1}`,
          prompt: '',
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
          attention: 'none',
          waitingSince: null,
        })),
      },
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '选择待办' }).click()
  await page.getByRole('checkbox', { name: '选择 待办 1' }).check()
  await page.getByRole('checkbox', { name: '选择 待办 2' }).check()
  await page.getByRole('button', { name: '开工 2 个' }).click()

  await expect
    .poll(() =>
      sent
        .filter((item) => item.type === 'task.enqueue')
        .map((item) => item.payload.taskId)
        .sort(),
    )
    .toEqual(['t1', 't2'])
})
