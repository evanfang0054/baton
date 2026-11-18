import type { TaskStatus, TaskSummary } from '@baton/protocol'

export type BoardColumnId =
  'unplanned' | 'todo' | 'running' | 'waiting' | 'review' | 'done' | 'closed'

export const BOARD_COLUMNS: Array<{ id: BoardColumnId; label: string }> = [
  { id: 'unplanned', label: '未规划' },
  { id: 'todo', label: '待办' },
  { id: 'running', label: '进行中' },
  { id: 'waiting', label: '待处理' },
  { id: 'review', label: '待验收' },
  { id: 'done', label: '已完成' },
  { id: 'closed', label: '已取消' },
]

export function statusColumn(status: TaskStatus): BoardColumnId {
  switch (status) {
    case 'todo':
    case 'queued':
      return 'todo'
    case 'running':
    case 'verifying':
      return 'running'
    case 'waiting_input':
      return 'waiting'
    case 'review':
      return 'review'
    case 'done':
      return 'done'
    case 'cancelled':
    case 'failed':
      return 'closed'
  }
}

export function groupTasks(tasks: TaskSummary[]): Record<BoardColumnId, TaskSummary[]> {
  const grouped: Record<BoardColumnId, TaskSummary[]> = {
    unplanned: [],
    todo: [],
    running: [],
    waiting: [],
    review: [],
    done: [],
    closed: [],
  }
  for (const task of tasks) {
    grouped[statusColumn(task.status)].push(task)
  }
  return grouped
}
