import { describe, expect, it } from 'vitest'
import * as protocol from '../src/index.js'
import type { AgentEvent } from '../src/index.js'
import type { AgentAdapter, AgentRun, PolicySnapshot, StartInput } from '../src/adapter.js'
import { PolicySchema } from '../src/policy.js'

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
  'PermissionMode',
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
  'WorkspaceCreateInput',
  'WorkspaceListResponse',
  'WorkspaceCreateResponse',
  'CanvasResponse',
  'TaskListQuery',
  'TaskListResponse',
  'TaskDetailResponse',
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

  it('exports the AgentAdapter contract', async () => {
    const adapter: AgentAdapter = {
      name: 'fake',
      async start(input: StartInput): Promise<AgentRun> {
        const snapshot: PolicySnapshot = input.policy
        expect(snapshot.approval.default).toBe('ask')
        return {
          events: (async function* () {})(),
          approve: async () => {},
          send: async () => {},
          interrupt: async () => {},
          dispose: async () => {},
        }
      },
    }

    const run = await adapter.start({
      prompt: 'demo',
      cwd: '/workspace/demo',
      permissionMode: 'manual',
      policy: PolicySchema.parse({}),
    })
    expect(adapter.name).toBe('fake')
    await run.dispose()
  })
})
