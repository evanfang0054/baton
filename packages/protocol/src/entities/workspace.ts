import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const Workspace = z.object({
  id: Id,
  name: z.string().min(1),
  /** 相对 BATON_WORKSPACES_ROOT；路径 jail 与真实路径解析由 daemon 的 resolveWithin 负责。 */
  relPath: z.string().min(1),
  /** 用户显式信任后才允许加载项目 settings 与 hooks。 */
  trusted: z.boolean(),
  /** 项目 hooks 单独开关；trusted 为 false 时不生效。 */
  projectHooks: z.enum(['off', 'on']),
  trustedAt: Timestamp.nullable(),
  createdAt: Timestamp,
})
export type Workspace = z.infer<typeof Workspace>
