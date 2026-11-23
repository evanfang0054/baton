import type { Approval, ReviewView, TaskAcceptanceSummary, TaskSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { Input } from '@heroui/react/input'
import { TextArea } from '@heroui/react/textarea'
import { toast } from '@heroui/react/toast'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { getTask, listTasks } from '../../lib/api'
import { invalidateTaskQueries, queryKeys } from '../../lib/query'
import { needsAcceptanceOverride } from '../tasks/acceptance-gate'
import { riskColor, riskLabel } from '../tasks/ApprovalCard'
import { useCommandAction } from '../tasks/useCommandAction'
import { WaitingTime } from '../tasks/WaitingTime'

function inputPreview(input: unknown): string {
  if (input === undefined || input === null) return ''
  if (typeof input === 'object') {
    const record = input as { command?: unknown; file_path?: unknown; path?: unknown }
    const target = record.command ?? record.file_path ?? record.path
    if (typeof target === 'string') {
      return target.length > 160 ? `${target.slice(0, 157)}…` : target
    }
  }
  const text = JSON.stringify(input)
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

type GateCard =
  | { kind: 'approval'; task: TaskSummary; approval: Approval }
  | {
      kind: 'review'
      task: TaskSummary
      review: ReviewView
      acceptance: TaskAcceptanceSummary | null
    }

const MAX_GATE_CARDS = 4

function useGateQuery(workspaceId: string) {
  const tasks = useQuery({
    queryKey: queryKeys.tasks(workspaceId),
    queryFn: () => listTasks(workspaceId),
  })
  const candidates = (tasks.data ?? [])
    .filter((task) => task.attention === 'needs_approval' || task.attention === 'needs_review')
    .sort(
      (a, b) =>
        (a.waitingSince ?? Number.MAX_SAFE_INTEGER) - (b.waitingSince ?? Number.MAX_SAFE_INTEGER),
    )
  const details = useQueries({
    queries: candidates.slice(0, MAX_GATE_CARDS).map((task) => ({
      queryKey: queryKeys.task(task.id),
      queryFn: () => getTask(task.id),
    })),
  })
  return { candidates, details }
}

export function SupervisorGateCards({
  workspaceId,
  onOpenTask,
}: {
  workspaceId: string
  onOpenTask: (taskId: string) => void
}) {
  const queryClient = useQueryClient()
  const { candidates, details } = useGateQuery(workspaceId)
  const refresh = async (task: TaskSummary) => {
    await invalidateTaskQueries(queryClient, task.id, workspaceId)
  }

  const cards: GateCard[] = candidates
    .slice(0, MAX_GATE_CARDS)
    .flatMap((task, index): GateCard[] => {
      const detail = details[index]?.data
      if (!detail) return []
      if (task.attention === 'needs_approval') {
        // AskUserQuestion 必须回答结构化问题，普通审批卡的 allow/deny 无法提交 answers，
        // 在任务详情/问答卡处理；这里不放出必然失败的动作。
        const approval = [...detail.approvals]
          .reverse()
          .find((item) => item.decision === null && item.request.toolName !== 'AskUserQuestion')
        return approval ? [{ kind: 'approval', task, approval }] : []
      }
      const review = detail.review
      if (!review || review.verdict !== null) return []
      return [
        {
          kind: 'review',
          task,
          review,
          acceptance: detail.acceptance,
        },
      ]
    })

  if (cards.length === 0) {
    return <section aria-label="待我处理" aria-live="polite" className="sr-only" />
  }

  return (
    <section
      aria-label="待我处理"
      aria-live="polite"
      className="max-h-72 shrink-0 overflow-y-auto border-t border-separator bg-background/60 px-3 py-2"
    >
      <p className="mb-2 text-xs font-medium text-foreground">
        待我处理 {cards.length}
        {candidates.length > cards.length
          ? `（另有 ${candidates.length - cards.length} 条需到任务详情处理）`
          : ''}
        {cards.length > MAX_GATE_CARDS ? `（显示前 ${MAX_GATE_CARDS}）` : ''}
      </p>
      <div className="flex flex-col gap-2">
        {cards.map((card) =>
          card.kind === 'approval' ? (
            <ApprovalGateCard
              key={`approval-${card.approval.id}`}
              task={card.task}
              approval={card.approval}
              onOpenTask={onOpenTask}
              onDone={() => refresh(card.task)}
            />
          ) : (
            <ReviewGateCard
              key={`review-${card.review.id}`}
              task={card.task}
              review={card.review}
              acceptance={card.acceptance}
              onOpenTask={onOpenTask}
              onDone={() => refresh(card.task)}
            />
          ),
        )}
      </div>
    </section>
  )
}

function ApprovalGateCard({
  task,
  approval,
  onOpenTask,
  onDone,
}: {
  task: TaskSummary
  approval: Approval
  onOpenTask: (taskId: string) => void
  onDone: () => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [resolved, setResolved] = useState(false)
  const action = useCommandAction(onDone)
  const preview = inputPreview(approval.request.input)

  useEffect(() => {
    if (action.error) toast.danger(action.error)
  }, [action.error])

  if (resolved) return null

  const decide = async (decision: 'allow' | 'deny') => {
    setResolved(true)
    const ok = await action.run({
      type: 'approval.decide',
      payload: {
        approvalId: approval.id,
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    })
    if (!ok) setResolved(false)
  }

  return (
    <section className="rounded-lg border border-warning border-l-2 bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
          <p className="mt-0.5 font-mono text-xs text-muted">{approval.request.toolName}</p>
        </div>
        <Chip size="sm" variant="soft" color={riskColor[approval.request.risk]}>
          {riskLabel[approval.request.risk]}
        </Chip>
      </div>
      {preview ? (
        <pre className="mt-2 max-h-16 overflow-hidden whitespace-pre-wrap break-words rounded bg-default/40 p-1.5 font-mono text-xs text-muted">
          {preview}
        </pre>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        {task.waitingSince ? <WaitingTime since={task.waitingSince} /> : null}
        <Input
          aria-label="审批备注"
          placeholder="备注（可选）"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="h-7 min-w-0 flex-1"
        />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="tertiary" onPress={() => onOpenTask(task.id)}>
          查看详情
        </Button>
        <Button
          size="sm"
          variant="danger-soft"
          isDisabled={action.pending}
          onPress={() => void decide('deny')}
        >
          拒绝
        </Button>
        <Button
          size="sm"
          variant="primary"
          isDisabled={action.pending}
          onPress={() => void decide('allow')}
        >
          允许
        </Button>
      </div>
      {action.error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {action.error}
        </p>
      ) : null}
    </section>
  )
}

function ReviewGateCard({
  task,
  review,
  acceptance,
  onOpenTask,
  onDone,
}: {
  task: TaskSummary
  review: ReviewView
  acceptance: TaskAcceptanceSummary | null
  onOpenTask: (taskId: string) => void
  onDone: () => Promise<void>
}) {
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle')
  const [reason, setReason] = useState('')
  const [resolved, setResolved] = useState(false)
  const action = useCommandAction(onDone)
  const needsOverride = needsAcceptanceOverride(review, acceptance)
  const reasonMissing = needsOverride && reason.trim().length === 0

  useEffect(() => {
    if (action.error) toast.danger(action.error)
  }, [action.error])

  if (resolved) return null

  const approve = async () => {
    if (needsOverride) {
      setReason('')
      setMode('approve')
      return
    }
    setResolved(true)
    const ok = await action.run({
      type: 'review.decide',
      payload: { reviewId: review.id, decision: 'approve' },
    })
    if (!ok) setResolved(false)
  }

  const confirmApprove = async () => {
    setResolved(true)
    const ok = await action.run({
      type: 'review.decide',
      payload: {
        reviewId: review.id,
        decision: 'approve',
        ...(reason.trim() ? { overrideReason: reason.trim() } : {}),
      },
    })
    if (!ok) setResolved(false)
  }

  const reject = async () => {
    setResolved(true)
    const ok = await action.run({
      type: 'review.decide',
      payload: {
        reviewId: review.id,
        decision: 'reject',
        feedback: reason.trim(),
      },
    })
    if (!ok) setResolved(false)
  }

  return (
    <section className="rounded-lg border border-accent bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
          <p className="mt-0.5 text-xs text-muted">
            {acceptance
              ? `AC ${acceptance.counts.pass}/${acceptance.counts.total} · 未过 ${acceptance.counts.fail}`
              : '验收清单未生成'}{' '}
            · 退出码 {review.verifyExitCode}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Git {review.diffStat.filesChanged} · +{review.diffStat.insertions} -
            {review.diffStat.deletions}
          </p>
        </div>
        {task.waitingSince ? <WaitingTime since={task.waitingSince} /> : null}
      </div>

      {mode === 'approve' ? (
        <div className="mt-2 flex flex-col gap-2 rounded border border-warning bg-warning/10 p-2">
          <TextArea
            aria-label="通过理由"
            placeholder="必填：说明为什么仍然通过"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            fullWidth
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="tertiary" onPress={() => setMode('idle')}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              isDisabled={action.pending || reasonMissing}
              onPress={() => void confirmApprove()}
            >
              确认通过
            </Button>
          </div>
        </div>
      ) : mode === 'reject' ? (
        <div className="mt-2 flex flex-col gap-2">
          <TextArea
            aria-label="打回反馈"
            placeholder="说明需要修改的内容"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            fullWidth
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="tertiary" onPress={() => setMode('idle')}>
              返回
            </Button>
            <Button
              size="sm"
              variant="danger"
              isDisabled={action.pending || reason.trim().length === 0}
              onPress={() => void reject()}
            >
              确认打回
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="tertiary" onPress={() => onOpenTask(task.id)}>
            查看详情
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={action.pending}
            onPress={() => {
              setReason('')
              setMode('reject')
            }}
          >
            打回
          </Button>
          <Button
            size="sm"
            variant="primary"
            isDisabled={action.pending}
            onPress={() => void approve()}
          >
            通过
          </Button>
        </div>
      )}
      {action.error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {action.error}
        </p>
      ) : null}
    </section>
  )
}
