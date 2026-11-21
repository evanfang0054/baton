import { Node, Task, type ApprovalRequest, type Review } from '@baton/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import * as repo from '../src/db/repositories.js'
import { createTestDb, seedTask, type TestDb } from './helpers/db.js'

const dbs: TestDb[] = []

function db(): TestDb {
  const created = createTestDb()
  dbs.push(created)
  return created
}

afterEach(() => {
  dbs.splice(0).forEach((entry) => entry.raw.close())
})

const request: ApprovalRequest = {
  toolName: 'Bash',
  input: { command: 'pnpm test' },
  risk: 'medium',
}

describe('repositories', () => {
  it('reads seeded workspace, canvas, nodes and task', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    expect(repo.getWorkspace(database.db, seeded.workspaceId)?.name).toBe('demo')
    expect(repo.listWorkspaces(database.db)).toHaveLength(1)
    expect(repo.getCanvasByWorkspace(database.db, seeded.workspaceId)?.id).toBe(seeded.canvasId)
    expect(repo.listNodes(database.db, seeded.canvasId)).toHaveLength(1)
    expect(repo.listEdges(database.db, seeded.canvasId)).toEqual([])
    expect(repo.getTask(database.db, seeded.taskId)?.status).toBe('todo')
    expect(repo.listTasks(database.db, { workspaceId: seeded.workspaceId })).toHaveLength(1)
  })

  it('defaults workspace trust to off', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    expect(repo.getWorkspace(database.db, seeded.workspaceId)).toMatchObject({
      trusted: false,
      projectHooks: 'off',
      trustedAt: null,
    })
    const columns = database.raw.pragma('table_info(workspace)') as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['trusted', 'project_hooks', 'trusted_at']),
    )
  })

  it('creates, updates and deletes text nodes', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    const created = Node.parse({
      id: 'text-2',
      canvasId: seeded.canvasId,
      type: 'text',
      x: 1,
      y: 2,
      w: 320,
      h: 200,
      groupId: null,
      data: { content: 'hello' },
      createdAt: 1,
      updatedAt: 1,
    })

    database.db.transaction((tx) => repo.insertNode(tx, created))
    expect(repo.getNode(database.db, 'text-2')?.type).toBe('text')

    database.db.transaction((tx) =>
      repo.updateNode(tx, 'text-2', {
        x: 50,
        y: 60,
        data: { content: 'updated' },
        updatedAt: 2,
      }),
    )
    expect(repo.getNode(database.db, 'text-2')).toMatchObject({
      x: 50,
      y: 60,
      data: { content: 'updated' },
    })

    database.db.transaction((tx) => repo.deleteNode(tx, 'text-2'))
    expect(repo.getNode(database.db, 'text-2')).toBeNull()
  })

  it('detects tasks referencing a node', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    expect(repo.hasTaskForNode(database.db, seeded.nodeId)).toBe(true)
    expect(repo.hasTaskForNode(database.db, 'missing')).toBe(false)
  })

  it('lists session events with pagination', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    if (!seeded.sessionId) throw new Error('expected session')

    database.raw
      .prepare(
        `insert into event (id, session_id, ordinal, seq, type, payload_json, ts)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('e1', seeded.sessionId, 1, 1, 'RUN_STARTED', JSON.stringify({ type: 'RUN_STARTED' }), 1)
    database.raw
      .prepare(
        `insert into event (id, session_id, ordinal, seq, type, payload_json, ts)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'e2',
        seeded.sessionId,
        2,
        2,
        'RUN_FINISHED',
        JSON.stringify({ type: 'RUN_FINISHED' }),
        2,
      )

    const first = repo.listSessionEvents(database.db, seeded.sessionId, 0, 1)
    expect(first.rows).toHaveLength(1)
    expect(first.rows[0]?.seq).toBe(1)
    expect(first.hasMore).toBe(true)

    const second = repo.listSessionEvents(database.db, seeded.sessionId, 1, 10)
    expect(second.rows.map((row) => row.seq)).toEqual([2])
    expect(second.hasMore).toBe(false)
  })

  it('updates task state and counts active tasks', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    database.db.transaction((tx) => repo.updateTaskState(tx, seeded.taskId, 'running', 0, null, 2))
    expect(repo.getTask(database.db, seeded.taskId)?.status).toBe('running')
    expect(repo.countActiveTasks(database.db)).toBe(1)
    expect(repo.listTasksByStatus(database.db, ['running'])).toHaveLength(1)
  })

  it('does not count a blocked task as an execution slot but keeps its live session', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    database.db.transaction((tx) => {
      repo.updateTaskState(tx, seeded.taskId, 'waiting_input', 0, 'stalled', 2)
      repo.updateSessionStatus(tx, seeded.sessionId!, 'ended', 2, 'unreported')
    })
    expect(repo.countActiveTasks(database.db)).toBe(0)
    expect(repo.countLiveSessions(database.db)).toBe(0)

    database.db.transaction((tx) => {
      repo.updateTaskState(tx, seeded.taskId, 'waiting_input', 0, 'question', 3)
      repo.updateSessionStatus(tx, seeded.sessionId!, 'waiting_input', null, null)
    })
    expect(repo.countActiveTasks(database.db)).toBe(0)
    expect(repo.countLiveSessions(database.db)).toBe(1)
  })

  it('inserts and reloads a task through the repository', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    const task = Task.parse({
      id: 'task-repo-1',
      workspaceId: seeded.workspaceId,
      nodeId: seeded.nodeId,
      title: 'repo task',
      prompt: '<task>repo</task>',
      status: 'todo',
      waitingReason: null,
      engine: 'fake',
      workspaceMode: 'main',
      branch: null,
      worktreePath: null,
      verifyCommand: null,
      retryCount: 0,
      dangerouslySkipPermissions: false,
      createdAt: 3,
      updatedAt: 3,
    })
    database.db.transaction((tx) => repo.insertTask(tx, task))
    expect(repo.getTask(database.db, task.id)?.prompt).toBe('<task>repo</task>')
  })

  it('updates session lifecycle', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    const session = repo.getSession(database.db, seeded.sessionId!)
    expect(session?.status).toBe('running')
    database.db.transaction((tx) => repo.updateSessionEngineId(tx, seeded.sessionId!, 'engine-1'))
    database.db.transaction((tx) => repo.updateSessionStatus(tx, seeded.sessionId!, 'ended', 9))
    const updated = repo.getSession(database.db, seeded.sessionId!)
    expect(updated?.engineSessionId).toBe('engine-1')
    expect(updated?.status).toBe('ended')
    expect(updated?.endedAt).toBe(9)
    expect(repo.listSessionsByTask(database.db, seeded.taskId)).toHaveLength(1)
    expect(repo.listSessionsByStatus(database.db, ['ended'])).toHaveLength(1)
  })

  it('records approvals and pending decisions', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    database.db.transaction((tx) =>
      repo.insertApproval(tx, {
        id: 'approval-1',
        sessionId: seeded.sessionId!,
        requestId: 'req-1',
        request,
      }),
    )
    const pending = repo.getApproval(database.db, 'approval-1')
    expect(pending?.requestId).toBe('req-1')
    expect(pending?.decision).toBeNull()
    expect(repo.listPendingApprovals(database.db)).toHaveLength(1)

    database.db.transaction((tx) =>
      repo.updateApprovalDecision(tx, 'approval-1', 'allow', 'user', 4),
    )
    expect(repo.getApproval(database.db, 'approval-1')?.decision).toBe('allow')
    expect(repo.listPendingApprovals(database.db)).toEqual([])
    expect(repo.listApprovalsByTask(database.db, seeded.taskId)).toHaveLength(1)
  })

  it('records review evidence and the human verdict separately', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    const review: Review = {
      id: 'review-1',
      taskId: seeded.taskId,
      verdict: null,
      verifyExitCode: 0,
      verifyOutput: 'ok',
      diffStat: { filesChanged: 1, insertions: 2, deletions: 3 },
      decidedAt: null,
      preliminaryVerdict: null,
      preliminaryReason: null,
      preliminaryAt: null,
    }
    database.db.transaction((tx) => repo.insertReview(tx, review))
    const loaded = repo.getReviewByTask(database.db, seeded.taskId)
    expect(loaded?.verifyExitCode).toBe(0)
    expect(loaded?.verdict).toBeNull()

    database.db.transaction((tx) => repo.updateReviewVerdict(tx, 'review-1', 'approved', 5))
    expect(repo.getReviewByTask(database.db, seeded.taskId)?.verdict).toBe('approved')
  })

  it('writes audit rows', () => {
    const database = db()
    database.db.transaction((tx) =>
      repo.insertAudit(tx, {
        id: 'audit-1',
        ts: 1,
        actor: 'auto',
        action: 'approval.auto_allow',
        detail: { approvalId: 'a1' },
      }),
    )
    const row = database.raw.prepare('select actor, action, detail_json from audit').get() as {
      actor: string
      action: string
      detail_json: string
    }
    expect(row.actor).toBe('auto')
    expect(row.action).toBe('approval.auto_allow')
    expect(JSON.parse(row.detail_json)).toEqual({ approvalId: 'a1' })
  })
})

describe('M6-1 canvas repository', () => {
  function groupNode(canvasId: string, id: string): Node {
    return Node.parse({
      id,
      canvasId,
      type: 'group',
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      groupId: null,
      data: { label: '组', collapsed: false },
      createdAt: 1,
      updatedAt: 1,
    })
  }

  function textNode(canvasId: string, id: string, groupId: string | null = null): Node {
    return Node.parse({
      id,
      canvasId,
      type: 'text',
      x: 10,
      y: 10,
      w: 100,
      h: 50,
      groupId,
      data: { content: id },
      createdAt: 1,
      updatedAt: 1,
    })
  }

  it('moves nodes in one transaction and rejects unknown/duplicate ids', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    database.db.transaction((tx) => {
      repo.insertNode(tx, textNode(seeded.canvasId, 'n1'))
      repo.insertNode(tx, textNode(seeded.canvasId, 'n2'))
    })
    expect(
      database.db.transaction((tx) =>
        repo.moveNodes(tx, seeded.canvasId, [
          { nodeId: 'n1', x: 100, y: 110 },
          { nodeId: 'n2', x: 200, y: 210 },
        ]),
      ),
    ).toBe(2)
    expect(repo.getNode(database.db, 'n1')).toMatchObject({ x: 100, y: 110 })
    expect(() =>
      database.db.transaction((tx) =>
        repo.moveNodes(tx, seeded.canvasId, [{ nodeId: 'missing', x: 0, y: 0 }]),
      ),
    ).toThrow()
    // 失败整笔回滚，不能留下部分移动。
    expect(repo.getNode(database.db, 'n1')).toMatchObject({ x: 100, y: 110 })
    expect(() =>
      database.db.transaction((tx) =>
        repo.moveNodes(tx, seeded.canvasId, [
          { nodeId: 'n1', x: 0, y: 0 },
          { nodeId: 'n1', x: 1, y: 1 },
        ]),
      ),
    ).toThrow()
    expect(repo.getNode(database.db, 'n1')).toMatchObject({ x: 100, y: 110 })
  })

  it('creates a group and assigns children atomically', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    database.db.transaction((tx) => {
      repo.insertNode(tx, textNode(seeded.canvasId, 'n1'))
      repo.insertNode(tx, textNode(seeded.canvasId, 'n2'))
      repo.createGroup(tx, seeded.canvasId, groupNode(seeded.canvasId, 'g1'), ['n1', 'n2'])
    })
    expect(repo.getNode(database.db, 'g1')?.type).toBe('group')
    expect(repo.getNode(database.db, 'n1')?.groupId).toBe('g1')
    expect(repo.getNode(database.db, 'n2')?.groupId).toBe('g1')
    expect(() =>
      database.db.transaction((tx) =>
        repo.createGroup(tx, seeded.canvasId, groupNode(seeded.canvasId, 'g2'), ['n1']),
      ),
    ).toThrow()
    expect(repo.getNode(database.db, 'g2')).toBeNull()
    expect(repo.getNode(database.db, 'n1')?.groupId).toBe('g1')
  })

  it('ungroups children and writes preliminary verdict only for existing reviews', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    database.db.transaction((tx) => {
      repo.insertNode(tx, groupNode(seeded.canvasId, 'g1'))
      repo.insertNode(tx, textNode(seeded.canvasId, 'n1', 'g1'))
    })
    expect(database.db.transaction((tx) => repo.ungroupChildren(tx, 'g1'))).toBe(1)
    expect(repo.getNode(database.db, 'n1')?.groupId).toBeNull()

    const review: Review = {
      id: 'r1',
      taskId: seeded.taskId,
      verdict: null,
      verifyExitCode: 0,
      verifyOutput: 'ok',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      decidedAt: null,
      preliminaryVerdict: null,
      preliminaryReason: null,
      preliminaryAt: null,
    }
    database.db.transaction((tx) => repo.insertReview(tx, review))
    expect(
      database.db.transaction((tx) =>
        repo.setReviewPreliminary(tx, 'r1', { verdict: 'pass', reason: 'VERDICT: PASS', at: 3 }),
      ),
    ).toBe(true)
    expect(repo.getReviewByTask(database.db, seeded.taskId)).toMatchObject({
      preliminaryVerdict: 'pass',
      preliminaryReason: 'VERDICT: PASS',
      preliminaryAt: 3,
    })
    expect(
      database.db.transaction((tx) =>
        repo.setReviewPreliminary(tx, 'missing', { verdict: 'fail', reason: 'x', at: 4 }),
      ),
    ).toBe(false)
  })
})
