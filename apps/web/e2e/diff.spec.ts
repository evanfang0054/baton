import { expect, test, type Page } from '@playwright/test'

const review = {
  id: 'r1',
  taskId: 't1',
  verdict: null,
  verifyExitCode: 0,
  verifyOutput: 'verify ok',
  diffStat: { filesChanged: 2, insertions: 1, deletions: 1 },
  decidedAt: null,
  diffAvailable: true,
}

const snapshot = {
  reviewId: 'r1',
  taskId: 't1',
  snapshot: {
    v: 1,
    capturedAt: 1,
    baseRef: 'HEAD',
    truncated: true,
    files: [
      {
        path: 'a.txt',
        status: 'modified',
        insertions: 1,
        deletions: 1,
        patch: '@@ -1 +1 @@\n-old\n+new',
      },
      { path: 'b.bin', status: 'binary', insertions: 0, deletions: 0, patch: '' },
    ],
  },
}

async function mockWorkspace(page: Page) {
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
              title: 'diff 任务',
              prompt: '',
              status: 'review',
              waitingReason: null,
              engine: 'fake',
              workspaceMode: 'main',
              branch: null,
              worktreePath: null,
              verifyCommand: null,
              dangerouslySkipPermissions: false,
              enqueuedAt: null,
              retryCount: 0,
              createdAt: 1,
              updatedAt: 2,
              attention: 'needs_review',
              waitingSince: 2,
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
            title: 'diff 任务',
            prompt: '',
            status: 'review',
            waitingReason: null,
            engine: 'fake',
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
          },
          sessions: [],
          approvals: [],
          review,
          waitingSince: 2,
          attention: 'needs_review',
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
          lastVerifyExitCode: 0,
          lastPolicyVersion: null,
          autoDecisions: [],
        },
      })
    }
    if (path === '/api/reviews/r1/diff') return route.fulfill({ json: snapshot })
    return route.fulfill({ json: {} })
  })
}

test('opens the diff viewer on desktop', async ({ page }) => {
  await mockWorkspace(page)
  await page.goto('/?workspace=w1&task=t1')

  await expect(page.getByRole('button', { name: '查看改动' })).toBeVisible()
  await page.getByRole('button', { name: '查看改动' }).click()

  const dialog = page.getByRole('dialog', { name: '改动详情' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('a.txt')).toBeVisible()
  await expect(dialog.getByText('+new')).toBeVisible()
  await expect(dialog.getByText('-old')).toBeVisible()
  await expect(dialog.getByText(/已截断/)).toBeVisible()
  await expect(dialog.getByText('b.bin')).toBeVisible()
  await expect(dialog.getByText(/二进制文件/)).toBeVisible()

  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).toHaveCount(0)
})

test('uses a full-screen sheet on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockWorkspace(page)
  await page.goto('/?workspace=w1&task=t1')

  await page.getByRole('button', { name: '查看改动' }).click()
  const dialog = page.getByRole('dialog', { name: '改动详情' })
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box?.width).toBeGreaterThan(380)
})
