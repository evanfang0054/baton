import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { Engine, SessionStatus } from '../enums.js'

export const Session = z.object({
  id: Id,
  taskId: Id,
  adapter: Engine,
  engineSessionId: z.string().nullable(),
  status: SessionStatus,
  startedAt: Timestamp,
  endedAt: Timestamp.nullable(),
})
export type Session = z.infer<typeof Session>
