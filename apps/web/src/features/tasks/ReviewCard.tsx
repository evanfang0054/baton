import {
  VERIFY_SKIPPED,
  type Node,
  type ReviewView,
  type TaskAcceptanceSummary,
} from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { TextArea } from '@heroui/react/textarea'
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../stores/app'
import { nodeTitle } from '../canvas/node-title'
import { needsAcceptanceOverride } from './acceptance-gate'
import { DiffViewer } from './DiffViewer'
import { useCommandAction } from './useCommandAction'
import { verifyOutputClass } from './styles'

const CONTEXT_TYPES = new Set<Node['type']>(['text', 'file', 'image', 'group'])

export function ReviewCard({
  review,
  acceptance = null,
  contextNodes,
  onDone,
}: {
  review: ReviewView
  acceptance?: TaskAcceptanceSummary | null
  contextNodes?: Node[]
  onDone: () => Promise<void> | void
}) {
  const [rejecting, setRejecting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const [attachContext, setAttachContext] = useState(false)
  const [confirmingApprove, setConfirmingApprove] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const confirmRef = useRef<HTMLDivElement>(null)
  const contextNodeIds = useAppStore((state) => state.contextNodeIds)
  const attachable = (
    contextNodes
      ? contextNodes
          .filter((node) => CONTEXT_TYPES.has(node.type))
          .map((node) => ({ id: node.id, label: nodeTitle(node) }))
      : contextNodeIds.map((id) => ({ id, label: id }))
  ).slice(0, 40)
  const action = useCommandAction(onDone)
  const decided = review.verdict !== null
  const verifySkipped = review.verifyExitCode === VERIFY_SKIPPED
  const needsOverride = needsAcceptanceOverride(review, acceptance)
  const withContext = attachContext && attachable.length > 0
  const overridePrompt =
    acceptance && acceptance.counts.total === 0
      ? '还没有验收项，仍要直接通过吗？'
      : acceptance && acceptance.counts.fail > 0
        ? '仍有验收项未通过，仍要通过吗？'
        : acceptance && acceptance.counts.pending > 0
          ? '还有验收项待验证，仍要通过吗？'
          : '校验未通过，仍要通过吗？'
  const overrideReasonMissing = needsOverride && overrideReason.trim().length === 0
  const missingArtifacts =
    action.errorCode === 'artifact_missing' &&
    Array.isArray((action.errorDetails as { missing?: unknown } | null)?.missing)
      ? ((action.errorDetails as { missing: unknown[] }).missing.filter(
          (item): item is string => typeof item === 'string',
        ) as string[])
      : []
  const artifactBlocked = missingArtifacts.length > 0

  // 选择被清空后不能留下一个不可见的“附带上下文”开关。
  useEffect(() => {
    if (attachable.length === 0) setAttachContext(false)
  }, [attachable.length])

  // 通过确认区在任务详情底部展开时可能落到滚动视口上方，展开后主动带到可见区域。
  useEffect(() => {
    if (!confirmingApprove) return
    const timer = window.setTimeout(() => {
      confirmRef.current?.scrollIntoView?.({ block: 'nearest' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [confirmingApprove])

  const approve = () => {
    action.run({
      type: 'review.decide',
      payload: {
        reviewId: review.id,
        decision: 'approve',
        ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
      },
    })
  }

  return (
    <section className="shrink-0 rounded-lg border border-accent bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">验收</h3>
        <div className="flex items-center gap-2">
          <Chip
            size="sm"
            variant="soft"
            color={verifySkipped ? 'warning' : review.verifyExitCode === 0 ? 'success' : 'danger'}
          >
            {verifySkipped ? '未执行自动校验' : `退出码 ${review.verifyExitCode}`}
          </Chip>
        </div>
      </div>
      {action.error ? (
        artifactBlocked ? (
          <div role="alert" className="mt-2 rounded-lg border border-warning bg-warning/10 p-3">
            <p className="text-sm font-medium text-warning">
              缺少必需产物：{missingArtifacts.join('、')}
            </p>
            <p className="mt-1 text-xs text-muted">
              必需产物未写入交付目录，不能通过验收。请打回任务重新执行，产物落盘后再验收。
            </p>
          </div>
        ) : (
          <p role="alert" className="mt-2 text-sm text-danger">
            {action.error}
          </p>
        )
      ) : null}
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

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {acceptance ? (
          <span className={acceptance.counts.fail > 0 ? 'text-danger' : 'text-muted'}>
            AC {acceptance.counts.pass}/{acceptance.counts.total} · 未过 {acceptance.counts.fail} ·
            待验 {acceptance.counts.pending}
          </span>
        ) : (
          <span className="text-warning">初步验收未完成</span>
        )}
        {acceptance?.topFailures[0] ? (
          <span className="text-danger">未过项：{acceptance.topFailures[0].text}</span>
        ) : null}
      </div>

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
      ) : confirmingApprove ? (
        <div
          ref={confirmRef}
          className="mt-3 flex flex-col gap-2 rounded border border-warning bg-warning/10 p-2"
        >
          <p className="text-xs text-warning">{overridePrompt}</p>
          <TextArea
            aria-label="通过理由"
            placeholder={needsOverride ? '必填：说明为什么仍然通过' : '可选：为什么仍然通过'}
            value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)}
            fullWidth
          />
          {overrideReasonMissing ? (
            <p className="text-xs text-warning">通过前请填写通过理由。</p>
          ) : null}
          {artifactBlocked ? (
            <div className="rounded border border-warning bg-surface p-2">
              <p className="text-xs text-warning">
                缺少必需产物：{missingArtifacts.join('、')}。补齐前不能通过。
              </p>
              <div className="mt-2 flex justify-end">
                <Button
                  variant="secondary"
                  onPress={() => {
                    setConfirmingApprove(false)
                    setRejecting(true)
                    setFeedback(
                      `缺少必需产物：${missingArtifacts.join('、')}，请重新执行并写入交付目录。`,
                    )
                  }}
                >
                  打回并重新执行
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" onPress={() => setConfirmingApprove(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              isDisabled={action.pending || overrideReasonMissing || artifactBlocked}
              onPress={approve}
            >
              确认通过
            </Button>
          </div>
        </div>
      ) : rejecting ? (
        <div className="mt-3 flex flex-col gap-2">
          <TextArea
            aria-label="打回反馈"
            placeholder="说明需要修改的内容"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            fullWidth
          />
          {attachable.length > 0 ? (
            <>
              <ul className="flex flex-wrap gap-1">
                {attachable.map((node) => (
                  <li
                    key={node.id}
                    className="rounded bg-background px-1.5 py-0.5 text-xs text-muted"
                  >
                    {node.label}
                  </li>
                ))}
              </ul>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  aria-label={`附带当前选中的 ${attachable.length} 个节点`}
                  checked={attachContext}
                  onChange={(event) => setAttachContext(event.target.checked)}
                />
                附带当前选中的 {attachable.length} 个节点
              </label>
            </>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" onPress={() => setRejecting(false)}>
              返回
            </Button>
            <Button
              variant="danger"
              isDisabled={(!feedback.trim() && !withContext) || action.pending}
              onPress={() =>
                action.run({
                  type: 'review.decide',
                  payload: {
                    reviewId: review.id,
                    decision: 'reject',
                    ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
                    ...(withContext ? { contextNodeIds: attachable.map((node) => node.id) } : {}),
                  },
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
            onPress={() => {
              if (needsOverride) {
                setConfirmingApprove(true)
                return
              }
              approve()
            }}
          >
            通过
          </Button>
        </div>
      )}

      {showDiff ? <DiffViewer reviewId={review.id} onClose={() => setShowDiff(false)} /> : null}
    </section>
  )
}
