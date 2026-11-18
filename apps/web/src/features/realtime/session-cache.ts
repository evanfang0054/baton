import type { SessionEventRecord, SessionEventsResponse } from '@baton/protocol'

/** 判断一批事件是否严格递增且全部晚于已有序列表；是则无需 Set/sort。 */
export function isAppendOnly(
  previous: SessionEventsResponse,
  records: SessionEventRecord[],
): boolean {
  if (records.length === 0) return false
  let last = previous.events.at(-1)?.seq ?? 0
  for (const record of records) {
    if (record.seq <= last) return false
    last = record.seq
  }
  return true
}

/** 合并一批 WebSocket 实时事件；按 session 内 seq 去重并保持升序。 */
export function appendSessionEvents(
  previous: SessionEventsResponse | undefined,
  records: SessionEventRecord[],
): SessionEventsResponse | undefined {
  if (!previous || records.length === 0) return previous
  if (isAppendOnly(previous, records)) {
    return { ...previous, events: [...previous.events, ...records] }
  }
  const known = new Set(previous.events.map((event) => event.seq))
  const events = [...previous.events]
  for (const record of records) {
    if (known.has(record.seq)) continue
    known.add(record.seq)
    events.push(record)
  }
  if (events.length === previous.events.length) return previous
  events.sort((a, b) => a.seq - b.seq)
  // nextSeq 是 REST 分页游标，不能被实时事件推高，否则会跳过中间未加载的记录。
  return { ...previous, events }
}

/** 合并下一页 REST 历史；nextSeq/hasMore 以新页为准。 */
export function mergeSessionPage(
  previous: SessionEventsResponse | undefined,
  page: SessionEventsResponse,
): SessionEventsResponse {
  if (!previous) return page
  if (page.events.length === 0) return { ...page, events: previous.events }
  if (isAppendOnly(previous, page.events)) {
    return { ...page, events: [...previous.events, ...page.events] }
  }
  const known = new Set(previous.events.map((event) => event.seq))
  const events = [...previous.events, ...page.events.filter((event) => !known.has(event.seq))]
  events.sort((a, b) => a.seq - b.seq)
  return { ...page, events }
}

export function appendSessionEvent(
  previous: SessionEventsResponse | undefined,
  record: SessionEventRecord,
): SessionEventsResponse | undefined {
  return appendSessionEvents(previous, [record])
}
