import type { AgentEvent } from './agui.js'
import type { ApprovalDecision, Engine, PermissionMode } from './enums.js'
import type { Policy } from './policy.js'

/** 执行期只读的策略快照；daemon 从 PolicySchema 解析后传入。 */
export type PolicySnapshot = Readonly<Policy>

/** 会话启动时冻结的 trust 决策；运行中修改 workspace trust 不影响已启动会话。 */
export interface WorkspaceTrustSnapshot {
  projectSettings: boolean
  projectHooks: boolean
}

export interface StartInput {
  prompt: string
  cwd: string
  systemPrompt?: string
  resumeSessionId?: string
  permissionMode: PermissionMode
  policy: PolicySnapshot
  workspaceTrust: WorkspaceTrustSnapshot
}

export interface AgentRun {
  /**
   * 适配器必须在本轮结束前发出 `session.outcome`：
   * `ready` 后跟 RUN_FINISHED；`blocked`/`dropped` 保持事件流打开，等待 `send`。
   * 禁止上报 `unreported`，该值只由 daemon 在流静默结束时合成。
   */
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
