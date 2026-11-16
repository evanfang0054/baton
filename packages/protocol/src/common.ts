import { z } from 'zod'

export const Id = z.string().min(1)
export type Id = z.infer<typeof Id>

export const Timestamp = z.number().int().nonnegative()
export type Timestamp = z.infer<typeof Timestamp>

export const DiffStat = z.object({
  filesChanged: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
})
export type DiffStat = z.infer<typeof DiffStat>

export const Viewport = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
})
export type Viewport = z.infer<typeof Viewport>
