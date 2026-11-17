import { useQuery } from '@tanstack/react-query'
import { getTask } from '../../lib/api'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'
import { AttentionBadge } from './AttentionBadge'
import { StatusChip } from './StatusChip'

export function TaskDetailPanel() {
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId)
  const activeTaskId = useAppStore((state) => state.activeTaskId)
  const detail = useQuery({
    queryKey: queryKeys.task(activeTaskId ?? ''),
    queryFn: () => getTask(activeTaskId!),
    enabled: Boolean(activeTaskId),
  })

  return (
    <aside
      data-testid="task-detail"
      className="w-[380px] shrink-0 overflow-y-auto border-l border-separator bg-surface p-4"
    >
      {!activeWorkspaceId ? (
        <p className="text-sm text-muted">尚未选择工作区</p>
      ) : !activeTaskId ? (
        <p className="text-sm text-muted">选择一个任务</p>
      ) : detail.isLoading ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : detail.isError ? (
        <p className="text-sm text-danger">任务加载失败</p>
      ) : detail.data ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-base font-medium">{detail.data.task.title}</h2>
            <AttentionBadge attention={detail.data.attention} />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <StatusChip status={detail.data.task.status} />
            <span>{detail.data.task.engine}</span>
          </div>
          <p className="text-sm text-muted">暂无更多详情。</p>
        </div>
      ) : null}
    </aside>
  )
}
