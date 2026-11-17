import type { AgentEvent } from './agui.js'
import type { ApprovalDecision, Engine, PermissionMode } from './enums.js'
import type { Policy } from './policy.js'

/** 执行期只读的策略快照；daemon 从 PolicySchema 解析后传入。 */
export type PolicySnapshot = Policy

export interface StartInput {
  prompt: string
  cwd: string
  systemPrompt?: string
  resumeSessionId?: string
  permissionMode: PermissionMode
  policy: PolicySnapshot
}

export interface AgentRun {
  events: AsyncIterable<AgentEvent>
  approve(requestId: string, decision: ApprovalDecision, note?: string): Promise<void>
  send(text: string): Promise<void>
  interrupt(): Promise<void>
  dispose(): Promise<void>
}

export interface AgentAdapter {
  readonly name: Engine
  start(input: StartInput): Promise<AgentRun>
}
