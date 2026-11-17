import { Task, type ApprovalRequest, type Review } from '@baton/protocol'
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

  it('updates task state and counts active tasks', () => {
    const database = db()
    const seeded = seedTask(database.raw)
    database.db.transaction((tx) => repo.updateTaskState(tx, seeded.taskId, 'running', 0, null, 2))
    expect(repo.getTask(database.db, seeded.taskId)?.status).toBe('running')
    expect(repo.countActiveTasks(database.db)).toBe(1)
    expect(repo.listTasksByStatus(database.db, ['running'])).toHaveLength(1)
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
