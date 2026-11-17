import { z } from 'zod'
import { Id } from './common.js'
import { TaskStatus } from './enums.js'
import { Approval, Canvas, Edge, Node, Review, Session, Task, Workspace } from './entities/index.js'

export const WorkspaceCreateInput = z.object({
  name: z.string().min(1),
  relPath: z.string().min(1),
})
export type WorkspaceCreateInput = z.infer<typeof WorkspaceCreateInput>

export const WorkspaceListResponse = z.object({ workspaces: z.array(Workspace) })
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponse>

export const WorkspaceCreateResponse = z.object({ workspace: Workspace, canvas: Canvas })
export type WorkspaceCreateResponse = z.infer<typeof WorkspaceCreateResponse>

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

export const TaskListResponse = z.object({ tasks: z.array(Task) })
export type TaskListResponse = z.infer<typeof TaskListResponse>

export const TaskDetailResponse = z.object({
  task: Task,
  sessions: z.array(Session),
  approvals: z.array(Approval),
  review: Review.nullable(),
})
export type TaskDetailResponse = z.infer<typeof TaskDetailResponse>
