import type {
  AttentionCounts,
  AttentionItem,
  AttentionKind,
  FailureSummary,
  TaskStatus,
} from '@baton/protocol'
import { AttentionItem as AttentionItemSchema } from '@baton/protocol'
import { isStale } from '../tasks/board.js'

export interface AttentionCandidate {
  taskId: string
  title: string
  status: TaskStatus
  attention: 'none' | 'needs_approval' | 'needs_reply' | 'needs_attention' | 'needs_review'
  waitingReason: 'approval' | 'question' | 'stalled' | 'dropped' | 'budget' | null
  waitingSince: number | null
  updatedAt: number
  acceptance: { counts: { fail: number } } | null
  budget: { overBudget: boolean } | null
  proposalId: string | null
  lastFailure: Pick<FailureSummary, 'stage' | 'summary'> | null
}

const PRIORITY: Record<AttentionKind, number> = {
  approval: 6,
  reply: 5,
  review: 4,
  failed: 3,
  budget: 2,
  stale: 1,
}

function kindFor(task: AttentionCandidate, now: number): AttentionKind | null {
  if (task.waitingReason === 'budget') return 'budget'
  if (task.attention === 'needs_approval' || task.waitingReason === 'approval') return 'approval'
  if (
    task.attention === 'needs_reply' ||
    task.waitingReason === 'question' ||
    task.waitingReason === 'dropped'
  ) {
    return 'reply'
  }
  if (task.status === 'review' || task.attention === 'needs_review') return 'review'
  if (task.status === 'failed' || (task.acceptance?.counts.fail ?? 0) > 0) return 'failed'
  if (task.budget?.overBudget) return 'budget'
  if (task.waitingReason === 'stalled' || isStale(task.waitingSince, now)) return 'stale'
  return null
}

function reasonFor(kind: AttentionKind, task: AttentionCandidate): string {
  if (kind === 'approval') return '等待你审批'
  if (kind === 'reply') return '等待你回复'
  if (kind === 'review') return '等待你验收'
  if (kind === 'budget') return '超出预算，等你决定'
  if (kind === 'stale') return '已等待超过 30 分钟'
  const text = task.lastFailure?.summary.trim() ?? ''
  if (!text) return '执行失败，等你决定'
  return text.length > 200 ? `${text.slice(0, 199)}…` : text
}

function actionFor(kind: AttentionKind, task: AttentionCandidate): AttentionItem['action'] {
  if (kind === 'review') return { type: 'open_review' }
  if (kind === 'failed' && task.proposalId) {
    return { type: 'apply_proposal', proposalId: task.proposalId }
  }
  return { type: 'open_task' }
}

export function buildAttentionItems(input: {
  tasks: AttentionCandidate[]
  now: number
  limit?: number
}): { items: AttentionItem[]; counts: AttentionCounts } {
  const byTask = new Map<string, { kind: AttentionKind; task: AttentionCandidate }>()
  for (const task of input.tasks) {
    const kind = kindFor(task, input.now)
    if (!kind) continue
    const previous = byTask.get(task.taskId)
    if (!previous || PRIORITY[kind] > PRIORITY[previous.kind]) {
      byTask.set(task.taskId, { kind, task })
    }
  }
  const items = [...byTask.values()]
    .sort((a, b) => {
      const rank = PRIORITY[b.kind] - PRIORITY[a.kind]
      if (rank !== 0) return rank
      const waiting =
        (a.task.waitingSince ?? Number.POSITIVE_INFINITY) -
        (b.task.waitingSince ?? Number.POSITIVE_INFINITY)
      if (waiting !== 0) return waiting
      return b.task.updatedAt - a.task.updatedAt
    })
    .slice(0, input.limit ?? 20)
    .map(({ kind, task }) =>
      AttentionItemSchema.parse({
        taskId: task.taskId,
        title: task.title,
        kind,
        reason: reasonFor(kind, task),
        waitingSince: task.waitingSince,
        proposalId: kind === 'failed' ? task.proposalId : null,
        action: actionFor(kind, task),
      }),
    )
  const counts: AttentionCounts = {
    approval: 0,
    reply: 0,
    review: 0,
    failed: 0,
    budget: 0,
    stale: 0,
  }
  for (const item of items) counts[item.kind] += 1
  return { items, counts }
}
