import { expect, test, type Page } from '@playwright/test'
import {
  acceptanceBundle,
  acceptanceSummary,
  agentNode,
  mockWorkspace,
  sceneDetail,
  task,
  textNode,
} from './m6-helpers'

type WsRoute = Parameters<Parameters<Page['routeWebSocket']>[1]>[0]

function wsRecorder(commands: Array<{ type?: string; payload?: unknown }>) {
  return (ws: WsRoute) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { id?: string; type?: string; payload?: unknown }
      if (!message.id) return
      commands.push(message)
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
  }
}

test('injects selected node into a waiting task from the canvas', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', wsRecorder(commands))

  const detail = sceneDetail()
  detail.task = {
    ...detail.task,
    status: 'waiting_input',
    waitingReason: 'question',
  }
  detail.attention = 'needs_reply'
  detail.review = null
  detail.waitingSince = Date.now()

  const waiting = task({
    id: 't1',
    nodeId: 'a1',
    title: '等待输入的任务',
    status: 'waiting_input',
    waitingReason: 'question',
    attention: 'needs_reply',
    waitingSince: Date.now(),
  })
  await mockWorkspace(page, {
    nodes: [textNode('n1', 80, 80), agentNode('a1', 420, 80)],
    tasks: [waiting],
    taskDetail: detail,
  })

  await page.goto('/?workspace=w1')
  await page.locator('.react-flow__node[data-id="n1"]').click()
  await page.getByRole('button', { name: '投喂给任务' }).click()
  await expect(page.getByRole('heading', { name: '投喂给任务' })).toBeVisible()
  await page.getByLabel('投喂说明').fill('补充报错')
  await page.getByRole('button', { name: '投喂', exact: true }).click()

  await expect
    .poll(() => commands.find((command) => command.type === 'context.inject')?.payload)
    .toEqual({ taskId: 't1', nodeIds: ['n1'], note: '补充报错' })
})

test('rejects with the current canvas selection', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', wsRecorder(commands))

  const detail = sceneDetail()
  detail.review = detail.review ? { ...detail.review, verifyExitCode: 1 } : null

  await mockWorkspace(page, {
    nodes: [textNode('n1', 80, 80), agentNode('a1', 420, 80)],
    tasks: [task({ id: 't1', nodeId: 'a1', title: '待验收任务' })],
    taskDetail: detail,
  })

  await page.goto('/?workspace=w1')
  await page.locator('.react-flow__node[data-id="n1"]').click()
  await page.getByRole('button', { name: '任务', exact: true }).click()
  await page.getByTestId('task-board').getByText('待验收任务').click()

  await page.getByRole('button', { name: '打回' }).click()
  await page.getByRole('checkbox', { name: /附带当前选中的 1 个节点/ }).check()
  await page.getByRole('button', { name: '确认打回' }).click()
  await expect
    .poll(() => commands.find((command) => command.type === 'review.decide')?.payload)
    .toEqual({ reviewId: 'r1', decision: 'reject', contextNodeIds: ['n1'] })
})

test('requires confirmation when passing a failed verify', async ({ page }) => {
  const commands: Array<{ type?: string; payload?: unknown }> = []
  await page.routeWebSocket('**/ws', wsRecorder(commands))

  const detail = sceneDetail()
  detail.review = detail.review ? { ...detail.review, verifyExitCode: 1 } : null
  const passSummary = acceptanceSummary({
    counts: { total: 1, pass: 1, fail: 0, pending: 0, waived: 0 },
    verdict: 'pass',
    topFailures: [],
  })

  await mockWorkspace(page, {
    nodes: [agentNode('a1', 420, 80)],
    tasks: [task({ id: 't1', nodeId: 'a1', title: '待验收任务', acceptance: passSummary })],
    taskDetail: detail,
    acceptance: acceptanceBundle({ acceptance: passSummary }),
  })

  await page.goto('/?workspace=w1')
  await page.getByRole('button', { name: '任务', exact: true }).click()
  await page.getByTestId('task-board').getByText('待验收任务').click()

  await page.getByRole('button', { name: '通过' }).click()
  await expect(page.getByText('校验未通过，仍要通过吗？')).toBeVisible()
  await page.getByLabel('通过理由').fill('已知问题，先合')
  await page.getByRole('button', { name: '确认通过' }).click()
  await expect
    .poll(() => commands.find((command) => command.type === 'review.decide')?.payload)
    .toEqual({ reviewId: 'r1', decision: 'approve', overrideReason: '已知问题，先合' })
})
