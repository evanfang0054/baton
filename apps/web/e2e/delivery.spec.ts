import { expect, test, type Page } from '@playwright/test'
import { wsRecorder } from './m6-helpers'

const stages = [
  { key: 'requirement', label: '需求', ordinal: 1, gate: 'human', status: 'waiting_person' },
  { key: 'design', label: '设计', ordinal: 2, gate: 'human', status: 'pending' },
  { key: 'build', label: '开发', ordinal: 3, gate: 'auto', status: 'pending' },
  { key: 'acceptance', label: '验收', ordinal: 4, gate: 'human', status: 'pending' },
].map((stage) => ({
  ...stage,
  taskId: stage.key === 'requirement' ? 't1' : null,
  taskStatus: stage.key === 'requirement' ? 'review' : null,
  attention: stage.key === 'requirement' ? 'needs_review' : 'none',
  waitingSince: stage.key === 'requirement' ? Date.now() - 10 * 60_000 : null,
  artifactCount: stage.key === 'requirement' ? 1 : 0,
  openAnnotationCount: 0,
  skillId: null,
  skillStatus: null,
}))

const delivery = {
  id: 'd1',
  workspaceId: 'w1',
  canvasId: 'c1',
  title: '优惠券领取页',
  goal: '做一个可用的领取页',
  playbookId: 'standard-delivery',
  playbookVersion: 1,
  status: 'waiting_person',
  currentStageKey: 'requirement',
  stageProgress: { done: 0, total: 4 },
  stages,
  attention: 'needs_review',
  waitingSince: Date.now() - 10 * 60_000,
  openAnnotationCount: 2,
  createdAt: 1,
  updatedAt: 2,
  cancelledAt: null,
}

const detail = {
  ...delivery,
  playbook: {
    id: 'standard-delivery',
    version: 1,
    label: '标准交付',
    stages: stages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      gate: stage.gate,
      skill: null,
      produces: [],
      acceptance: { checklist: ['目标清楚'], verify: true },
    })),
  },
  artifacts: [
    {
      id: 'a1',
      workspaceId: 'w1',
      deliveryId: 'd1',
      stageKey: 'requirement',
      taskId: null,
      kind: 'spec',
      name: 'spec.md',
      path: '.baton/deliveries/d1/requirement/spec.md',
      sourcePath: null,
      svgPath: null,
      mime: 'text/markdown',
      size: 10,
      sha256: '0'.repeat(64),
      version: 1,
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  annotations: [],
}

const canvas = {
  canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
  edges: [],
  nodes: [
    ...stages.map((stage, index) => ({
      id: `g${index}`,
      canvasId: 'c1',
      type: 'group',
      x: 80 + index * 540,
      y: 160,
      w: 480,
      h: 360,
      groupId: null,
      data: { label: `${index + 1} ${stage.label}`, collapsed: false, stageKey: stage.key },
      createdAt: 1,
      updatedAt: 1,
    })),
    {
      id: 'n1',
      canvasId: 'c1',
      type: 'agent',
      x: 120,
      y: 240,
      w: 320,
      h: 200,
      groupId: 'g0',
      data: { title: '需求 Agent', engine: 'claude-sdk', taskId: 't1' },
      createdAt: 1,
      updatedAt: 1,
    },
  ],
}

function json(body: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }
}

function mockDeliveryApi(page: Page) {
  const specArtifact = detail.artifacts[0]!
  const state = {
    cancelled: false,
    cancelCalls: 0,
    artifacts: [specArtifact] as Array<typeof specArtifact>,
  }
  const current = () =>
    state.cancelled
      ? {
          ...delivery,
          status: 'cancelled',
          currentStageKey: null,
          attention: 'none',
          cancelledAt: 1,
          stages: delivery.stages.map((stage) =>
            stage.key === 'requirement'
              ? { ...stage, status: 'cancelled', taskStatus: 'cancelled', attention: 'none' }
              : stage,
          ),
        }
      : delivery
  const currentDetail = () => ({ ...detail, ...current() })
  const currentTask = () => ({
    ...current(),
    id: 't1',
    nodeId: 'n1',
    title: '需求：优惠券领取页',
    prompt: '',
    status: state.cancelled ? 'cancelled' : 'review',
    waitingReason: null,
    engine: 'claude-sdk',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    retryCount: 0,
    dangerouslySkipPermissions: false,
    enqueuedAt: null,
    deliveryId: 'd1',
    stageKey: 'requirement',
    attention: state.cancelled ? 'none' : 'needs_review',
    waitingSince: 2,
    acceptance: null,
  })

  page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (route.request().method() === 'POST' && path === '/api/deliveries/d1/cancel') {
      state.cancelCalls += 1
      state.cancelled = true
      return route.fulfill(json({ taskId: 't1' }))
    }
    if (path === '/api/workspaces') {
      return route.fulfill(
        json({
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
        }),
      )
    }
    if (path === '/api/deliveries') return route.fulfill(json({ deliveries: [current()] }))
    if (path === '/api/deliveries/d1') return route.fulfill(json({ delivery: currentDetail() }))
    if (
      route.request().method() === 'POST' &&
      path === '/api/deliveries/d1/stages/requirement/artifacts'
    ) {
      const artifact = {
        ...specArtifact,
        id: 'a2',
        kind: 'drawing',
        name: 'drawing-test.png',
        mime: 'image/png',
        status: 'draft',
        size: 0,
      }
      state.artifacts.push(artifact)
      return route.fulfill(json({ artifact }))
    }
    if (path === '/api/deliveries/d1/artifacts')
      return route.fulfill(json({ artifacts: state.artifacts }))
    if (path === '/api/tasks') return route.fulfill(json({ tasks: [currentTask()] }))
    if (path === '/api/canvas') return route.fulfill(json(canvas))
    if (path === '/api/automation') return route.fulfill(json({ killSwitch: false, summary: null }))
    if (path === '/api/notices') return route.fulfill(json({ notices: [] }))
    if (path === '/api/supervisor/status') {
      return route.fulfill(json({ configured: false, policyVersion: 'p1' }))
    }
    if (path === '/api/supervisor/messages') {
      return route.fulfill(json({ threadId: 'th1', messages: [] }))
    }
    return route.fulfill(json({}))
  })
  return state
}

test('delivery board opens the canvas and annotation overlay', async ({ page }) => {
  await page.routeWebSocket('**/ws', wsRecorder([], { compact: true, skipResumeAck: true }))
  mockDeliveryApi(page)

  await page.goto('/?workspace=w1&delivery=d1')
  await expect(page.getByText('优惠券领取页').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '标注 2' })).toBeVisible()
  await expect(page.getByText('1 需求').first()).toBeVisible()
  await page.getByRole('button', { name: '快速标注' }).click()
  await expect(page.getByRole('application', { name: '快速标注层' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('application', { name: '快速标注层' })).toBeHidden()
})

test('creates a drawing board from the delivery canvas', async ({ page }) => {
  await page.routeWebSocket('**/ws', wsRecorder([], { compact: true, skipResumeAck: true }))
  mockDeliveryApi(page)

  await page.goto('/?workspace=w1&delivery=d1')
  await expect(page.getByText('优惠券领取页').first()).toBeVisible()
  // 画布数据到达后 createDrawing 才有 canvasId；先等阶段分组渲染。
  await expect(page.getByText('1 需求').first()).toBeVisible()
  await page.getByRole('button', { name: '新建画板' }).click()
  await expect(page.getByText('画板 · drawing-test.png')).toBeVisible({ timeout: 15_000 })
})

test('stops a delivery after confirmation', async ({ page }) => {
  await page.routeWebSocket('**/ws', wsRecorder([], { compact: true, skipResumeAck: true }))
  const state = mockDeliveryApi(page)

  await page.goto('/?workspace=w1&delivery=d1')
  await expect(page.getByText('优惠券领取页').first()).toBeVisible()
  await page.getByRole('button', { name: '停止交付', exact: true }).first().click()
  await expect(page.getByText('停止这条交付？')).toBeVisible()
  await page.getByRole('button', { name: '确认停止' }).click()

  await expect.poll(() => state.cancelCalls).toBe(1)
  await expect(page.getByText('已取消').first()).toBeVisible()
})
