import type { Review } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { TextArea } from '@heroui/react/textarea'
import { useState } from 'react'
import { useCommandAction } from './useCommandAction'
import { verifyOutputClass } from './styles'

export function ReviewCard({
  review,
  onDone,
}: {
  review: Review
  onDone: () => Promise<void> | void
}) {
  const [rejecting, setRejecting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const action = useCommandAction(onDone)
  const decided = review.verdict !== null

  return (
    <section className="shrink-0 rounded-lg border border-accent bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">验收</h3>
        <Chip size="sm" variant="soft" color={review.verifyExitCode === 0 ? 'success' : 'danger'}>
          退出码 {review.verifyExitCode}
        </Chip>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
        <span title="仅统计 Git 已跟踪文件；非 git 工作区或未跟踪文件不计入">
          Git 文件 {review.diffStat.filesChanged}
        </span>
        <span className="text-success">+{review.diffStat.insertions}</span>
        <span className="text-danger">-{review.diffStat.deletions}</span>
      </div>
      {review.verifyOutput ? <pre className={verifyOutputClass}>{review.verifyOutput}</pre> : null}

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
    </section>
  )
}
