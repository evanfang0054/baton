import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const Event = z.object({
  id: Id,
  sessionId: Id,
  ordinal: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.unknown(),
  ts: Timestamp,
})
export type Event = z.infer<typeof Event>
