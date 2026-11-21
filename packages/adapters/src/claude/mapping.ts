import {
  APPROVAL_REQUEST_EVENT,
  EventType,
  SESSION_OUTCOME_EVENT,
  SESSION_USAGE_EVENT,
  type AgentEvent,
  type ApprovalRequest,
} from '@baton/protocol'

export function mapRunStarted(threadId: string, runId: string): AgentEvent {
  return { type: EventType.RUN_STARTED, threadId, runId }
}

export function mapRunFinished(threadId: string, runId: string): AgentEvent {
  return { type: EventType.RUN_FINISHED, threadId, runId }
}

export function mapRunError(message: string): AgentEvent {
  return { type: EventType.RUN_ERROR, message }
}

export function mapText(text: string, messageId: string): AgentEvent[] {
  return [
    { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text },
    { type: EventType.TEXT_MESSAGE_END, messageId },
  ]
}

export function mapToolUse(id: string, name: string, input: unknown): AgentEvent[] {
  return [
    { type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: name },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: JSON.stringify(input ?? {}) },
    { type: EventType.TOOL_CALL_END, toolCallId: id },
  ]
}

export function mapToolResult(messageId: string, toolCallId: string, content: string): AgentEvent {
  return { type: EventType.TOOL_CALL_RESULT, messageId, toolCallId, content }
}

export function mapApprovalRequest(requestId: string, request: ApprovalRequest): AgentEvent {
  return {
    type: EventType.CUSTOM,
    name: APPROVAL_REQUEST_EVENT,
    value: { requestId, request },
  }
}

export function mapSessionOutcome(
  outcome: 'ready' | 'blocked' | 'dropped',
  reason?: string,
): AgentEvent {
  return {
    type: EventType.CUSTOM,
    name: SESSION_OUTCOME_EVENT,
    value: { outcome, ...(reason ? { reason } : {}) },
  }
}

export function mapSessionUsage(
  costUsd: number | undefined,
  turns: number | undefined,
): AgentEvent {
  return {
    type: EventType.CUSTOM,
    name: SESSION_USAGE_EVENT,
    value: {
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(turns !== undefined ? { turns } : {}),
    },
  }
}
