import type { ContextSnapshot, TaskStatus, WaitingReason } from '@baton/protocol'
import { canAcceptUserInput } from '../state-machine/attention.js'
import { assemblePayload, escapeAttr, type AssemblePayload } from './assemble.js'
import type { AssembleContextInput } from './types.js'

export interface CanInjectResult {
  ok: boolean
  reason?: 'approval_pending' | 'use_review_reject' | 'running' | 'terminal'
}

export function canInjectContext(task: {
  status: TaskStatus
  waitingReason: WaitingReason | null
}): CanInjectResult {
  if (task.status === 'todo' || task.status === 'queued') return { ok: true }
  if (task.status === 'waiting_input') {
    return canAcceptUserInput(task.waitingReason)
      ? { ok: true }
      : { ok: false, reason: 'approval_pending' }
  }
  if (task.status === 'review') return { ok: false, reason: 'use_review_reject' }
  if (task.status === 'running' || task.status === 'verifying') {
    return { ok: false, reason: 'running' }
  }
  return { ok: false, reason: 'terminal' }
}

export interface InjectionPayload extends AssemblePayload {
  /** 只把 included/dropped/truncated/redactedPaths/relations/relationsTruncated/chars
   * 写进 ContextInjection；不要把整个 payload spread 进 context_json。 */
  chars: number
}

export function assembleContextInjection(
  input: Omit<AssembleContextInput, 'taskPrompt' | 'targetNodeId'>,
): InjectionPayload {
  const payload = assemblePayload({
    ...input,
    taskPrompt: '',
    // 显式注入只从选中节点向上游闭包；不自动展开目标 Agent 的既有 context 边，
    // 否则每次注入都会重复初始上下文并消耗累计预算。
    targetNodeId: '',
  })
  const chars = payload.included.reduce((sum, item) => sum + item.chars, 0)
  return { ...payload, chars }
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function contextUpdateChars(assembled: InjectionPayload, note: string): number {
  return assembled.chars + escapeText(note).length
}

export function buildContextUpdateBlock(input: {
  seq: number
  at: number
  source: 'user' | 'supervisor'
  note: string
  assembled: InjectionPayload
}): string {
  const lines = [`<context_update seq="${input.seq}" at="${input.at}" source="${input.source}">`]
  if (input.note.length > 0) lines.push(`<note>${escapeText(input.note)}</note>`)
  if (input.assembled.body.length > 0) lines.push(input.assembled.body)
  if (input.assembled.truncatedIds.length > 0) {
    lines.push(`<truncated nodes="${escapeAttr(input.assembled.truncatedIds.join(','))}"/>`)
  }
  if (input.assembled.relationLines.length > 0) {
    const attr = input.assembled.relationsTruncated ? ' truncated="true"' : ''
    lines.push(`<relations${attr}>\n${input.assembled.relationLines.join('\n')}\n</relations>`)
  }
  lines.push('</context_update>')
  return lines.join('\n')
}

export function cumulativeInjectedChars(snapshot: ContextSnapshot | null): number {
  return snapshot?.injections?.reduce((sum, item) => sum + item.chars, 0) ?? 0
}
