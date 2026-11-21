import type { AcceptanceCounts, AcceptanceItemStatus, AcceptanceVerdict } from '@baton/protocol'

export interface AcceptanceSummary {
  counts: AcceptanceCounts
  verdict: AcceptanceVerdict
}

export function acceptanceSummary(
  items: ReadonlyArray<{ status: AcceptanceItemStatus }>,
): AcceptanceSummary {
  const counts: AcceptanceCounts = {
    total: items.length,
    pass: 0,
    fail: 0,
    pending: 0,
    waived: 0,
  }
  for (const item of items) {
    counts[item.status] += 1
  }
  const verdict: AcceptanceVerdict =
    counts.fail > 0 ? 'fail' : counts.pending > 0 || counts.total === 0 ? 'incomplete' : 'pass'
  return { counts, verdict }
}
