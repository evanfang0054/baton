import { z } from 'zod'

export const TaskStatus = z.enum([
  'todo',
  'queued',
  'running',
  'waiting_input',
  'verifying',
  'review',
  'done',
  'failed',
  'cancelled',
])
export type TaskStatus = z.infer<typeof TaskStatus>

/** 允许生成交接节点的源任务状态；daemon 与 web 共用，避免两处漂移。 */
export const HANDOFFABLE_STATUSES = ['review', 'done', 'failed', 'cancelled'] as const
export type HandoffableStatus = (typeof HANDOFFABLE_STATUSES)[number]

export function isHandoffable(status: TaskStatus): status is HandoffableStatus {
  return (HANDOFFABLE_STATUSES as readonly TaskStatus[]).includes(status)
}

export const NodeType = z.enum(['text', 'image', 'file', 'agent', 'review', 'group'])
export type NodeType = z.infer<typeof NodeType>

export const EdgeType = z.literal('context')
export type EdgeType = z.infer<typeof EdgeType>

export const SessionStatus = z.enum(['running', 'waiting_input', 'ended', 'failed'])
export type SessionStatus = z.infer<typeof SessionStatus>

export const SessionOutcome = z.enum(['ready', 'blocked', 'dropped', 'unreported'])
export type SessionOutcome = z.infer<typeof SessionOutcome>

export const WaitingReason = z.enum(['approval', 'question', 'stalled', 'dropped'])
export type WaitingReason = z.infer<typeof WaitingReason>

export const Attention = z.enum([
  'none',
  'needs_approval',
  'needs_reply',
  'needs_attention',
  'needs_review',
])
export type Attention = z.infer<typeof Attention>

export const ApprovalDecision = z.enum(['allow', 'deny'])
export type ApprovalDecision = z.infer<typeof ApprovalDecision>

/** 审批风险级别；policy 阈值与 ApprovalRequest 共用同一枚举，避免两侧漂移。 */
export const RiskLevel = z.enum(['low', 'medium', 'high'])
export type RiskLevel = z.infer<typeof RiskLevel>

/** 人工验收结论；机器结果看 Review.verifyExitCode，不要混用。 */
export const ReviewVerdict = z.enum(['approved', 'rejected'])
export type ReviewVerdict = z.infer<typeof ReviewVerdict>

export const Engine = z.enum(['claude-sdk', 'pty', 'fake'])
export type Engine = z.infer<typeof Engine>

export const WorkspaceMode = z.enum(['main', 'worktree'])
export type WorkspaceMode = z.infer<typeof WorkspaceMode>

/** 执行器的权限模式；manual 为人工逐条审批。 */
export const PermissionMode = z.enum(['manual', 'acceptEdits', 'plan'])
export type PermissionMode = z.infer<typeof PermissionMode>
