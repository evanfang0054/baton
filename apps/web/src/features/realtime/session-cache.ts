import type { SessionEventRecord, SessionEventsResponse } from '@baton/protocol'

/** 合并一批 WebSocket 实时事件；按 session 内 seq 去重并保持升序。 */
export function appendSessionEvents(
  previous: SessionEventsResponse | undefined,
  records: SessionEventRecord[],
): SessionEventsResponse | undefined {
  if (!previous) return previous
  const known = new Set(previous.events.map((event) => event.seq))
  const events = [...previous.events]
  for (const record of records) {
    if (known.has(record.seq)) continue
    known.add(record.seq)
    events.push(record)
  }
  if (events.length === previous.events.length) return previous
  events.sort((a, b) => a.seq - b.seq)
  return {
    ...previous,
    events,
    nextSeq: Math.max(previous.nextSeq, ...records.map((record) => record.seq)),
  }
}

export function appendSessionEvent(
  previous: SessionEventsResponse | undefined,
  record: SessionEventRecord,
): SessionEventsResponse | undefined {
  return appendSessionEvents(previous, [record])
}
