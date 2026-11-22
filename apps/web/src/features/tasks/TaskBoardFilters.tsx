import { needsMe, sortByWaiting } from '@baton/core'
import type { TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'

export type TaskFilter = 'all' | 'needs_me' | 'review' | 'waiting'

const FILTERS: Array<{ id: TaskFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'needs_me', label: '需要我' },
  { id: 'review', label: '待验收' },
  { id: 'waiting', label: '待处理' },
]

/** 筛选后再按等待时长排序，保证“需要我”里等最久的排最前。 */
export function filterTasks(
  tasks: TaskSummary[],
  input: { filter: TaskFilter; query: string },
): TaskSummary[] {
  const query = input.query.trim().toLowerCase()
  return sortByWaiting(
    tasks.filter((task) => {
      if (query && !task.title.toLowerCase().includes(query)) return false
      if (input.filter === 'all') return true
      if (input.filter === 'needs_me') {
        return needsMe({
          status: task.status,
          attention: task.attention,
          acceptance: task.acceptance,
          budget: task.budget,
        })
      }
      if (input.filter === 'review') return task.status === 'review'
      return task.status === 'waiting_input'
    }),
  )
}

export function TaskBoardFilters({
  filter,
  query,
  onFilter,
  onQuery,
}: {
  filter: TaskFilter
  query: string
  onFilter: (filter: TaskFilter) => void
  onQuery: (query: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-separator px-3 py-2">
      <div role="group" aria-label="任务筛选" className="flex flex-wrap gap-1">
        {FILTERS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={filter === item.id ? 'primary' : 'tertiary'}
            aria-pressed={filter === item.id}
            onPress={() => onFilter(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <Input
        aria-label="搜索任务"
        placeholder="搜索标题"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        fullWidth
        className="min-w-40 flex-1"
      />
    </div>
  )
}
