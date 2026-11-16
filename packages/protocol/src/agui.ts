export { EventType } from '@ag-ui/core'
export { EventSchemas } from '@ag-ui/core/schemas'
import { EventSchemas } from '@ag-ui/core/schemas'
import type { z } from 'zod'

export type AgentEvent = z.infer<typeof EventSchemas>
