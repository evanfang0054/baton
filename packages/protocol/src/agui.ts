// AG-UI 的事件 schema 只从 /schemas 子路径导出；主入口是 type-only。
import { EventSchemas } from '@ag-ui/core/schemas'
import type { z } from 'zod'

export { EventType } from '@ag-ui/core'
export { EventSchemas }
export type AgentEvent = z.infer<typeof EventSchemas>
