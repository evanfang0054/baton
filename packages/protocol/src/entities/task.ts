import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { Engine, TaskStatus, WorkspaceMode } from '../enums.js'

export const Task = z.object({
  id: Id,
  workspaceId: Id,
  nodeId: Id.nullable(),
  title: z.string().min(1),
  prompt: z.string(),
  status: TaskStatus,
  engine: Engine,
  workspaceMode: WorkspaceMode,
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  verifyCommand: z.string().nullable(),
  retryCount: z.number().int().nonnegative(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Task = z.infer<typeof Task>
