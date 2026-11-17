import { z } from 'zod'
import { Id, Timestamp } from './common.js'
import { Attention, TaskStatus } from './enums.js'
import {
  Approval,
  Canvas,
  Edge,
  Event,
  Node,
  Review,
  Session,
  Task,
  Workspace,
} from './entities/index.js'

export const WorkspaceCreateInput = z.object({
  name: z.string().min(1),
  relPath: z.string().min(1),
})
export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateInput>

export const WorkspaceListResponse = z.object({ workspaces: z.array(Workspace) })
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponse>

export const WorkspaceCreateResponse = z.object({ workspace: Workspace, canvas: Canvas })
export type WorkspaceCreateResponse = z.infer<typeof WorkspaceCreateResponse>

export const CanvasQuery = z.object({ workspaceId: Id })
export type CanvasQuery = z.infer<typeof CanvasQuery>

export const CanvasResponse = z.object({
  canvas: Canvas,
  nodes: z.array(Node),
  edges: z.array(Edge),
})
export type CanvasResponse = z.infer<typeof CanvasResponse>

export const TaskListQuery = z.object({
  workspaceId: Id,
  status: TaskStatus.optional(),
})
export type TaskListQuery = z.infer<typeof TaskListQuery>

export const TaskSummary = Task.extend({
  attention: Attention,
  waitingSince: Timestamp.nullable(),
})
export type TaskSummary = z.infer<typeof TaskSummary>

export const TaskListResponse = z.object({ tasks: z.array(TaskSummary) })
export type TaskListResponse = z.infer<typeof TaskListResponse>

export const SessionEventsQuery = z.object({
  sinceSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})
export type SessionEventsQuery = z.infer<typeof SessionEventsQuery>

export const SessionEventRecord = Event.pick({
  seq: true,
  type: true,
  payload: true,
  ts: true,
})
export type SessionEventRecord = z.infer<typeof SessionEventRecord>

export const SessionEventsResponse = z.object({
  sessionId: Id,
  events: z.array(SessionEventRecord),
  nextSeq: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})
export type SessionEventsResponse = z.infer<typeof SessionEventsResponse>

export const TaskDetailResponse = z.object({
  task: Task,
  sessions: z.array(Session),
  approvals: z.array(Approval),
  review: Review.nullable(),
  waitingSince: Timestamp.nullable(),
  attention: Attention,
})
export type TaskDetailResponse = z.infer<typeof TaskDetailResponse>
