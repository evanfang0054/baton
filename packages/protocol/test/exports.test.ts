import { describe, expect, it } from 'vitest'
import * as protocol from '../src/index.js'
import type { AgentEvent } from '../src/index.js'

function acceptsAgentEvent(event: AgentEvent): AgentEvent {
  return event
}

describe('protocol exports', () => {
  it('exports the M1 contract surface', () => {
    const required = [
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
      'ClientMessage',
      'ServerMessage',
      'EventType',
      'EventSchemas',
    ] as const
    for (const name of required) {
      expect(protocol).toHaveProperty(name)
    }
    expect(acceptsAgentEvent).toBeTypeOf('function')
  })
})
