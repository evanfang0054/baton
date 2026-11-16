import { z } from 'zod'
import { DiffStat, Id, Timestamp } from '../common.js'
import { ReviewVerdict } from '../enums.js'

export const Review = z.object({
  id: Id,
  taskId: Id,
  /** 人的验收决定；null 表示尚未决定，不要用它表达 verify 结果。 */
  verdict: ReviewVerdict.nullable(),
  /** 机器验收结果；review 行只在 verify 执行后创建，因此必填。 */
  verifyExitCode: z.number().int(),
  verifyOutput: z.string(),
  diffStat: DiffStat,
  decidedAt: Timestamp.nullable(),
})
export type Review = z.infer<typeof Review>
