import { z } from 'zod'
import { DiffStat, Id, Timestamp } from '../common.js'
import { ReviewVerdict } from '../enums.js'

export const Review = z.object({
  id: Id,
  taskId: Id,
  verdict: ReviewVerdict.nullable(),
  verifyExitCode: z.number().int().nullable(),
  verifyOutput: z.string().nullable(),
  diffStat: DiffStat.nullable(),
  decidedAt: Timestamp.nullable(),
})
export type Review = z.infer<typeof Review>
