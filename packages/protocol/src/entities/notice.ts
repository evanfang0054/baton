import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const Notice = z.object({
  id: Id,
  ts: Timestamp,
  kind: z.string().min(1),
  payload: z.unknown(),
  readAt: Timestamp.nullable(),
})
export type Notice = z.infer<typeof Notice>
