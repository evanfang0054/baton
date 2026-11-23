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

// cost/turn 只用于内部采集与日志；API 展示（任务详情/历史）不返回这两个字段。
export const SessionView = Session.omit({ costUsd: true, turns: true })
export type SessionView = z.infer<typeof SessionView>
