import type { PlanContextItem } from '@baton/protocol'

const SOURCE_RANK: Record<PlanContextItem['source'], number> = {
  same_agent: 5,
  handoff: 4,
  context_node: 3,
  recent_failure: 2,
  title: 1,
}

export function buildTaskContextDigest(input: {
  candidates: PlanContextItem[]
  max?: number
}): PlanContextItem[] {
  const byTask = new Map<string, PlanContextItem>()
  for (const candidate of input.candidates) {
    const previous = byTask.get(candidate.taskId)
    if (!previous || SOURCE_RANK[candidate.source] > SOURCE_RANK[previous.source]) {
      byTask.set(candidate.taskId, candidate)
    }
  }
  return [...byTask.values()]
    .sort(
      (a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source] || a.taskId.localeCompare(b.taskId),
    )
    .slice(0, input.max ?? 5)
}
