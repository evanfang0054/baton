import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const Workspace = z.object({
  id: Id,
  name: z.string().min(1),
  /** 相对 BATON_WORKSPACES_ROOT；路径 jail 与真实路径解析由 daemon 的 resolveWithin 负责。 */
  relPath: z.string().min(1),
  createdAt: Timestamp,
})
export type Workspace = z.infer<typeof Workspace>
