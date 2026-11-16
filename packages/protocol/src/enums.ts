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

export const NodeType = z.enum(['text', 'image', 'file', 'agent', 'review', 'group'])
export type NodeType = z.infer<typeof NodeType>

export const EdgeType = z.literal('context')
export type EdgeType = z.infer<typeof EdgeType>

export const SessionStatus = z.enum(['running', 'waiting_input', 'ended', 'failed'])
export type SessionStatus = z.infer<typeof SessionStatus>

export const ApprovalDecision = z.enum(['allow', 'deny'])
export type ApprovalDecision = z.infer<typeof ApprovalDecision>

export const ReviewVerdict = z.enum(['approved', 'rejected'])
export type ReviewVerdict = z.infer<typeof ReviewVerdict>

export const Engine = z.enum(['claude-sdk', 'pty', 'fake'])
export type Engine = z.infer<typeof Engine>

export const WorkspaceMode = z.enum(['main', 'worktree'])
export type WorkspaceMode = z.infer<typeof WorkspaceMode>
