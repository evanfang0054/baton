import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getNode, getTask, insertApproval } from '../src/db/repositories.js'
import { createTaskService } from '../src/runtime/task-service.js'
import { createSupervisorTools, type ToolContext } from '../src/supervisor/tools.js'
import { createTestDb, seedTask, seedTextNode, type TestDb } from './helpers/db.js'

const dirs: string[] = []
const dbs: TestDb[] = []

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dbs.splice(0).forEach((entry) => entry.raw.close())
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'baton-tools-'))
  dirs.push(root)
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw, { withSession: false })
  seedTextNode(database.raw, seeded.canvasId, 'text-1', '需求 A')
  mkdirSync(join(root, seeded.relPath), { recursive: true })
  execFileSync('git', ['init', join(root, seeded.relPath)], { stdio: 'ignore' })

  const taskService = createTaskService({
    db: database.db,
    config: {
      host: '127.0.0.1',
      port: 0,
      token: null,
      dataDir: root,
      webRoot: root,
      workspacesRoot: root,
      maxConcurrency: 1,
      maxLiveSessions: 5,
      claudeMaxTurns: 30,
      claudeMaxBudgetUsd: 2,
      claudeProjectHooks: 'on',
      allowBypassPermissions: false,
      killSwitch: false,
    },
    now: () => 10,
    newId: () => 'task-new',
  })
  let nodeSeq = 0
  const transitions: Array<{ taskId: string; type: string }> = []
  const tools = createSupervisorTools({
    db: database.db,
    taskService,
    now: () => 10,
    newId: () => `node-${++nodeSeq}`,
    defaultEngine: 'claude-sdk',
    enqueueTask: () => ({ ok: true, status: 'queued' }),
    applyTransition: (taskId, event) => {
      transitions.push({ taskId, type: event.type })
      return {
        ok: true,
        taskId,
        status:
          event.type === 'retry' ? 'queued' : event.type === 'reopen' ? 'todo' : 'cancelled',
        previousStatus: 'failed',
        retryCount: 0,
        waitingReason: null,
        events: [],
      }
    },
  })
  return { database, seeded, tools, root, transitions }
}

function ctx(seeded: ReturnType<typeof seedTask>): ToolContext {
  return {
    workspaceId: seeded.workspaceId,
    threadId: 'th1',
    triggerId: 'r1',
    text: '给这个 Agent 建个任务',
    actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
    selection: {
      contextNodeIds: ['text-1'],
      targetNodeId: seeded.nodeId,
      agentCandidates: [{ id: seeded.nodeId, title: 'agent', engine: 'fake' }],
    },
    policyVersion: 'p1',
    promptVersion: 'v1',
    memo: {},
  }
}

describe('supervisor tools', () => {
  it('creates a todo task with origin and audit, never enqueues', async () => {
    const { database, seeded, tools } = setup()
    const result = (await tools.create_task.execute(
      { title: '登录页暗黑模式', targetNodeId: seeded.nodeId, contextNodeIds: ['text-1'] },
      ctx(seeded),
    )) as { taskId: string; status: string; contextCount: number }

    expect(result).toMatchObject({ taskId: 'task-new', status: 'todo', contextCount: 1 })
    const task = getTask(database.db, 'task-new')
    expect(task?.status).toBe('todo')
    expect(task?.prompt).toContain('<task>')
    expect(database.raw.prepare('select count(*) as n from session').get()).toEqual({ n: 0 })
    expect(database.raw.prepare('select count(*) as n from audit').get()).toEqual({ n: 1 })
    const row = database.raw
      .prepare('select origin_json from task where id = ?')
      .get('task-new') as { origin_json: string }
    expect(JSON.parse(row.origin_json)).toMatchObject({
      source: 'supervisor-chat',
      triggerId: 'r1',
      threadId: 'th1',
      policyVersion: 'p1',
    })
  })

  it('filters tasks by q and status in the current workspace', async () => {
    const { database, seeded, tools } = setup()
    const insert = database.raw.prepare(
      `insert into task (
         id, workspace_id, node_id, title, prompt, status, engine, workspace_mode,
         branch, worktree_path, verify_command, retry_count, created_at, updated_at
       ) values (?, ?, ?, ?, 'p', ?, 'fake', 'main', null, null, null, 0, ?, ?)`,
    )
    insert.run('task-login', seeded.workspaceId, seeded.nodeId, '登录页修复', 'todo', 3, 3)
    insert.run('task-home', seeded.workspaceId, seeded.nodeId, '首页登录入口', 'done', 2, 2)
    insert.run('task-other', seeded.workspaceId, seeded.nodeId, '支付回调', 'todo', 1, 1)

    const byQ = (await tools.list_tasks.execute({ q: '登录' }, ctx(seeded))) as {
      tasks: Array<{ id: string }>
    }
    expect(byQ.tasks.map((task) => task.id)).toEqual(['task-login', 'task-home'])

    const byStatus = (await tools.list_tasks.execute({ status: 'done' }, ctx(seeded))) as {
      tasks: Array<{ id: string }>
    }
    expect(byStatus.tasks.map((task) => task.id)).toEqual(['task-home'])

    const byId = (await tools.list_tasks.execute({ q: 'task-log' }, ctx(seeded))) as {
      tasks: Array<{ id: string }>
    }
    expect(byId.tasks.map((task) => task.id)).toEqual(['task-login'])
  })

  it('returns a sanitized pending approval without raw input', async () => {
    const { database, seeded, tools } = setup()
    database.raw
      .prepare(
        'insert into session (id, task_id, adapter, status, started_at) values (?, ?, ?, ?, ?)',
      )
      .run('sess-1', seeded.taskId, 'fake', 'waiting_input', 1)
    database.db.transaction((tx) => {
      insertApproval(tx, {
        id: 'ap1',
        sessionId: 'sess-1',
        requestId: 'req1',
        request: { toolName: 'Bash', input: { command: 'rm -rf /tmp/x' }, risk: 'high' },
      })
    })
    database.raw
      .prepare('update task set status = ?, waiting_reason = ? where id = ?')
      .run('waiting_input', 'approval', seeded.taskId)

    const result = (await tools.get_task.execute({ taskId: seeded.taskId }, ctx(seeded))) as {
      pending: { kind: string; approval: { toolName: string; risk: string; reason?: string } }
    }
    expect(result.pending).toEqual({
      kind: 'approval',
      approval: { toolName: 'Bash', risk: 'high' },
    })
    expect(JSON.stringify(result)).not.toContain('rm -rf')
  })

  it('returns structured AskUserQuestion options', async () => {
    const { database, seeded, tools } = setup()
    database.raw
      .prepare(
        'insert into session (id, task_id, adapter, status, started_at) values (?, ?, ?, ?, ?)',
      )
      .run('sess-2', seeded.taskId, 'fake', 'waiting_input', 1)
    database.db.transaction((tx) => {
      insertApproval(tx, {
        id: 'ap2',
        sessionId: 'sess-2',
        requestId: 'req2',
        request: {
          toolName: 'AskUserQuestion',
          input: {
            questions: [
              { question: '用哪个方案？', options: [{ label: 'A' }, { label: 'B' }] },
            ],
          },
          risk: 'low',
        },
      })
    })
    database.raw
      .prepare('update task set status = ?, waiting_reason = ? where id = ?')
      .run('waiting_input', 'approval', seeded.taskId)

    const result = (await tools.get_task.execute({ taskId: seeded.taskId }, ctx(seeded))) as {
      pending: {
        kind: string
        question: {
          questions: Array<{ question: string; options: Array<{ label: string }> }>
        }
      }
    }
    expect(result.pending.kind).toBe('question')
    expect(result.pending.question.questions[0]).toEqual({
      question: '用哪个方案？',
      options: [{ label: 'A' }, { label: 'B' }],
    })
  })

  it('returns status, session and review summaries without transcript', async () => {
    const { database, seeded, tools } = setup()
    database.raw
      .prepare('insert into ws_event (id, type, payload_json, ts, task_id) values (?, ?, ?, ?, ?)')
      .run(
        'e1',
        'task.status',
        JSON.stringify({
          taskId: seeded.taskId,
          status: 'queued',
          previousStatus: 'todo',
          retryCount: 0,
          updatedAt: 1,
        }),
        1,
        seeded.taskId,
      )
    database.raw
      .prepare('insert into ws_event (id, type, payload_json, ts, task_id) values (?, ?, ?, ?, ?)')
      .run(
        'e2',
        'session.event',
        JSON.stringify({ text: 'secret transcript' }),
        2,
        seeded.taskId,
      )

    const result = (await tools.get_task_history.execute(
      { taskId: seeded.taskId },
      ctx(seeded),
    )) as {
      taskId: string
      statusEvents: Array<{ status: string }>
      sessions: unknown[]
      reviews: unknown[]
    }
    expect(result.taskId).toBe(seeded.taskId)
    expect(result.statusEvents).toHaveLength(1)
    expect(result.statusEvents[0]?.status).toBe('queued')
    expect(JSON.stringify(result)).not.toContain('secret transcript')
  })

  it('retries only failed tasks and reopens only finished tasks', async () => {
    const { database, seeded, tools, transitions } = setup()
    database.raw.prepare('update task set status = ? where id = ?').run('failed', seeded.taskId)
    const retry = (await tools.retry_task.execute(
      { taskId: seeded.taskId, note: '再试一次' },
      ctx(seeded),
    )) as { status: string }
    expect(retry.status).toBe('queued')
    expect(transitions.at(-1)).toEqual({ taskId: seeded.taskId, type: 'retry' })

    database.raw.prepare('update task set status = ? where id = ?').run('done', seeded.taskId)
    const reopen = (await tools.reopen_task.execute(
      { taskId: seeded.taskId, start: true },
      ctx(seeded),
    )) as { status: string }
    expect(reopen.status).toBe('queued')
    expect(transitions.at(-1)).toEqual({ taskId: seeded.taskId, type: 'reopen' })
  })

  it('requires confirmation before cancelling a running task', async () => {
    const { database, seeded, tools, transitions } = setup()
    database.raw.prepare('update task set status = ? where id = ?').run('running', seeded.taskId)
    const pending = (await tools.cancel_task.execute(
      { taskId: seeded.taskId },
      ctx(seeded),
    )) as { ok: boolean; code: string }
    expect(pending).toMatchObject({ ok: false, code: 'confirmation_required' })
    expect(transitions).toHaveLength(0)

    const done = (await tools.cancel_task.execute(
      { taskId: seeded.taskId, confirm: true },
      ctx(seeded),
    )) as { ok: boolean; status: string }
    expect(done).toMatchObject({ ok: true, status: 'cancelled' })
    expect(transitions.at(-1)).toEqual({ taskId: seeded.taskId, type: 'cancel' })
  })

  it('creates a worktree task when explicitly requested', async () => {
    const { database, seeded, tools } = setup()
    await tools.create_task.execute(
      {
        title: '隔离改动',
        targetNodeId: seeded.nodeId,
        contextNodeIds: [],
        workspaceMode: 'worktree',
      },
      ctx(seeded),
    )
    expect(getTask(database.db, 'task-new')?.workspaceMode).toBe('worktree')
  })

  it('creates text and agent nodes with the default engine', async () => {
    const { database, seeded, tools } = setup()
    const text = (await tools.create_text.execute({ content: '资料 A' }, ctx(seeded))) as {
      nodeId: string
    }
    const agent = (await tools.create_agent.execute({ title: '资料 Agent' }, ctx(seeded))) as {
      nodeId: string
      engine: string
    }

    expect(getNode(database.db, text.nodeId)?.type).toBe('text')
    const node = getNode(database.db, agent.nodeId)
    expect(node?.type).toBe('agent')
    expect(node?.type === 'agent' ? node.data.engine : null).toBe('claude-sdk')
  })

  it('lists canvas nodes and edges without reading files', async () => {
    const { seeded, tools } = setup()
    await tools.create_edge.execute({ sourceId: 'text-1', targetId: seeded.nodeId }, ctx(seeded))

    const result = (await tools.list_canvas.execute({}, ctx(seeded))) as {
      nodes: Array<{ id: string; type: string; title: string; preview?: string }>
      edges: Array<{ sourceId: string; targetId: string; type: string }>
      totalNodes: number
      totalEdges: number
      truncated: boolean
    }
    expect(result.totalNodes).toBe(2)
    expect(result.totalEdges).toBe(1)
    expect(result.truncated).toBe(false)
    expect(result.nodes).toContainEqual(
      expect.objectContaining({ id: 'text-1', type: 'text', title: '需求 A', preview: '需求 A' }),
    )
    expect(result.nodes.find((entry) => entry.id === seeded.nodeId)).toMatchObject({
      type: 'agent',
    })
    expect(result.edges).toEqual([
      { id: expect.any(String), sourceId: 'text-1', targetId: seeded.nodeId, type: 'context' },
    ])

    const limited = (await tools.list_canvas.execute({ limit: 1 }, ctx(seeded))) as {
      nodes: unknown[]
      truncated: boolean
    }
    expect(limited.nodes).toHaveLength(1)
    expect(limited.truncated).toBe(true)
  })

  it('auto-creates an agent and can start the task', async () => {
    const { database, seeded, tools } = setup()
    const bare: ToolContext = {
      ...ctx(seeded),
      selection: { contextNodeIds: [], agentCandidates: [] },
    }
    const result = (await tools.create_task.execute({ title: '自动派活', start: true }, bare)) as {
      taskId: string
      status: string
      target: { id: string }
    }

    expect(result.status).toBe('queued')
    const task = getTask(database.db, 'task-new')
    expect(task?.nodeId).toBe(result.target.id)
    const node = getNode(database.db, result.target.id)
    expect(node?.type).toBe('agent')
    expect(node?.type === 'agent' ? node.data.engine : null).toBe('claude-sdk')
  })

  it('updates a todo task title and starts it on a follow-up call', async () => {
    const { database, seeded, tools } = setup()
    const context = ctx(seeded)
    await tools.create_task.execute({ title: '文档助手' }, context)
    const second = (await tools.create_task.execute(
      { title: '给 README 增加用法说明', start: true },
      context,
    )) as { title: string; status: string }

    expect(second).toMatchObject({ title: '给 README 增加用法说明', status: 'queued' })
    expect(getTask(database.db, 'task-new')?.title).toBe('给 README 增加用法说明')
    expect(database.raw.prepare('select count(*) as n from task').get()).toEqual({ n: 2 })
  })

  it('rejects enqueue for a task that is not todo', async () => {
    const { database, seeded, tools } = setup()
    database.raw.prepare("update task set status='review' where id=?").run(seeded.taskId)
    await expect(
      tools.enqueue_task.execute({ taskId: seeded.taskId }, ctx(seeded)),
    ).rejects.toMatchObject({ code: 'task_not_enqueueable' })
  })

  it('rejects context nodes that are not on the canvas', async () => {
    const { seeded, tools } = setup()
    await expect(
      tools.create_task.execute(
        { title: 'x', targetNodeId: seeded.nodeId, contextNodeIds: ['other'] },
        ctx(seeded),
      ),
    ).rejects.toMatchObject({ code: 'supervisor_context_invalid' })
  })

  it('returns attention tasks and task metadata without transcript', async () => {
    const { database, seeded, tools } = setup()
    database.raw
      .prepare("update task set status='review', updated_at=9 where id=?")
      .run(seeded.taskId)
    const list = (await tools.list_tasks.execute({ filter: 'attention' }, ctx(seeded))) as {
      tasks: Array<{ id: string; status: string; attention: string }>
    }
    expect(list.tasks[0]).toMatchObject({ id: seeded.taskId, status: 'review' })

    const detail = (await tools.get_task.execute({ taskId: seeded.taskId }, ctx(seeded))) as Record<
      string,
      unknown
    >
    expect(detail).not.toHaveProperty('events')
    expect(detail).not.toHaveProperty('transcript')
    expect(detail).not.toHaveProperty('logs')
  })

  it('hides tasks that belong to another workspace', async () => {
    const { seeded, tools } = setup()
    await expect(
      tools.get_task.execute({ taskId: seeded.taskId }, { ...ctx(seeded), workspaceId: 'other' }),
    ).rejects.toMatchObject({ code: 'task_not_found' })
  })
})
