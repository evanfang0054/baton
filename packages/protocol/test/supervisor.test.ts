import { describe, expect, it } from 'vitest'
import {
  ClientMessage,
  ServerMessage,
  SupervisorSendInput,
  TaskDetail,
  TaskOrigin,
} from '../src/index.js'

const actor = { id: 'local-user', kind: 'human', source: 'supervisor-chat' } as const

describe('supervisor protocol', () => {
  it('parses supervisor.send and rejects client-forged host fields', () => {
    const command = ClientMessage.parse({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'supervisor.send',
      payload: {
        workspaceId: 'w1',
        requestId: 'r1',
        text: '给这个 Agent 建个任务',
        contextNodeIds: ['n1'],
        targetNodeId: 'a1',
      },
    })
    expect(command.type).toBe('supervisor.send')

    const forged = SupervisorSendInput.safeParse({
      workspaceId: 'w1',
      requestId: 'r1',
      text: 'x',
      source: 'github',
      actor,
    })
    expect(forged.success).toBe(false)
  })

  it('parses supervisor events without seq', () => {
    const delta = ServerMessage.parse({
      v: 1,
      ts: 1,
      type: 'supervisor.delta',
      payload: { threadId: 'th1', messageId: 'm1', delta: '正在' },
    })
    expect(delta.type).toBe('supervisor.delta')

    const message = ServerMessage.parse({
      v: 1,
      ts: 1,
      type: 'supervisor.message',
      payload: {
        id: 'm1',
        threadId: 'th1',
        messageId: 'm1',
        role: 'assistant',
        content: '已建到待办',
        status: 'ok',
        toolCalls: [],
        createdAt: 1,
        decision: {
          id: 'd1',
          threadId: 'th1',
          triggerId: 'r1',
          messageId: 'm1',
          kind: 'create_task',
          strength: 'explicit',
          mode: 'explicit',
          reason: 'user asked',
          taskId: 't1',
          toolCalls: [],
          createdAt: 1,
        },
      },
    })
    expect(message.type).toBe('supervisor.message')
  })

  it('keeps TaskDetail.origin optional and TaskOrigin strict', () => {
    const origin = TaskOrigin.parse({
      source: 'supervisor-chat',
      triggerId: 'r1',
      threadId: 'th1',
      actor,
      workspaceId: 'w1',
      targetNodeId: 'a1',
      contextNodeIds: ['n1'],
      policyVersion: 'p1',
      promptVersion: 'v1',
      createdAt: 1,
    })
    expect(origin.actor.source).toBe('supervisor-chat')

    const task = TaskDetail.parse({
      id: 't1',
      workspaceId: 'w1',
      nodeId: 'a1',
      title: 'demo',
      prompt: '<task>x</task>',
      status: 'todo',
      waitingReason: null,
      engine: 'fake',
      workspaceMode: 'main',
      branch: null,
      worktreePath: null,
      verifyCommand: null,
      retryCount: 0,
      dangerouslySkipPermissions: false,
      createdAt: 1,
      updatedAt: 1,
      context: null,
    })
    expect(task.origin).toBeNull()
  })

  it('parses mandate fields and rejects an unknown allowed action', () => {
    const legacy = TaskOrigin.parse({
      source: 'supervisor-chat',
      triggerId: 'r1',
      threadId: 'th1',
      actor,
      workspaceId: 'w1',
      targetNodeId: 'a1',
      contextNodeIds: [],
      policyVersion: 'p1',
      promptVersion: 'v1',
      createdAt: 1,
    })
    expect(legacy.scope).toBeUndefined()

    const withMandate = TaskOrigin.parse({
      ...legacy,
      scope: 'task',
      strength: 'explicit',
      allowedActions: ['retry', 'enqueue'],
      mandateVersion: 'm1',
    })
    expect(withMandate.allowedActions).toEqual(['retry', 'enqueue'])

    expect(TaskOrigin.safeParse({ ...legacy, allowedActions: ['delete_everything'] }).success).toBe(
      false,
    )
  })

  it('keeps legacy origins parseable and accepts template fields', () => {
    const legacy = TaskOrigin.parse({
      source: 'supervisor-chat',
      triggerId: 'r1',
      threadId: 'th1',
      actor,
      workspaceId: 'w1',
      targetNodeId: 'a1',
      contextNodeIds: [],
      policyVersion: 'p1',
      promptVersion: 'v1',
      createdAt: 1,
    })
    expect(legacy.templateId).toBeUndefined()
    expect(legacy.acceptanceSeed).toBeUndefined()

    const templated = TaskOrigin.parse({
      ...legacy,
      templateId: 'bugfix',
      acceptanceSeed: ['复现步骤可执行'],
    })
    expect(templated.templateId).toBe('bugfix')
    expect(templated.acceptanceSeed).toEqual(['复现步骤可执行'])

    expect(TaskOrigin.safeParse({ ...legacy, templateId: 'unknown' }).success).toBe(false)
    expect(
      TaskOrigin.safeParse({
        ...legacy,
        acceptanceSeed: ['1', '2', '3', '4', '5', '6'],
      }).success,
    ).toBe(false)
  })
})
