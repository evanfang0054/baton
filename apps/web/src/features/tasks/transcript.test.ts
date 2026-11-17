import type { SessionEventRecord } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { buildTranscript } from './transcript-model'

function event(seq: number, type: string, payload: unknown, ts = seq): SessionEventRecord {
  return { seq, type, payload, ts }
}

describe('buildTranscript', () => {
  it('merges assistant text chunks by messageId', () => {
    const entries = buildTranscript([
      event(1, 'TEXT_MESSAGE_START', {
        type: 'TEXT_MESSAGE_START',
        messageId: 'm1',
        role: 'assistant',
      }),
      event(2, 'TEXT_MESSAGE_CONTENT', {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'm1',
        delta: '你',
      }),
      event(3, 'TEXT_MESSAGE_CONTENT', {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'm1',
        delta: '好',
      }),
      event(4, 'TEXT_MESSAGE_END', { type: 'TEXT_MESSAGE_END', messageId: 'm1' }),
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ role: 'assistant', title: 'Agent', text: '你好' })
  })

  it('renders user, approval and outcome custom events', () => {
    const entries = buildTranscript([
      event(1, 'CUSTOM', {
        type: 'CUSTOM',
        name: 'user.message',
        value: { text: '继续' },
      }),
      event(2, 'CUSTOM', {
        type: 'CUSTOM',
        name: 'approval.request',
        value: {
          requestId: 'r1',
          request: { toolName: 'Bash', input: { command: 'pnpm test' }, risk: 'medium' },
        },
      }),
      event(3, 'CUSTOM', {
        type: 'CUSTOM',
        name: 'session.outcome',
        value: { outcome: 'blocked', reason: '需要确认' },
      }),
    ])
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ role: 'user', text: '继续' })
    expect(entries[1]).toMatchObject({ role: 'system', title: '请求审批', mono: true })
    expect(entries[1]!.text).toContain('Bash')
    expect(entries[1]!.text).toContain('pnpm test')
    expect(entries[2]).toMatchObject({ role: 'system', title: '会话 blocked', text: '需要确认' })
  })

  it('renders tool call args and result as one mono entry', () => {
    const entries = buildTranscript([
      event(1, 'TOOL_CALL_START', {
        type: 'TOOL_CALL_START',
        toolCallId: 'tc1',
        toolCallName: 'Bash',
      }),
      event(2, 'TOOL_CALL_ARGS', {
        type: 'TOOL_CALL_ARGS',
        toolCallId: 'tc1',
        delta: '{"command":"ls"}',
      }),
      event(3, 'TOOL_CALL_RESULT', {
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'tc1',
        messageId: 'm2',
        content: 'file.txt',
      }),
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ role: 'tool', title: 'Bash', mono: true })
    expect(entries[0]!.text).toContain('{"command":"ls"}')
    expect(entries[0]!.text).toContain('→ file.txt')
  })

  it('drops duplicate seq values and sorts by seq', () => {
    const entries = buildTranscript([
      event(2, 'RUN_FINISHED', { type: 'RUN_FINISHED', threadId: 't', runId: 'r' }),
      event(1, 'CUSTOM', { type: 'CUSTOM', name: 'user.message', value: { text: '先' } }),
      event(1, 'CUSTOM', { type: 'CUSTOM', name: 'user.message', value: { text: '重复' } }),
    ])
    expect(entries.map((entry) => entry.text)).toEqual(['先', '运行结束'])
  })

  it('ignores unknown or malformed payloads', () => {
    const entries = buildTranscript([
      event(1, 'STATE_SNAPSHOT', { type: 'STATE_SNAPSHOT' }),
      event(2, 'TEXT_MESSAGE_CONTENT', null),
    ])
    expect(entries).toEqual([])
  })
})
