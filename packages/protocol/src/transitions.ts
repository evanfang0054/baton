import { z } from 'zod'
import { DiffStat, Id } from './common.js'

export const TaskTransitionEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('enqueue') }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('approval_requested'), approvalId: Id }),
  z.object({ type: z.literal('approval_allow'), approvalId: Id }),
  z.object({
    type: z.literal('approval_deny'),
    approvalId: Id,
    note: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal('completed') }),
  z.object({
    type: z.literal('verify_ok'),
    reviewId: Id,
    exitCode: z.literal(0),
    output: z.string(),
    diffStat: DiffStat,
  }),
  z.object({
    type: z.literal('verify_fail'),
    reviewId: Id,
    exitCode: z
      .number()
      .int()
      .refine((n) => n !== 0, { message: 'exitCode must be non-zero' }),
    output: z.string(),
    diffStat: DiffStat,
  }),
  z.object({ type: z.literal('approve'), reviewId: Id }),
  z.object({ type: z.literal('reject'), reviewId: Id, feedback: z.string().min(1) }),
  z.object({ type: z.literal('cancel'), reason: z.string().min(1).optional() }),
  z.object({ type: z.literal('error'), message: z.string().min(1) }),
])
export type TaskTransitionEvent = z.infer<typeof TaskTransitionEvent>
