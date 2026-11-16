import { z } from 'zod'

export const AppError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
})
export type AppError = z.infer<typeof AppError>
