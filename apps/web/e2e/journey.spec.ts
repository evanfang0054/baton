import { expect, test } from '@playwright/test'

test('trusts a workspace and resolves an approval card', async ({ page }) => {
  let trusted = false
  let decided = false

  await page.routeWebSocket('**/ws', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string }
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
    const url = new URL(route.request().url())
    const path = url.pathname

    if (path === '/api/workspaces') {
      return route.fulfill({
        json: {
          workspaces: [
            {
              id: 'w1',
              name: 'demo',
              relPath: 'demo',
              trusted,
              projectHooks: 'off',
              trustedAt: trusted ? 2 : null,
              createdAt: 1,
            },
          ],
        },
      })
    }
    if (path === '/api/workspaces/w1/trust') {
      trusted = true
      return route.fulfill({
        json: {
          workspace: {
            id: 'w1',
            name: 'demo',
            relPath: 'demo',
            trusted: true,
            projectHooks: 'off',
            trustedAt: 2,
            createdAt: 1,
          },
        },
      })
    }
    if (path === '/api/engines') {
      return route.fulfill({
        json: {
          engines: [{ engine: 'claude-sdk', status: 'unknown', reason: 'reusing local login' }],
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
              title: '真实任务',
              prompt: '',
              status: decided ? 'running' : 'waiting_input',
              waitingReason: decided ? null : 'approval',
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
              attention: decided ? 'none' : 'needs_approval',
              waitingSince: decided ? null : 2,
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
            title: '真实任务',
            prompt: '',
            status: decided ? 'running' : 'waiting_input',
            waitingReason: decided ? null : 'approval',
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
          },
          sessions: [],
          approvals: decided
            ? [
                {
                  id: 'a1',
                  sessionId: 's1',
                  request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
                  decision: 'allow',
                  decidedBy: 'user',
                  decidedAt: 3,
                  response: null,
                },
              ]
            : [
                {
                  id: 'a1',
                  sessionId: 's1',
                  request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
                  decision: null,
                  decidedBy: null,
                  decidedAt: null,
                  response: null,
                },
              ],
          review: null,
          waitingSince: decided ? null : 2,
          attention: decided ? 'none' : 'needs_approval',
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
    return route.fulfill({ json: {} })
  })

  await page.goto('/?workspace=w1&task=t1')

  await expect(page.getByText('信任此工作区？')).toBeVisible()
  await page.getByRole('button', { name: '信任并加载' }).click()
  await expect(page.getByText('已信任')).toBeVisible()

  await expect(page.getByText('需要授权')).toBeVisible()
  decided = true
  await page.getByRole('button', { name: '允许' }).click()
  await expect(page.getByText('需要授权')).toHaveCount(0)
})
