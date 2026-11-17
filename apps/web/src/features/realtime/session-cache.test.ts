import type { SessionEventsResponse } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { appendSessionEvent, appendSessionEvents } from './session-cache'

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
  it('appends, sorts and de-dupes by seq', () => {
    const once = appendSessionEvents(empty, [record(2), record(1)])
    expect(once?.events.map((event) => event.seq)).toEqual([1, 2])
    expect(once?.nextSeq).toBe(2)

    const twice = appendSessionEvents(once, [record(2), record(3), record(1)])
    expect(twice?.events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(twice?.nextSeq).toBe(3)

    const unchanged = appendSessionEvents(twice, [record(1)])
    expect(unchanged).toBe(twice)
  })

  it('keeps an empty cache empty', () => {
    expect(appendSessionEvent(undefined, record(1))).toBeUndefined()
  })
})
