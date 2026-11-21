import type { Node, TaskSummary } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { InjectContextDialog } from './InjectContextDialog'

const node: Node = {
  id: 'n1',
  canvasId: 'c1',
  type: 'text',
  x: 0,
  y: 0,
  w: 320,
  h: 200,
  groupId: null,
  data: { content: '登录页需求' },
  createdAt: 1,
  updatedAt: 1,
}

function task(overrides: Partial<TaskSummary>): TaskSummary {
  return {
    id: 't1',
    workspaceId: 'w1',
    nodeId: null,
    title: '任务 A',
    prompt: '',
    status: 'todo',
    waitingReason: null,
    engine: 'fake',
    workspaceMode: 'main',
    branch: null,
    worktreePath: null,
    verifyCommand: null,
    retryCount: 0,
    dangerouslySkipPermissions: false,
    enqueuedAt: null,
    createdAt: 1,
    updatedAt: 1,
    attention: 'none',
    waitingSince: null,
    ...overrides,
  } as TaskSummary
}

describe('InjectContextDialog', () => {
  it('lists only injectable tasks and submits nodeIds + note', async () => {
    const send = vi.fn().mockResolvedValue({ taskId: 't1', seq: 1, truncated: false, dropped: 0 })
    const onDone = vi.fn()
    render(
      <CommandProvider send={send}>
        <InjectContextDialog
          open
          nodes={[node]}
          tasks={[
            task({ id: 't1', title: '待办任务' }),
            task({ id: 't2', title: '运行中任务', status: 'running' }),
          ]}
          defaultTaskId="t1"
          onOpenChange={() => {}}
          onDone={onDone}
        />
      </CommandProvider>,
    )
    expect(screen.getByRole('option', { name: /待办任务/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /运行中任务/ })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('投喂说明'), '补充报错')
    await userEvent.click(screen.getByRole('button', { name: '投喂' }))
    expect(send).toHaveBeenCalledWith({
      type: 'context.inject',
      payload: { taskId: 't1', nodeIds: ['n1'], note: '补充报错' },
    })
    expect(onDone).toHaveBeenCalled()
  })

  it('keeps note and target when the task list refreshes', async () => {
    const send = vi.fn().mockResolvedValue({})
    const tasks = [task({ id: 't1', title: '待办任务' })]
    const view = (nextTasks: TaskSummary[]) => (
      <CommandProvider send={send}>
        <InjectContextDialog
          open
          nodes={[node]}
          tasks={nextTasks}
          defaultTaskId="t1"
          onOpenChange={() => {}}
          onDone={() => {}}
        />
      </CommandProvider>
    )
    const { rerender } = render(view(tasks))
    await userEvent.type(screen.getByLabelText('投喂说明'), '补充报错')

    rerender(view([...tasks, task({ id: 't3', title: '新任务' })]))

    expect(screen.getByLabelText('投喂说明')).toHaveValue('补充报错')
    expect(screen.getByLabelText('目标任务')).toHaveValue('t1')
  })

  it('does not retarget when an explicit task is no longer injectable', () => {
    render(
      <CommandProvider send={vi.fn()}>
        <InjectContextDialog
          open
          nodes={[node]}
          tasks={[
            task({ id: 't1', title: '待办任务' }),
            task({ id: 't2', title: '运行中任务', status: 'running' }),
          ]}
          defaultTaskId="t2"
          onOpenChange={() => {}}
          onDone={() => {}}
        />
      </CommandProvider>,
    )
    expect(screen.getByLabelText('目标任务')).toHaveValue('')
    expect(screen.getByRole('button', { name: '投喂' })).toBeDisabled()
  })

  it('disables submit without a task or node', () => {
    render(
      <CommandProvider send={vi.fn()}>
        <InjectContextDialog
          open
          nodes={[]}
          tasks={[]}
          defaultTaskId={null}
          onOpenChange={() => {}}
          onDone={() => {}}
        />
      </CommandProvider>,
    )
    expect(screen.getByRole('button', { name: '投喂' })).toBeDisabled()
  })
})
