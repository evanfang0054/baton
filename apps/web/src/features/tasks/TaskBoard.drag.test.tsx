import type { TaskSummary } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskBoard } from './TaskBoard'

const { send } = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('../../lib/command-context', () => ({ useCommand: () => send }))
vi.mock('../../lib/api', () => ({ getTask: vi.fn() }))
vi.mock('@heroui/react/toast', () => ({
  toast: { info: vi.fn(), success: vi.fn(), danger: vi.fn() },
}))

const originalElementFromPoint = document.elementFromPoint

function task(id: string, title: string, overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    workspaceId: 'w1',
    nodeId: `n-${id}`,
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
    budgetUsd: null,
    enqueuedAt: null,
    retryCount: 0,
    createdAt: 1,
    updatedAt: 1,
    attention: 'none',
    waitingSince: null,
    acceptance: null,
    budget: null,
    ...overrides,
  }
}

function renderBoard(tasks: TaskSummary[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TaskBoard
        tasks={tasks}
        agentNodes={[]}
        selectedTaskId={null}
        expanded
        pinned={false}
        onSelectTask={() => {}}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  )
}

function pointAt(column: string) {
  const target = document.querySelector(`[data-column="${column}"]`)
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => target,
  })
}

async function dragAfterLongPress(taskId: string) {
  const card = screen.getByTestId(`task-card-${taskId}`)
  firePointer('pointerdown', card, { pointerId: 1, clientX: 10, clientY: 10 })
  await new Promise((resolve) => setTimeout(resolve, 340))
  firePointer('pointermove', window, { pointerId: 1, clientX: 220, clientY: 20 })
  firePointer('pointerup', window, { pointerId: 1, clientX: 220, clientY: 20 })
}

function firePointer(
  name: 'pointerdown' | 'pointermove' | 'pointerup',
  target: Element | Window,
  init: { pointerId: number; clientX: number; clientY: number },
) {
  // jsdom 不实现 PointerEvent；手动补上拖拽逻辑需要的坐标和 pointerId。
  const event = new Event(name, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    button: { value: 0 },
  })
  fireEvent(target, event)
}

afterEach(() => {
  send.mockClear()
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: originalElementFromPoint,
  })
})

describe('TaskBoard drag and drop', () => {
  it('starts a todo task when dropped into running', async () => {
    renderBoard([task('t1', 'A')])
    pointAt('running')

    await dragAfterLongPress('t1')

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: 'task.enqueue', payload: { taskId: 't1' } }),
    )
  })

  it('asks for confirmation before cancelling a running task', async () => {
    renderBoard([task('t2', 'B', { status: 'running' })])
    pointAt('closed')

    await dragAfterLongPress('t2')

    expect(await screen.findByText('取消任务？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认取消' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: 'task.cancel', payload: { taskId: 't2' } }),
    )
  })
})
