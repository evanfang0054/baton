import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { ContextSnapshot } from '../context.js'
import { Engine, TaskStatus, WaitingReason, WorkspaceMode } from '../enums.js'
import { TaskOrigin } from '../supervisor.js'

export const Task = z.object({
  id: Id,
  workspaceId: Id,
  nodeId: Id.nullable(),
  title: z.string().min(1),
  prompt: z.string(),
  status: TaskStatus,
  waitingReason: WaitingReason.nullable(),
  engine: Engine,
  workspaceMode: WorkspaceMode,
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  verifyCommand: z.string().nullable(),
  retryCount: z.number().int().nonnegative(),
  /** 仅该任务跳过 SDK 权限审批；默认 false，需全局开关与已信任 workspace。 */
  dangerouslySkipPermissions: z.boolean(),
  /** 任务级预算；null 表示继承全局 claudeMaxBudgetUsd。 */
  budgetUsd: z.number().nonnegative().nullable().default(null),
  enqueuedAt: Timestamp.nullable().default(null),
  deliveryId: Id.nullable().default(null),
  stageKey: z.string().min(1).max(32).nullable().default(null),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Task = z.infer<typeof Task>

export const TaskDetail = Task.extend({
  context: ContextSnapshot.nullable().default(null),
  origin: TaskOrigin.nullable().default(null),
  annotationIds: z.array(Id).default([]),
})
export type TaskDetail = z.infer<typeof TaskDetail>
