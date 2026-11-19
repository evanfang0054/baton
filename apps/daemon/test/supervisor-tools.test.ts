import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getNode, getTask } from '../src/db/repositories.js'
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
  const tools = createSupervisorTools({
    db: database.db,
    taskService,
    now: () => 10,
    newId: () => `node-${++nodeSeq}`,
    defaultEngine: 'claude-sdk',
    enqueueTask: () => ({ ok: true, status: 'queued' }),
  })
  return { database, seeded, tools, root }
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
