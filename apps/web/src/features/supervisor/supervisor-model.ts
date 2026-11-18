export type SupervisorStreamStatus = 'idle' | 'streaming' | 'error'

export interface SupervisorStreamTool {
  id: string
  name: string
  phase: 'start' | 'end'
  ok?: boolean
  summary?: string
}

export interface SupervisorStreamProjection {
  threadId: string | null
  messageId: string | null
  text: string
  tools: SupervisorStreamTool[]
  status: SupervisorStreamStatus
}

export interface SupervisorDeltaInput {
  threadId: string
  messageId: string
  delta: string
}

export interface SupervisorToolInput {
  threadId: string
  messageId: string
  toolCallId: string
  name: string
  phase: 'start' | 'end'
  ok?: boolean
  summary?: string
}

export function createStreamState(): SupervisorStreamProjection {
  return { threadId: null, messageId: null, text: '', tools: [], status: 'idle' }
}

/** 只投影当前在途的一条消息；旧消息的迟到事件直接丢弃。 */
export function applyDelta(
  state: SupervisorStreamProjection,
  event: SupervisorDeltaInput,
): SupervisorStreamProjection {
  if (state.messageId !== null && state.messageId !== event.messageId) return state
  const sameMessage = state.messageId === event.messageId
  return {
    threadId: event.threadId,
    messageId: event.messageId,
    text: sameMessage ? state.text + event.delta : event.delta,
    tools: sameMessage ? state.tools : [],
    status: 'streaming',
  }
}

export function applyTool(
  state: SupervisorStreamProjection,
  event: SupervisorToolInput,
): SupervisorStreamProjection {
  if (state.messageId !== null && state.messageId !== event.messageId) return state
  const sameMessage = state.messageId === event.messageId
  const tools = sameMessage ? state.tools : []
  const index = tools.findIndex((tool) => tool.id === event.toolCallId)
  const previous = index >= 0 ? tools[index] : undefined
  const ok = event.ok ?? previous?.ok
  const summary = event.summary ?? previous?.summary
  const next: SupervisorStreamTool = {
    id: event.toolCallId,
    name: event.name,
    phase: event.phase,
    ...(ok !== undefined ? { ok } : {}),
    ...(summary !== undefined ? { summary } : {}),
  }
  const nextTools =
    index >= 0 ? tools.map((tool, i) => (i === index ? next : tool)) : [...tools, next]
  return {
    threadId: event.threadId,
    messageId: event.messageId,
    text: sameMessage ? state.text : '',
    tools: nextTools,
    status: 'streaming',
  }
}

export function finishStream(): SupervisorStreamProjection {
  return createStreamState()
}
