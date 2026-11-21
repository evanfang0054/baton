import { expect, test, type Page } from '@playwright/test'

async function mockWorkspace(page: Page, state: { worktreePath: string | null }) {
  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string }
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
    if (route.request().method() === 'POST' && path === '/api/tasks/t1/worktree/cleanup') {
      state.worktreePath = null
      return route.fulfill({ json: { ok: true } })
    }
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
    if (path === '/api/workspaces/w1/capabilities')
      return route.fulfill({ json: { worktree: true } })
    if (path === '/api/engines') {
      return route.fulfill({ json: { engines: [{ engine: 'fake', status: 'available' }] } })
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
              id: 't1',
              workspaceId: 'w1',
              nodeId: null,
              title: 'worktree 任务',
              prompt: '',
              status: 'done',
              waitingReason: null,
              engine: 'fake',
              workspaceMode: 'worktree',
              branch: null,
              worktreePath: state.worktreePath,
              verifyCommand: null,
              dangerouslySkipPermissions: false,
              enqueuedAt: null,
              retryCount: 0,
              createdAt: 1,
              updatedAt: 2,
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
          task: {
            id: 't1',
            workspaceId: 'w1',
            nodeId: null,
            title: 'worktree 任务',
            prompt: '',
            status: 'done',
            waitingReason: null,
            engine: 'fake',
            workspaceMode: 'worktree',
            branch: null,
            worktreePath: state.worktreePath,
            verifyCommand: null,
            dangerouslySkipPermissions: false,
            enqueuedAt: null,
            retryCount: 0,
            createdAt: 1,
            updatedAt: 2,
            context: null,
            origin: null,
          },
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
    return route.fulfill({ json: {} })
  })
}

test('shows the worktree badge and cleans it up on desktop', async ({ page }) => {
  const state = { worktreePath: '/tmp/baton-worktree/t1' }
  await mockWorkspace(page, state)
  await page.goto('/?workspace=w1&task=t1')

  await expect(page.getByText('独立工作树 · baton/t1')).toBeVisible()
  await page.getByRole('button', { name: '清理工作树' }).click()
  await page.getByRole('button', { name: '确认清理' }).click()

  await expect(page.getByTestId('worktree-card')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '清理工作树' })).toHaveCount(0)
})

test('keeps the worktree info but hides cleanup on mobile', async ({ page }) => {
  const state = { worktreePath: '/tmp/baton-worktree/t1' }
  await page.setViewportSize({ width: 390, height: 844 })
  await mockWorkspace(page, state)
  await page.goto('/?workspace=w1&task=t1')

  await expect(page.getByText('独立工作树 · baton/t1')).toBeVisible()
  await expect(page.getByRole('button', { name: '清理工作树' })).toHaveCount(0)
})
