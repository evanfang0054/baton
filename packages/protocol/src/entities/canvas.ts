import { z } from 'zod'
import { Id, Viewport } from '../common.js'

export const Canvas = z.object({
  id: Id,
  workspaceId: Id,
  viewport: Viewport,
})
export type Canvas = z.infer<typeof Canvas>
