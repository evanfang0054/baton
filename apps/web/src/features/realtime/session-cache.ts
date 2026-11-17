import type { SessionEventRecord, SessionEventsResponse } from '@baton/protocol'

/** 合并 WebSocket 实时事件；按 session 内 seq 去重并保持升序。 */
export function appendSessionEvent(
  previous: SessionEventsResponse | undefined,
  record: SessionEventRecord,
): SessionEventsResponse | undefined {
  if (!previous) return previous
  if (previous.events.some((event) => event.seq === record.seq)) return previous
  const events = [...previous.events, record].sort((a, b) => a.seq - b.seq)
  return {
    ...previous,
    events,
    nextSeq: Math.max(previous.nextSeq, record.seq),
  }
}
