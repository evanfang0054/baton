import { VERIFY_SKIPPED } from '@baton/protocol'
import { WaitingTime } from '../../tasks/WaitingTime'
import { useCanvasActions } from '../actions'
import type { CanvasFlowNodeProps } from './NodeShell'

function preliminaryLabel(review: CanvasFlowNodeProps['data']['review']) {
  if (review?.preliminaryVerdict === 'pass') return 'PASS'
  if (review?.preliminaryVerdict === 'fail') return 'FAIL'
  return '进行中/未完成'
}

export function ReviewCardNode({ data }: CanvasFlowNodeProps) {
  const task = data.task
  const review = data.review
  const actions = useCanvasActions()
  if (!task) return null

  return (
    <button
      type="button"
      className="nodrag flex h-full w-full flex-col rounded-lg border border-accent bg-surface p-3 text-left shadow-surface focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={`打开任务 ${task.title}`}
      onClick={() => actions.openTask(task.id)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-accent">待验收</span>
        <span className="text-xs text-muted">
          {task.waitingSince ? <WaitingTime since={task.waitingSince} /> : null}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-medium text-foreground">{task.title}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
        {review ? (
          <span>
            verify {review.verifyExitCode === VERIFY_SKIPPED ? '未执行' : review.verifyExitCode}
          </span>
        ) : null}
        {review ? (
          <span>
            {review.diffStat.filesChanged} 文件 +{review.diffStat.insertions}/-
            {review.diffStat.deletions}
          </span>
        ) : null}
      </div>
      <p className="mt-auto text-xs text-muted">
        初步验收：{preliminaryLabel(review)}
        <span className="block">最终由你决定</span>
      </p>
    </button>
  )
}
