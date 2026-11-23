import { z } from 'zod'
import { Id, Timestamp } from './common.js'

export const AttentionKind = z.enum(['approval', 'reply', 'review', 'failed', 'stale'])
export type AttentionKind = z.infer<typeof AttentionKind>

export const AttentionItem = z
  .object({
    taskId: Id,
    title: z.string().min(1),
    kind: AttentionKind,
    reason: z.string().min(1).max(200),
    waitingSince: Timestamp.nullable(),
    proposalId: Id.nullable(),
    action: z.discriminatedUnion('type', [
      z.object({ type: z.literal('open_task') }),
      z.object({ type: z.literal('open_review') }),
      z.object({ type: z.literal('apply_proposal'), proposalId: Id }),
    ]),
  })
  .strict()
export type AttentionItem = z.infer<typeof AttentionItem>

export const AttentionCounts = z
  .object({
    approval: z.number().int().nonnegative(),
    reply: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
  })
  .strict()
export type AttentionCounts = z.infer<typeof AttentionCounts>

export const EMPTY_ATTENTION_COUNTS: AttentionCounts = {
  approval: 0,
  reply: 0,
  review: 0,
  failed: 0,
  stale: 0,
}

export const DigestAttention = z
  .object({
    items: z.array(AttentionItem).max(20),
    counts: AttentionCounts,
  })
  .strict()
export type DigestAttention = z.infer<typeof DigestAttention>
