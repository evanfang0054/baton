import {
  APPROVAL_REQUEST_EVENT,
  SESSION_OUTCOME_EVENT,
  USER_MESSAGE_EVENT,
  type SessionEventRecord,
} from '@baton/protocol'

export type TranscriptRole = 'user' | 'assistant' | 'tool' | 'system'

export interface TranscriptEntry {
  id: string
  role: TranscriptRole
  title: string
  text: string
  mono: boolean
  ts: number
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function roleLabel(role: unknown): { role: TranscriptRole; title: string } {
  if (role === 'user') return { role: 'user', title: '你' }
  if (role === 'system' || role === 'developer') return { role: 'system', title: '系统' }
  return { role: 'assistant', title: 'Agent' }
}

function systemEntry(
  id: string,
  title: string,
  text: string,
  ts: number,
  mono = false,
): TranscriptEntry {
  return { id, role: 'system', title, text, mono, ts }
}

/**
 * 把 AG-UI 事件投影成可渲染的 transcript。
 * 只消费已知事件；未知 payload 不抛错，避免一条坏事件拖垮整个详情面板。
 */
export function buildTranscript(events: SessionEventRecord[]): TranscriptEntry[] {
  const seen = new Set<number>()
  const ordered = events
    .filter((event) => {
      if (seen.has(event.seq)) return false
      seen.add(event.seq)
      return true
    })
    .sort((a, b) => a.seq - b.seq)

  const entries: TranscriptEntry[] = []
  const messages = new Map<string, TranscriptEntry>()
  const tools = new Map<string, { entry: TranscriptEntry; args: string; result: string }>()

  const ensureMessage = (messageId: string, ts: number, role: unknown) => {
    const existing = messages.get(messageId)
    if (existing) return existing
    const config = roleLabel(role)
    const entry: TranscriptEntry = {
      id: `msg-${messageId}`,
      role: config.role,
      title: config.title,
      text: '',
      mono: false,
      ts,
    }
    messages.set(messageId, entry)
    entries.push(entry)
    return entry
  }

  const ensureTool = (toolCallId: string, ts: number, name: unknown) => {
    const existing = tools.get(toolCallId)
    if (existing) return existing
    const entry: TranscriptEntry = {
      id: `tool-${toolCallId}`,
      role: 'tool',
      title: textOf(name) || '工具',
      text: '',
      mono: true,
      ts,
    }
    const draft = { entry, args: '', result: '' }
    tools.set(toolCallId, draft)
    entries.push(entry)
    return draft
  }

  const flushTool = (draft: { entry: TranscriptEntry; args: string; result: string }) => {
    const chunks = [draft.args.trim()]
    if (draft.result.trim()) chunks.push(`→ ${draft.result.trim()}`)
    draft.entry.text = chunks.filter(Boolean).join('\n')
  }

  for (const event of ordered) {
    const payload = recordOf(event.payload)
    if (!payload) continue
    const type = textOf(payload.type) || event.type
    const ts = event.ts

    switch (type) {
      case 'TEXT_MESSAGE_START': {
        const messageId = textOf(payload.messageId)
        if (messageId) ensureMessage(messageId, ts, payload.role)
        break
      }
      case 'TEXT_MESSAGE_CONTENT': {
        const messageId = textOf(payload.messageId)
        if (!messageId) break
        const entry = ensureMessage(messageId, ts, payload.role)
        entry.text += textOf(payload.delta)
        break
      }
      case 'TEXT_MESSAGE_END':
        break
      case 'TOOL_CALL_START': {
        const toolCallId = textOf(payload.toolCallId)
        if (toolCallId) ensureTool(toolCallId, ts, payload.toolCallName)
        break
      }
      case 'TOOL_CALL_ARGS': {
        const toolCallId = textOf(payload.toolCallId)
        if (!toolCallId) break
        const draft = ensureTool(toolCallId, ts, payload.toolCallName)
        draft.args += textOf(payload.delta)
        flushTool(draft)
        break
      }
      case 'TOOL_CALL_END':
        break
      case 'TOOL_CALL_RESULT': {
        const toolCallId = textOf(payload.toolCallId)
        if (!toolCallId) break
        const draft = ensureTool(toolCallId, ts, payload.toolCallName)
        const content = payload.content
        draft.result =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content
                  .map((part) => {
                    const item = recordOf(part)
                    return item?.type === 'text' ? textOf(item.text) : ''
                  })
                  .filter(Boolean)
                  .join('\n')
              : ''
        flushTool(draft)
        break
      }
      case 'RUN_STARTED':
        entries.push(systemEntry(`seq-${event.seq}`, '系统', '运行开始', ts))
        break
      case 'RUN_FINISHED':
        entries.push(systemEntry(`seq-${event.seq}`, '系统', '运行结束', ts))
        break
      case 'RUN_ERROR':
        entries.push(
          systemEntry(`seq-${event.seq}`, '系统', `运行失败：${textOf(payload.message)}`, ts),
        )
        break
      case 'CUSTOM': {
        const name = textOf(payload.name)
        const value = recordOf(payload.value) ?? {}
        if (name === USER_MESSAGE_EVENT) {
          entries.push({
            id: `seq-${event.seq}`,
            role: 'user',
            title: '你',
            text: textOf(value.text),
            mono: false,
            ts,
          })
        } else if (name === APPROVAL_REQUEST_EVENT) {
          const request = recordOf(value.request) ?? {}
          const input = request.input === undefined ? '' : JSON.stringify(request.input, null, 2)
          entries.push(
            systemEntry(
              `seq-${event.seq}`,
              '请求审批',
              `${textOf(request.toolName)}\n${input}`.trim(),
              ts,
              true,
            ),
          )
        } else if (name === SESSION_OUTCOME_EVENT) {
          const outcome = textOf(value.outcome)
          const reason = textOf(value.reason)
          entries.push(systemEntry(`seq-${event.seq}`, `会话 ${outcome}`, reason, ts))
        } else if (name) {
          entries.push(systemEntry(`seq-${event.seq}`, name, '', ts))
        }
        break
      }
      default:
        break
    }
  }

  return entries
}
