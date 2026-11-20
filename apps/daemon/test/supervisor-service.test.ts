import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TaskTransitionEvent } from '@baton/protocol'
import { getTask } from '../src/db/repositories.js'
import { createTaskService } from '../src/runtime/task-service.js'
import type { SupervisorEngine } from '../src/supervisor/engine.js'
import { createSupervisorService } from '../src/supervisor/service.js'
import { createTestDb, seedTask, seedTextNode, type TestDb } from './helpers/db.js'

const dirs: string[] = []
const dbs: TestDb[] = []

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dbs.splice(0).forEach((entry) => entry.raw.close())
})

function setup(engine: SupervisorEngine, options: { trusted?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baton-svc-'))
  dirs.push(root)
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw, {
    withSession: false,
    trusted: options.trusted === true,
  })
  seedTextNode(database.raw, seeded.canvasId, 'text-1', '需求 A')
  mkdirSync(join(root, seeded.relPath), { recursive: true })
  writeFileSync(
    join(root, 'supervisor.json'),
    JSON.stringify({ baseUrl: 'https://example.com/v1', apiKey: 'sk-test', model: 'demo' }),
  )
  const config = {
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
    claudeProjectHooks: 'on' as const,
    allowBypassPermissions: false,
    killSwitch: false,
  }
  const taskService = createTaskService({
    db: database.db,
    config,
    now: () => 10,
    newId: () => 'task-new',
  })
  const frames: string[] = []
  const transitions: Array<{ taskId: string; event: TaskTransitionEvent }> = []
  const pending: Array<Promise<void>> = []
  let sequence = 0
  const service = createSupervisorService({
    db: database.db,
    dataDir: root,
    taskService,
    defaultEngine: 'claude-sdk',
    enqueueTask: () => ({ ok: true, status: 'queued' }),
    applyTransition: (taskId, event) => {
      transitions.push({ taskId, event })
      return {
        ok: true,
        taskId,
        status: 'done',
        previousStatus: 'review',
        retryCount: 0,
        waitingReason: null,
        events: [],
      }
    },
    workspacesRoot: root,
    killSwitch: () => false,
    engine,
    now: () => 10,
    newId: () => `id-${++sequence}`,
    broadcastRaw: (frame) => frames.push(frame),
    track: (action) => {
      pending.push(Promise.resolve().then(action))
    },
    logger: { warn() {}, error() {}, info() {} } as never,
  })
  const drain = async () => {
    while (pending.length > 0) {
      await Promise.all(pending.splice(0))
    }
  }
  return { database, seeded, service, frames, transitions, root, drain }
}

describe('supervisor service', () => {
  it('acks, streams, creates a todo task and dedupes the trigger', async () => {
    const seen: string[] = []
    const engine: SupervisorEngine = {
      async run({ onDelta, tools, messages }) {
        seen.push(...messages.map((message) => `${message.role}:${message.content}`))
        onDelta('正在建任务')
        const result = await tools.create_task.execute({
          title: '登录页暗黑模式',
          contextNodeIds: ['text-1'],
        })
        return {
          text: '已建到待办',
          toolCalls: [{ id: 'tc1', name: 'create_task', args: {}, ok: true, result }],
          finishReason: 'stop',
        }
      },
    }
    const { database, seeded, service, frames } = setup(engine)
    const input = {
      workspaceId: seeded.workspaceId,
      requestId: 'r1',
      text: '给这个 Agent 建个任务',
      contextNodeIds: ['text-1'],
      targetNodeId: seeded.nodeId,
    }
    const ack = service.send(input)
    expect(ack.ok).toBe(true)
    await service.waitForIdle()

    expect(frames.some((frame) => frame.includes('supervisor.delta'))).toBe(true)
    expect(frames.some((frame) => frame.includes('supervisor.tool'))).toBe(true)
    expect(frames.some((frame) => frame.includes('supervisor.message'))).toBe(true)
    expect(seen).toEqual(['user:给这个 Agent 建个任务'])
    expect(getTask(database.db, 'task-new')?.status).toBe('todo')
    expect(service.history(seeded.workspaceId, 50).messages.map((message) => message.role)).toEqual(
      ['user', 'assistant'],
    )

    const duplicate = service.send({ ...input, requestId: 'r1' })
    await service.waitForIdle()
    expect(duplicate.ok).toBe(true)
    // seedTask 已有一条占位任务；重复 requestId 不应再建第二条新任务。
    expect(database.raw.prepare('select count(*) as n from task').get()).toEqual({ n: 2 })
  })

  it('records an error message when the engine throws', async () => {
    const engine: SupervisorEngine = {
      async run() {
        throw new Error('provider down')
      },
    }
    const { database, seeded, service } = setup(engine)
    service.send({
      workspaceId: seeded.workspaceId,
      requestId: 'r2',
      text: '你好',
      contextNodeIds: [],
    })
    await service.waitForIdle()
    const row = database.raw
      .prepare("select status from supervisor_message where role='assistant'")
      .get() as { status: string }
    expect(row.status).toBe('error')
  })

  it('polishes observer notifications through the supervisor model', async () => {
    const engine: SupervisorEngine = {
      async run() {
        throw new Error('unused')
      },
      async summarize({ prompt }) {
        return `秘书润色：${prompt.slice(0, 24)}`
      },
    }
    const { database, seeded, service, frames, drain } = setup(engine)
    seedSupervisorReview(database, seeded)
    database.raw.prepare("update task set status = 'failed' where id = ?").run(seeded.taskId)

    service.observeTask({ taskId: seeded.taskId, status: 'failed', waitingReason: null })
    await drain()

    const last = service.history(seeded.workspaceId, 50).messages.at(-1)
    expect(last?.content).toContain('秘书润色')
    expect(last?.content).toContain('任务「demo」')
    expect(frames.filter((frame) => frame.includes('supervisor.message')).length).toBeGreaterThan(1)
  })

  it('keeps the template when notification polish fails', async () => {
    const engine: SupervisorEngine = {
      async run() {
        throw new Error('unused')
      },
      async summarize() {
        throw new Error('provider down')
      },
    }
    const { database, seeded, service, drain } = setup(engine)
    seedSupervisorReview(database, seeded)
    database.raw.prepare("update task set status = 'failed' where id = ?").run(seeded.taskId)

    service.observeTask({ taskId: seeded.taskId, status: 'failed', waitingReason: null })
    await drain()

    const last = service.history(seeded.workspaceId, 50).messages.at(-1)
    expect(last?.content).toContain('执行失败')
  })

  function seedSupervisorReview(database: TestDb, seeded: ReturnType<typeof seedTask>) {
    const origin = {
      source: 'supervisor-chat',
      triggerId: 'r1',
      threadId: 'th1',
      actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
      workspaceId: seeded.workspaceId,
      targetNodeId: seeded.nodeId,
      contextNodeIds: [],
      policyVersion: 'p1',
      promptVersion: 'v1',
      createdAt: 1,
    }
    database.raw
      .prepare(
        `insert into supervisor_thread (id, workspace_id, source, created_at, updated_at)
         values ('th1', ?, 'supervisor-chat', 1, 1)`,
      )
      .run(seeded.workspaceId)
    database.raw
      .prepare("update task set status = 'review', origin_json = ?, updated_at = 2 where id = ?")
      .run(JSON.stringify(origin), seeded.taskId)
    database.raw
      .prepare(
        `insert into review (id, task_id, verdict, verify_exit_code, verify_output, diff_stat_json, decided_at)
         values ('rv1', ?, null, 0, 'ok', ?, null)`,
      )
      .run(seeded.taskId, JSON.stringify({ filesChanged: 1, insertions: 2, deletions: 0 }))
    return origin
  }

  function seedVerifierTask(
    database: TestDb,
    seeded: ReturnType<typeof seedTask>,
    targetOrigin: ReturnType<typeof seedSupervisorReview>,
    verdict: 'PASS' | 'FAIL',
    status: 'review' | 'waiting_input' = 'review',
  ): string {
    const origin = {
      source: 'supervisor-review',
      triggerId: targetOrigin.triggerId,
      threadId: targetOrigin.threadId,
      actor: { id: 'local-user', kind: 'system', source: 'supervisor-review' },
      workspaceId: seeded.workspaceId,
      targetNodeId: seeded.nodeId,
      contextNodeIds: [],
      policyVersion: 'p1',
      promptVersion: 'v1',
      reviewOfTaskId: seeded.taskId,
      reviewOfReviewId: 'rv1',
      createdAt: 3,
    }
    database.raw
      .prepare(
        `insert into task (
           id, workspace_id, node_id, title, prompt, status, engine, workspace_mode,
           branch, worktree_path, verify_command, retry_count, dangerously_skip_permissions,
           origin_json, created_at, updated_at
         ) values ('verifier-1', ?, ?, '验收：demo', '<task>验收</task>', ?, 'fake',
           'main', null, null, null, 0, 0, ?, 3, 3)`,
      )
      .run(seeded.workspaceId, seeded.nodeId, status, JSON.stringify(origin))
    database.raw
      .prepare(
        `insert into session (id, task_id, adapter, engine_session_id, status, started_at, ended_at)
         values ('vs1', 'verifier-1', 'fake', null, 'ended', 3, 4)`,
      )
      .run()
    const events = ['验收完成，检查了 diff。', `\nVERDICT: ${verdict}`]
    events.forEach((delta, index) => {
      database.raw
        .prepare(
          `insert into event (id, session_id, ordinal, seq, type, payload_json, ts)
           values (?, 'vs1', ?, ?, 'TEXT_MESSAGE_CONTENT', ?, 4)`,
        )
        .run(
          `ev-${index}`,
          100 + index,
          index + 1,
          JSON.stringify({
            type: 'TEXT_MESSAGE_CONTENT',
            messageId: 'm1',
            delta,
          }),
        )
    })
    database.raw
      .prepare(
        `insert into review (id, task_id, verdict, verify_exit_code, verify_output, diff_stat_json, decided_at)
         values ('rv-verifier', 'verifier-1', null, 0, 'ok', ?, null)`,
      )
      .run(JSON.stringify({ filesChanged: 0, insertions: 0, deletions: 0 }))
    return 'verifier-1'
  }

  it('dispatches a preliminary verifier and keeps the target in review', () => {
    const engine: SupervisorEngine = {
      async run() {
        throw new Error('unused')
      },
    }
    const { database, seeded, service } = setup(engine)
    seedSupervisorReview(database, seeded)

    service.observeTask({ taskId: seeded.taskId, status: 'review', waitingReason: null })

    expect(database.raw.prepare('select count(*) as n from task').get()).toEqual({ n: 2 })
    const messages = service.history(seeded.workspaceId, 50).messages
    expect(messages.at(-1)?.content).toContain('初步验收')
    expect(messages.at(-1)?.content).toContain('最终通过仍由你决定')
  })

  it('dispatches a fresh verifier agent for preliminary review', () => {
    const engine: SupervisorEngine = {
      async run() {
        throw new Error('unused')
      },
    }
    const { database, seeded, service, frames } = setup(engine, {
      trusted: true,
    })
    seedSupervisorReview(database, seeded)

    service.observeTask({ taskId: seeded.taskId, status: 'review', waitingReason: null })

    const rows = database.raw
      .prepare('select id, node_id, origin_json from task order by created_at')
      .all() as Array<{ id: string; node_id: string; origin_json: string | null }>
    expect(rows).toHaveLength(2)
    const verifier = rows[1]!
    expect(JSON.parse(verifier.origin_json!)).toMatchObject({
      source: 'supervisor-review',
      reviewOfTaskId: seeded.taskId,
      reviewOfReviewId: 'rv1',
      actor: { kind: 'system' },
    })
    const node = database.raw
      .prepare('select data_json from node where id = ?')
      .get(verifier.node_id) as { data_json: string }
    expect(JSON.parse(node.data_json).title).toContain('验收员')
    const messages = service.history(seeded.workspaceId, 50).messages
    expect(messages.at(-1)?.content).toContain('派出新 Agent')
    expect(frames.some((frame) => frame.includes('supervisor.message'))).toBe(true)
  })

  it('reuses the target worktree so the verifier can inspect isolated changes', () => {
    const engine: SupervisorEngine = {
      async run() {
        throw new Error('unused')
      },
    }
    const { database, seeded, service, root } = setup(engine, {
      trusted: true,
    })
    seedSupervisorReview(database, seeded)
    // taskService 会校验 workspace 是 git 仓库；worktree 本身由运行时准备，这里只验证路径复用。
    execFileSync('git', ['init', join(root, seeded.relPath)], { stdio: 'ignore' })
    const worktreePath = join(root, 'worktrees', seeded.taskId)
    database.raw
      .prepare(
        "update task set workspace_mode = 'worktree', worktree_path = ?, branch = ? where id = ?",
      )
      .run(worktreePath, `baton/${seeded.taskId}`, seeded.taskId)

    service.observeTask({ taskId: seeded.taskId, status: 'review', waitingReason: null })

    const verifier = database.raw
      .prepare(
        'select workspace_mode, worktree_path, branch from task where id != ? order by created_at desc limit 1',
      )
      .get(seeded.taskId) as
      { workspace_mode: string; worktree_path: string; branch: string } | undefined
    expect(verifier).toMatchObject({
      workspace_mode: 'worktree',
      worktree_path: worktreePath,
      branch: `baton/${seeded.taskId}`,
    })
  })

  it('keeps the target in review when the verifier returns PASS and records a recommendation', () => {
    const engine: SupervisorEngine = {
      async run() {
        throw new Error('unused')
      },
    }
    const { database, seeded, service, transitions } = setup(engine, {
      trusted: true,
    })
    const targetOrigin = seedSupervisorReview(database, seeded)
    const verifierTaskId = seedVerifierTask(database, seeded, targetOrigin, 'PASS')

    service.observeTask({ taskId: verifierTaskId, status: 'review', waitingReason: null })

    // 只关闭验收员任务，不替老板通过目标任务。
    expect(transitions.map((entry) => entry.taskId)).toEqual([verifierTaskId])
    const audit = database.raw
      .prepare("select action from audit where action = 'supervisor.review.recommend'")
      .get() as { action: string } | undefined
    expect(audit?.action).toBe('supervisor.review.recommend')
    expect(
      database.raw
        .prepare("select count(*) as n from audit where action = 'supervisor.review.accept'")
        .get(),
    ).toEqual({ n: 0 })
    const messages = service.history(seeded.workspaceId, 50).messages
    expect(messages.at(-1)?.content).toContain('建议通过')
    expect(messages.at(-1)?.content).toContain('等你最终确认')
  })

  it('leaves the target in review when the verifier returns FAIL', () => {
    const engine: SupervisorEngine = {
      async run() {
        throw new Error('unused')
      },
    }
    const { database, seeded, service, transitions } = setup(engine, {
      trusted: true,
    })
    const targetOrigin = seedSupervisorReview(database, seeded)
    const verifierTaskId = seedVerifierTask(database, seeded, targetOrigin, 'FAIL')

    service.observeTask({ taskId: verifierTaskId, status: 'review', waitingReason: null })

    expect(transitions.map((entry) => entry.taskId)).toEqual([verifierTaskId])
    expect(
      database.raw
        .prepare("select count(*) as n from audit where action = 'supervisor.review.accept'")
        .get(),
    ).toEqual({ n: 0 })
    const messages = service.history(seeded.workspaceId, 50).messages
    expect(messages.at(-1)?.content).toContain('建议打回')
    expect(messages.at(-1)?.content).toContain('最终由你决定')
  })

  it('recovers a stalled verifier verdict and recommends pass without accepting', () => {
    const engine: SupervisorEngine = {
      async run() {
        throw new Error('unused')
      },
    }
    const { database, seeded, service, transitions } = setup(engine, {
      trusted: true,
    })
    const targetOrigin = seedSupervisorReview(database, seeded)
    const verifierTaskId = seedVerifierTask(database, seeded, targetOrigin, 'PASS', 'waiting_input')

    service.observeTask({
      taskId: verifierTaskId,
      status: 'waiting_input',
      waitingReason: 'stalled',
    })

    expect(transitions.map((entry) => entry.taskId)).toEqual([verifierTaskId])
    expect(transitions[0]?.event).toMatchObject({ type: 'cancel' })
    const messages = service.history(seeded.workspaceId, 50).messages
    expect(messages.at(-1)?.content).toContain('建议通过')
    expect(messages.at(-1)?.content).toContain('等你最终确认')
  })
})
