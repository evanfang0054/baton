import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { Engine, SessionOutcome, SessionStatus } from '../enums.js'

export const Session = z.object({
  id: Id,
  taskId: Id,
  adapter: Engine,
  engineSessionId: z.string().nullable(),
  status: SessionStatus,
  outcome: SessionOutcome.nullable(),
  costUsd: z.number().nonnegative().nullable().default(null),
  turns: z.number().int().nonnegative().nullable().default(null),
  startedAt: Timestamp,
  endedAt: Timestamp.nullable(),
})
export type Session = z.infer<typeof Session>
