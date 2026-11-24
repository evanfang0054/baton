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
  const acceptance = data.acceptance ?? null
  const actions = useCanvasActions()
  if (!task) return null
  const failure = acceptance?.topFailures[0]

  return (
    <div
      role="button"
      tabIndex={0}
      className="nodrag flex h-full w-full flex-col rounded-lg border border-accent bg-surface p-3 text-left shadow-surface focus-visible:outline-2 focus-visible:outline-accent"
      aria-label={`打开任务 ${task.title}`}
      onClick={() => actions.openTask(task.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          actions.openTask(task.id)
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-accent">待验收</span>
        <span className="text-xs text-muted">
          {task.waitingSince ? <WaitingTime since={task.waitingSince} /> : null}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-medium text-foreground">{task.title}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
        {acceptance ? (
          <span className={acceptance.counts.fail > 0 ? 'text-danger' : 'text-muted'}>
            AC {acceptance.counts.pass}/{acceptance.counts.total}
          </span>
        ) : (
          <span className="text-warning">初步验收未完成</span>
        )}
        {acceptance ? (
          <span>
            ✔{acceptance.counts.pass} ✘{acceptance.counts.fail} ○{acceptance.counts.pending}
          </span>
        ) : null}
        {review ? (
          <span>
            verify {review.verifyExitCode === VERIFY_SKIPPED ? '未执行' : review.verifyExitCode}
          </span>
        ) : null}
      </div>
      {failure ? (
        <p className="mt-1 line-clamp-1 text-xs text-danger">未过项：{failure.text}</p>
      ) : null}
      {review ? (
        <p className="mt-auto text-xs text-muted">
          初步验收：{preliminaryLabel(review)}
          <span className="block">最终由你决定</span>
        </p>
      ) : (
        <p className="mt-auto text-xs text-muted">打开任务查看验收详情</p>
      )}
      <button
        type="button"
        className="mt-2 self-start rounded px-1 text-xs text-accent underline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={(event) => {
          event.stopPropagation()
          actions.openTask(task.id)
        }}
      >
        查看证据
      </button>
    </div>
  )
}
