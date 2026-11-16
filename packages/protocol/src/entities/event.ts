import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const Event = z.object({
  id: Id,
  sessionId: Id,
  /** 全局单调游标：WS sinceSeq 用它做跨 session 重放。 */
  ordinal: z.number().int().nonnegative(),
  /** 会话内单调序号：只用于排序同一 session 的 AG-UI 事件，不参与跨 session 重放。 */
  seq: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.unknown(),
  ts: Timestamp,
})
export type Event = z.infer<typeof Event>
