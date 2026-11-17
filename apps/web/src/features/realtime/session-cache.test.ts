import type { SessionEventsResponse } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { appendSessionEvent, appendSessionEvents, mergeSessionPage } from './session-cache'

const empty: SessionEventsResponse = {
  sessionId: 's1',
  events: [],
  nextSeq: 0,
  hasMore: false,
}

function record(seq: number) {
  return {
    seq,
    ts: seq,
    type: 'RUN_STARTED',
    payload: { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
  }
}

describe('session cache', () => {
  it('appends, sorts and de-dupes by seq without moving the page cursor', () => {
    const once = appendSessionEvents(empty, [record(2), record(1)])
    expect(once?.events.map((event) => event.seq)).toEqual([1, 2])
    expect(once?.nextSeq).toBe(0)

    const twice = appendSessionEvents(once, [record(2), record(3), record(1)])
    expect(twice?.events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(twice?.nextSeq).toBe(0)

    const unchanged = appendSessionEvents(twice, [record(1)])
    expect(unchanged).toBe(twice)
  })

  it('merges a later page and keeps its cursor', () => {
    const first: SessionEventsResponse = {
      sessionId: 's1',
      events: [record(1)],
      nextSeq: 1,
      hasMore: true,
    }
    const merged = mergeSessionPage(first, {
      sessionId: 's1',
      events: [record(2), record(3)],
      nextSeq: 3,
      hasMore: false,
    })
    expect(merged.events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(merged.nextSeq).toBe(3)
    expect(merged.hasMore).toBe(false)
  })

  it('keeps an empty cache empty', () => {
    expect(appendSessionEvent(undefined, record(1))).toBeUndefined()
  })
})
