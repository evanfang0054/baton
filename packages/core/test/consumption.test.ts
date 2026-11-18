import {
  Edge,
  Node,
  PolicySchema,
  type AgentAdapter,
  type AgentRun,
  type ApprovalDecision,
  type PolicySnapshot,
  type StartInput,
} from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { assembleContext } from '../src/context/index.js'
import { evaluateApproval } from '../src/policy/index.js'
import { resolveVerifyCommand } from '../src/verify/index.js'

const text = Node.parse({
  id: 'n1',
  canvasId: 'c1',
  type: 'text',
  data: { content: '需求：暗黑模式' },
  x: 0,
  y: 0,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
})

const target = Node.parse({
  id: 'n2',
  canvasId: 'c1',
  type: 'agent',
  data: { title: 'Agent', engine: 'fake', taskId: null },
  x: 100,
  y: 0,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
})

const edge = Edge.parse({
  id: 'e1',
  canvasId: 'c1',
  sourceId: 'n1',
  targetId: 'n2',
  type: 'context',
})

describe('context -> policy -> adapter wiring', () => {
  it('feeds assembled prompt into StartInput and keeps ask as a human decision', async () => {
    const assembled = assembleContext({
      taskPrompt: '把登录页改成暗黑模式',
      targetNodeId: 'n2',
      selectedNodeIds: ['n1'],
      nodes: [text, target],
      edges: [edge],
    })

    const policy = PolicySchema.parse({})
    const snapshot: PolicySnapshot = policy
    const verify = resolveVerifyCommand({ packageScripts: { verify: 'vitest run' } })
    expect(verify).toEqual({ ok: true, command: 'pnpm run verify', source: 'package' })

    const approvals: Array<[string, ApprovalDecision]> = []
    const adapter: AgentAdapter = {
      name: 'fake',
      async start(input: StartInput): Promise<AgentRun> {
        expect(input.prompt).toContain('<task>把登录页改成暗黑模式</task>')
        expect(input.policy.approval.default).toBe('ask')
        return {
          events: (async function* () {})(),
          approve: async (requestId, decision) => {
            approvals.push([requestId, decision])
          },
          send: async () => {},
          interrupt: async () => {},
          dispose: async () => {},
        }
      },
    }

    const run = await adapter.start({
      prompt: assembled.prompt,
      cwd: '/workspace/demo',
      permissionMode: 'manual',
      policy: snapshot,
      workspaceTrust: { projectSettings: false, projectHooks: false },
    })

    const decision = evaluateApproval(
      policy,
      { toolName: 'Read', input: { file_path: 'src/a.ts' }, risk: 'low' },
      { killSwitch: false },
    )
    expect(decision.decision).toBe('ask')
    expect(approvals).toEqual([])

    // ask 不是自动批准；这里模拟用户在 UI 上点了 allow。
    await run.approve('req-1', 'allow')
    expect(approvals).toEqual([['req-1', 'allow']])
  })
})
