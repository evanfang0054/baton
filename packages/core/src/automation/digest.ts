import type { DigestReport, DigestTaskRef, Task } from '@baton/protocol'
import { attentionFor } from '../state-machine/attention.js'
import { boardColumn, waitingSinceFor } from '../tasks/board.js'

export interface DigestInput {
  workspaceId: string
  now: number
  windowStart: number
  policyVersion: string
  tasks: Task[]
  autoDecisions: Array<{ decision: 'allow' | 'deny'; decidedAt: number }>
  retryAudits: Array<{ ts: number }>
  completedAtByTask: Map<string, number>
}

function toRef(task: Task): DigestTaskRef {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    attention: attentionFor(task.status, task.waitingReason),
    waitingSince: waitingSinceFor(task),
    retryCount: task.retryCount,
  }
}

function byLongestWait(a: DigestTaskRef, b: DigestTaskRef): number {
  return (b.waitingSince ?? 0) - (a.waitingSince ?? 0)
}

/** 只读任务摘要；不得把 prompt、context、transcript 带进 digest。 */
export function buildDigest(input: DigestInput): DigestReport {
  const tasks = input.tasks.filter((task) => task.workspaceId === input.workspaceId)
  const refs = tasks.map(toRef)

  const snapshot = {
    total: tasks.length,
    unplanned: 0,
    todo: 0,
    running: 0,
    waiting: 0,
    review: 0,
    done: 0,
    closed: 0,
    attention: {
      needsApproval: 0,
      needsReply: 0,
      needsAttention: 0,
      needsReview: 0,
    },
  }

  for (const task of tasks) {
    snapshot[boardColumn(task.status)] += 1
    const attention = attentionFor(task.status, task.waitingReason)
    if (attention === 'needs_approval') snapshot.attention.needsApproval += 1
    if (attention === 'needs_reply') snapshot.attention.needsReply += 1
    if (attention === 'needs_attention') snapshot.attention.needsAttention += 1
    if (attention === 'needs_review') snapshot.attention.needsReview += 1
  }

  const ready = refs
    .filter((task) => task.status === 'review')
    .sort(byLongestWait)
    .slice(0, 20)
  const blocked = refs
    .filter((task) => task.status === 'waiting_input' && task.attention !== 'none')
    .filter((task) => tasks.find((row) => row.id === task.id)?.waitingReason !== 'dropped')
    .sort(byLongestWait)
    .slice(0, 20)
  const dropped = refs
    .filter((task) => tasks.find((row) => row.id === task.id)?.waitingReason === 'dropped')
    .sort(byLongestWait)
    .slice(0, 20)

  const waitingRefs = refs.filter(
    (task) => task.status === 'waiting_input' || task.status === 'review',
  )
  const oldestWaiting = waitingRefs.sort(byLongestWait)[0] ?? null

  const completed = [...input.completedAtByTask.values()].filter(
    (at) => at >= input.windowStart,
  ).length

  return {
    workspaceId: input.workspaceId,
    windowStart: input.windowStart,
    windowEnd: input.now,
    generatedAt: input.now,
    policyVersion: input.policyVersion,
    snapshot,
    ready,
    blocked,
    dropped,
    changes: {
      created: tasks.filter((task) => task.createdAt >= input.windowStart).length,
      updated: tasks.filter((task) => task.updatedAt >= input.windowStart).length,
      completed,
      failed: tasks.filter(
        (task) => task.status === 'failed' && task.updatedAt >= input.windowStart,
      ).length,
      cancelled: tasks.filter(
        (task) => task.status === 'cancelled' && task.updatedAt >= input.windowStart,
      ).length,
      retried: input.retryAudits.filter((audit) => audit.ts >= input.windowStart).length,
      autoAllowed: input.autoDecisions.filter(
        (decision) => decision.decision === 'allow' && decision.decidedAt >= input.windowStart,
      ).length,
      autoDenied: input.autoDecisions.filter(
        (decision) => decision.decision === 'deny' && decision.decidedAt >= input.windowStart,
      ).length,
    },
    oldestWaiting,
  }
}
