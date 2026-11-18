import type { SessionEventRecord } from '@baton/protocol'

export function makeTextEvents(count: number, startSeq = 1): SessionEventRecord[] {
  const events: SessionEventRecord[] = []
  for (let i = 0; i < count; i += 1) {
    const seq = startSeq + i
    const messageId = `m-${Math.floor(i / 3)}`
    const phase = i % 3
    if (phase === 0) {
      events.push({
        seq,
        type: 'TEXT_MESSAGE_START',
        payload: { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
        ts: seq,
      })
    } else if (phase === 1) {
      events.push({
        seq,
        type: 'TEXT_MESSAGE_CONTENT',
        payload: { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: 'x'.repeat(32) },
        ts: seq,
      })
    } else {
      events.push({
        seq,
        type: 'TEXT_MESSAGE_END',
        payload: { type: 'TEXT_MESSAGE_END', messageId },
        ts: seq,
      })
    }
  }
  return events
}
