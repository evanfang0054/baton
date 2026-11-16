import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const Workspace = z.object({
  id: Id,
  name: z.string().min(1),
  relPath: z.string().min(1),
  createdAt: Timestamp,
})
export type Workspace = z.infer<typeof Workspace>
