import { SupervisorDigestMeta, type DigestReport } from '@baton/protocol'

type DigestTrigger = SupervisorDigestMeta['trigger']

function formatTimestamp(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 汇报消息只放统计摘要；待决策项的标题、原因与动作由 meta.digest 渲染，
 * 避免正文和消息下方的动作区重复同一批任务。
 */
export function formatDigestMessage(report: DigestReport, trigger: DigestTrigger): string {
  const attentionCount =
    report.snapshot.attention.needsApproval +
    report.snapshot.attention.needsReply +
    report.snapshot.attention.needsAttention
  // dropped 也是 waiting_input，但 attention 会把它算进 needs_reply；与旧汇报卡口径一致。
  const pendingCount = Math.max(0, attentionCount - report.dropped.length)
  const lines = [
    `本轮汇报 · ${formatTimestamp(report.generatedAt)}`,
    `共 ${report.snapshot.total} 个任务：待处理 ${pendingCount}，待验收 ${report.snapshot.attention.needsReview}，进行中 ${report.snapshot.running}`,
    `变化：新增 ${report.changes.created} · 完成 ${report.changes.completed} · 失败 ${report.changes.failed} · 重试 ${report.changes.retried}`,
  ]
  if (report.attention.items.length > 0) {
    lines.push(`需要你决定 ${report.attention.items.length} 件。`)
  }
  if (trigger === 'schedule' && report.attention.items.length === 0) {
    lines.push('定时汇报，无需你处理。')
  }
  return lines.join('\n')
}

export function buildDigestMeta(input: {
  report: DigestReport
  noticeId: string
  trigger: DigestTrigger
}): SupervisorDigestMeta {
  return SupervisorDigestMeta.parse({
    noticeId: input.noticeId,
    trigger: input.trigger,
    generatedAt: input.report.generatedAt,
    items: input.report.attention.items,
  })
}
