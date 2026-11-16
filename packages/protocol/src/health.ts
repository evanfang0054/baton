import { z } from 'zod'

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  uptimeSec: z.number().nonnegative(),
})

export type HealthResponse = z.infer<typeof HealthResponse>
