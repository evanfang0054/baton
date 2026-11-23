import { z } from 'zod'
import { DiffStat, Id } from './common.js'
import { ContextInjection } from './context.js'
import { SessionOutcome } from './enums.js'

export const TaskTransitionEvent = z
  .discriminatedUnion('type', [
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
      type: z.literal('session_reported'),
      outcome: SessionOutcome.exclude(['ready']),
      reason: z.string().min(1).optional(),
    }),
    z.object({
      type: z.literal('user_input'),
      text: z.string().min(1).max(64_000),
      contextInjection: ContextInjection.optional(),
    }),
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
      /** false 表示重试也不会成功（如未配置 verify 命令），禁止自动重试。 */
      retryable: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('approve'),
      reviewId: Id,
      /** verify 失败/跳过或显式填理由时的覆盖审计；由 daemon 在同一事务内落库。 */
      override: z
        .object({
          verifyExitCode: z.number().int(),
          reasonProvided: z.boolean(),
        })
        .optional(),
    }),
    z.object({
      type: z.literal('reject'),
      reviewId: Id,
      feedback: z.string().min(1),
      contextInjection: ContextInjection.optional(),
      contextBlock: z.string().max(64_000).optional(),
    }),
    z.object({ type: z.literal('retry'), note: z.string().min(1).max(16_384).optional() }),
    z.object({ type: z.literal('reopen'), note: z.string().min(1).max(16_384).optional() }),
    z.object({ type: z.literal('cancel'), reason: z.string().min(1).optional() }),
    z.object({ type: z.literal('error'), message: z.string().min(1) }),
  ])
  .superRefine((event, ctx) => {
    if (
      event.type === 'reject' &&
      Boolean(event.contextInjection) !== Boolean(event.contextBlock)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'contextInjection and contextBlock must be provided together',
      })
    }
  })
export type TaskTransitionEvent = z.infer<typeof TaskTransitionEvent>
