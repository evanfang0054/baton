import { VERIFY_SKIPPED, type ReviewView } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { TextArea } from '@heroui/react/textarea'
import { useState } from 'react'
import { DiffViewer } from './DiffViewer'
import { useCommandAction } from './useCommandAction'
import { verifyOutputClass } from './styles'

export function ReviewCard({
  review,
  onDone,
}: {
  review: ReviewView
  onDone: () => Promise<void> | void
}) {
  const [rejecting, setRejecting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const action = useCommandAction(onDone)
  const decided = review.verdict !== null
  const verifySkipped = review.verifyExitCode === VERIFY_SKIPPED

  return (
    <section className="shrink-0 rounded-lg border border-accent bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">验收</h3>
        <Chip
          size="sm"
          variant="soft"
          color={verifySkipped ? 'warning' : review.verifyExitCode === 0 ? 'success' : 'danger'}
        >
          {verifySkipped ? '未执行自动校验' : `退出码 ${review.verifyExitCode}`}
        </Chip>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
        <span title="仅统计 Git 已跟踪文件；非 git 工作区或未跟踪文件不计入">
          Git 文件 {review.diffStat.filesChanged}
        </span>
        <span className="text-success">+{review.diffStat.insertions}</span>
        <span className="text-danger">-{review.diffStat.deletions}</span>
        {review.diffAvailable ? (
          <Button size="sm" variant="tertiary" onPress={() => setShowDiff(true)}>
            查看改动
          </Button>
        ) : null}
      </div>
      {review.verifyOutput ? <pre className={verifyOutputClass}>{review.verifyOutput}</pre> : null}

      <section className="mt-3 rounded border border-separator bg-background p-2">
        <p className="text-xs font-medium text-foreground">
          初步验收：
          {review.preliminaryVerdict === 'pass'
            ? 'PASS'
            : review.preliminaryVerdict === 'fail'
              ? 'FAIL'
              : '进行中/未完成'}
        </p>
        {review.preliminaryReason ? (
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{review.preliminaryReason}</p>
        ) : null}
        <p className="mt-1 text-xs text-muted">这是验收员的初步建议，最终通过或打回由你决定。</p>
      </section>

      {decided ? (
        <p className="mt-3 text-sm text-muted">
          {review.verdict === 'approved' ? '已通过验收' : '已打回'}
        </p>
      ) : rejecting ? (
        <div className="mt-3 flex flex-col gap-2">
          <TextArea
            aria-label="打回反馈"
            placeholder="说明需要修改的内容"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            fullWidth
          />
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" onPress={() => setRejecting(false)}>
              返回
            </Button>
            <Button
              variant="danger"
              isDisabled={!feedback.trim() || action.pending}
              onPress={() =>
                action.run({
                  type: 'review.decide',
                  payload: { reviewId: review.id, decision: 'reject', feedback: feedback.trim() },
                })
              }
            >
              确认打回
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="tertiary" onPress={() => setRejecting(true)}>
            打回
          </Button>
          <Button
            variant="primary"
            isDisabled={action.pending}
            onPress={() =>
              action.run({
                type: 'review.decide',
                payload: { reviewId: review.id, decision: 'approve' },
              })
            }
          >
            通过
          </Button>
        </div>
      )}

      {action.error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {action.error}
        </p>
      ) : null}

      {showDiff ? <DiffViewer reviewId={review.id} onClose={() => setShowDiff(false)} /> : null}
    </section>
  )
}
