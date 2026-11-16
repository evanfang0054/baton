import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const Audit = z.object({
  id: Id,
  ts: Timestamp,
  actor: z.string().min(1),
  action: z.string().min(1),
  detail: z.unknown(),
})
export type Audit = z.infer<typeof Audit>
