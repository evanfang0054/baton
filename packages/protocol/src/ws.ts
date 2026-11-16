import { z } from 'zod'

export const WsEnvelope = z.object({
  v: z.literal(1),
  type: z.string().min(1),
  id: z.string().optional(),
  ts: z.number().int(),
  seq: z.number().int().optional(),
  payload: z.unknown(),
})

export const WsPing = z.object({ type: z.literal('ping'), id: z.string().min(1) })
export const WsPong = z.object({
  type: z.literal('pong'),
  id: z.string().min(1),
  ts: z.number().int(),
})

export type WsEnvelope = z.infer<typeof WsEnvelope>
export type WsPing = z.infer<typeof WsPing>
export type WsPong = z.infer<typeof WsPong>
