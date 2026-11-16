import { describe, expect, it } from 'vitest'
import * as protocol from '../src/index.js'
import type { AgentEvent } from '../src/index.js'

function acceptsAgentEvent(event: AgentEvent): AgentEvent {
  return event
}

const schemaNames = [
  'TaskStatus',
  'NodeType',
  'EdgeType',
  'SessionStatus',
  'ApprovalDecision',
  'RiskLevel',
  'ReviewVerdict',
  'Engine',
  'WorkspaceMode',
  'Id',
  'Timestamp',
  'DiffStat',
  'Viewport',
  'AppError',
  'PolicySchema',
  'Workspace',
  'Canvas',
  'Node',
  'Edge',
  'Task',
  'Session',
  'Event',
  'ApprovalRequest',
  'Approval',
  'Review',
  'Audit',
  'Notice',
  'TaskTransitionEvent',
  'ResumeInput',
  'TaskCreateInput',
  'TaskEnqueueInput',
  'TaskCancelInput',
  'ApprovalDecideInput',
  'ReviewDecideInput',
  'ClientMessage',
  'AckEvent',
  'ErrorEvent',
  'TaskStatusEvent',
  'SessionEvent',
  'ApprovalRequestEvent',
  'VerifyResultEvent',
  'ServerMessage',
  'EventSchemas',
] as const

describe('protocol exports', () => {
  it('exports every runtime schema with a parse function', () => {
    for (const name of schemaNames) {
      const schema = (protocol as Record<string, unknown>)[name]
      expect(schema, name).toBeDefined()
      expect(typeof (schema as { parse?: unknown }).parse, name).toBe('function')
    }
    expect(protocol.EventType).toBeDefined()
    expect(acceptsAgentEvent).toBeTypeOf('function')
  })
})
