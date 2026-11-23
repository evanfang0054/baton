import { z } from 'zod'
import { Id, Timestamp } from './common.js'

export const FailureStage = z.enum(['launch', 'run', 'verify', 'review', 'verifier', 'unknown'])
export type FailureStage = z.infer<typeof FailureStage>

export const FailureSummary = z
  .object({
    stage: FailureStage,
    lastError: z.string().max(2000),
    retryable: z.boolean(),
    affectedPaths: z.array(z.string().max(500)).max(20),
    summary: z.string().max(2000),
    createdAt: Timestamp,
  })
  .strict()
export type FailureSummary = z.infer<typeof FailureSummary>

export const TaskFailure = FailureSummary.extend({
  id: Id,
  workspaceId: Id,
  taskId: Id,
  sessionId: Id.nullable(),
  attempt: z.number().int().nonnegative(),
}).strict()
export type TaskFailure = z.infer<typeof TaskFailure>
