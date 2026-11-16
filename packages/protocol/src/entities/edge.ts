import { z } from 'zod'
import { Id } from '../common.js'
import { EdgeType } from '../enums.js'

export const Edge = z.object({
  id: Id,
  canvasId: Id,
  sourceId: Id,
  targetId: Id,
  type: EdgeType,
})
export type Edge = z.infer<typeof Edge>
