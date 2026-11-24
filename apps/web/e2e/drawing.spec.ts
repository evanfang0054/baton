import { expect, test, type Page } from '@playwright/test'
import { mockDelivery, mockDeliveryDetail } from './m6-helpers'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const artifact = {
  id: 'a1',
  workspaceId: 'w1',
  deliveryId: 'd1',
  stageKey: 'requirement',
  taskId: null,
  kind: 'drawing',
  name: '流程草图.png',
  path: '.baton/deliveries/d1/requirement/drawing-1.png',
  sourcePath: '.baton/deliveries/d1/requirement/drawing-1.excalidraw',
  svgPath: null,
  mime: 'image/png',
  size: 10,
  sha256: '0'.repeat(64),
  version: 1,
  status: 'ready',
  createdAt: 1,
  updatedAt: 1,
}

const scene = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  elements: [
    { id: 'box', type: 'rectangle', x: 20, y: 20, width: 200, height: 100 },
    { id: 'text-1', type: 'text', x: 40, y: 60, width: 120, height: 20, text: '入口' },
  ],
  appState: {},
  files: {},
})

function drawingNode(previewStale: boolean) {
  return {
    id: 'dw1',
    canvasId: 'c1',
    type: 'drawing',
    x: 80,
    y: 260,
    w: 360,
    h: 260,
    groupId: null,
    data: {
      artifactId: artifact.id,
      title: '流程草图',
      thumbnailPath: artifact.path,
      status: 'ready',
      previewStale,
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function assistantMessage() {
  return {
    id: 'm1',
    threadId: 'th1',
    role: 'assistant',
    content: '画板已更新。',
    toolCalls: [
      {
        id: 'tc1',
        name: 'create_drawing',
        args: {},
        ok: true,
        result: {
          artifactId: 'a1',
          deliveryId: 'd1',
          nodeId: 'dw1',
          title: '流程草图',
          elements: 2,
          texts: 1,
          previewStale: true,
        },
      },
    ],
    decision: null,
    meta: null,
    status: 'ok',
    error: null,
    createdAt: 2,
  }
}

async function mockDrawingApi(
  page: Page,
  options: { previewStale?: boolean; messages?: unknown[] } = {},
) {
  const saved: Array<Record<string, unknown>> = []
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()
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
    if (path === '/api/deliveries') {
      return route.fulfill({ json: { deliveries: [mockDelivery] } })
    }
    if (path === '/api/deliveries/d1') {
      return route.fulfill({
        json: { delivery: { ...mockDeliveryDetail, artifacts: [artifact] } },
      })
    }
    if (path === '/api/deliveries/d1/artifacts') {
      return route.fulfill({ json: { artifacts: [artifact] } })
    }
    if (path === '/api/deliveries/d1/artifacts/a1/content') {
      if (url.searchParams.get('variant') === 'source') {
        return route.fulfill({ json: JSON.parse(scene) })
      }
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 })
    }
    if (path === '/api/deliveries/d1/artifacts/a1' && method === 'PUT') {
      saved.push(route.request().postDataJSON() as Record<string, unknown>)
      return route.fulfill({ json: { artifact: { ...artifact, updatedAt: 2 } } })
    }
    if (path === '/api/attention') return route.fulfill({ json: { items: [], total: 0 } })
    if (path === '/api/canvas') {
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: [drawingNode(options.previewStale ?? false)],
          edges: [],
        },
      })
    }
    if (path === '/api/tasks') return route.fulfill({ json: { tasks: [] } })
    if (path === '/api/engines') {
      return route.fulfill({ json: { engines: [{ engine: 'claude-sdk', status: 'available' }] } })
    }
    if (path === '/api/notices') return route.fulfill({ json: { notices: [] } })
    if (path === '/api/supervisor/status') {
      return route.fulfill({
        json: { configured: true, model: 'demo', mode: 'explicit', policyVersion: 'p1' },
      })
    }
    if (path === '/api/supervisor/messages') {
      return route.fulfill({
        json: { threadId: 'th1', messages: options.messages ?? [] },
      })
    }
    return route.fulfill({ status: 404, json: { code: 'not_found', message: 'not found' } })
  })
  return saved
}

test('shows the drawing thumbnail, opens the editor, and survives reload', async ({ page }) => {
  await mockDrawingApi(page)
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
          payload: { commandId: message.id, ok: true, data: {} },
        }),
      )
    })
  })

  await page.goto('/?workspace=w1&delivery=d1')
  await expect(page.getByRole('img', { name: '画板缩略图 流程草图' })).toBeVisible()

  await page.locator('.react-flow__node[data-id="dw1"]').dblclick()
  await expect(page.getByText('画板 · 流程草图.png')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '保存并关闭' }).click()
  await expect(page.getByText('画板 · 流程草图.png')).toHaveCount(0, { timeout: 15_000 })

  await page.reload()
  await expect(page.getByRole('img', { name: '画板缩略图 流程草图' })).toBeVisible()
})

test('renders a supervisor drawing card and opens the board', async ({ page }) => {
  await mockDrawingApi(page, { messages: [assistantMessage()] })
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
          payload: { commandId: message.id, ok: true, data: {} },
        }),
      )
    })
  })

  await page.goto('/?workspace=w1&delivery=d1')
  await expect(page.getByText('画板已更新。')).toBeVisible()
  await expect(page.getByText('元素 2 个 · 文字 1 段 · 预览生成中')).toBeVisible()
  if (process.env.EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/05-supervisor-drawing-card.png` })
  }
  await page.getByRole('button', { name: '打开画板' }).click()
  await expect(page.getByText('画板 · 流程草图.png')).toBeVisible({ timeout: 15_000 })
})

test('shows a conflict banner when the supervisor updates the open board', async ({ page }) => {
  await mockDrawingApi(page)
  const socket: { send: ((data: string) => void) | null } = { send: null }
  await page.routeWebSocket('**/ws', (ws) => {
    socket.send = (data) => ws.send(data)
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string }
      if (!message.id) return
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

  await page.goto('/?workspace=w1&delivery=d1')
  await page.locator('.react-flow__node[data-id="dw1"]').dblclick()
  await expect(page.getByText('画板 · 流程草图.png')).toBeVisible({ timeout: 15_000 })
  await page.locator('.excalidraw').waitFor({ timeout: 15_000 })
  socket.send?.(
    JSON.stringify({
      v: 1,
      ts: Date.now(),
      seq: 1,
      type: 'artifact.updated',
      payload: {
        artifactId: 'a1',
        deliveryId: 'd1',
        stageKey: 'requirement',
        status: 'ready',
        previewStale: true,
      },
    }),
  )
  await expect(page.getByText('总管已更新这个画板')).toBeVisible()
  if (process.env.EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/06-drawing-conflict-banner.png` })
  }
  await page.getByRole('button', { name: '保留本地' }).click()
  await expect(page.getByText('总管已更新这个画板')).toHaveCount(0)
})

test('renders a stale thumbnail in the browser and saves a preview', async ({ page }) => {
  const saved = await mockDrawingApi(page, { previewStale: true })
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
          payload: { commandId: message.id, ok: true, data: {} },
        }),
      )
    })
  })

  await page.goto('/?workspace=w1&delivery=d1')
  await expect(page.getByText('画板已更新，缩略图刷新中')).toBeVisible()
  await expect
    .poll(() => saved.some((body) => body.mode === 'preview'), { timeout: 30_000 })
    .toBe(true)
})
