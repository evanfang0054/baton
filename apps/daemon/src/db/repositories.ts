import {
  Approval,
  Canvas,
  Edge,
  Node,
  Review,
  Session,
  Task,
  Workspace,
  type ApprovalDecision,
  type ApprovalRequest,
  type ReviewVerdict,
  type SessionStatus,
  type TaskStatus,
} from '@baton/protocol'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { approval, audit, canvas, edge, node, review, session, task, workspace } from './schema.js'
import type { Db, Tx } from './types.js'

const ACTIVE_TASK_STATUSES: TaskStatus[] = ['running', 'waiting_input', 'verifying']

export interface ApprovalRecord extends Approval {
  requestId: string | null
}

function toWorkspace(row: typeof workspace.$inferSelect): Workspace {
  return Workspace.parse({
    id: row.id,
    name: row.name,
    relPath: row.relPath,
    createdAt: row.createdAt,
  })
}

function toCanvas(row: typeof canvas.$inferSelect): Canvas {
  return Canvas.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    viewport: JSON.parse(row.viewportJson) as unknown,
  })
}

function toNode(row: typeof node.$inferSelect): Node {
  return Node.parse({
    id: row.id,
    canvasId: row.canvasId,
    type: row.type,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    groupId: row.groupId,
    data: JSON.parse(row.dataJson) as unknown,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

function toEdge(row: typeof edge.$inferSelect): Edge {
  return Edge.parse({
    id: row.id,
    canvasId: row.canvasId,
    sourceId: row.sourceId,
    targetId: row.targetId,
    type: row.type,
  })
}

function toTask(row: typeof task.$inferSelect): Task {
  return Task.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    nodeId: row.nodeId,
    title: row.title,
    prompt: row.prompt,
    status: row.status,
    engine: row.engine,
    workspaceMode: row.workspaceMode,
    branch: row.branch,
    worktreePath: row.worktreePath,
    verifyCommand: row.verifyCommand,
    retryCount: row.retryCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

function toSession(row: typeof session.$inferSelect): Session {
  return Session.parse({
    id: row.id,
    taskId: row.taskId,
    adapter: row.adapter,
    engineSessionId: row.engineSessionId,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  })
}

function toApproval(row: typeof approval.$inferSelect): ApprovalRecord {
  const parsed = Approval.parse({
    id: row.id,
    sessionId: row.sessionId,
    request: JSON.parse(row.requestJson) as unknown,
    decision: row.decision,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
  })
  return { ...parsed, requestId: row.requestId }
}

function toReview(row: typeof review.$inferSelect): Review | null {
  if (row.verifyExitCode === null || row.verifyOutput === null || row.diffStatJson === null) {
    return null
  }
  return Review.parse({
    id: row.id,
    taskId: row.taskId,
    verdict: row.verdict,
    verifyExitCode: row.verifyExitCode,
    verifyOutput: row.verifyOutput,
    diffStat: JSON.parse(row.diffStatJson) as unknown,
    decidedAt: row.decidedAt,
  })
}

export function listWorkspaces(db: Db): Workspace[] {
  return db.select().from(workspace).orderBy(asc(workspace.createdAt)).all().map(toWorkspace)
}

export function getWorkspace(db: Db, id: string): Workspace | null {
  const row = db.select().from(workspace).where(eq(workspace.id, id)).get()
  return row ? toWorkspace(row) : null
}

export function getWorkspaceByRelPath(db: Db, relPath: string): Workspace | null {
  const row = db.select().from(workspace).where(eq(workspace.relPath, relPath)).get()
  return row ? toWorkspace(row) : null
}

export function insertWorkspaceWithCanvas(
  db: Db,
  input: { workspace: Workspace; canvas: Canvas },
): void {
  db.transaction((tx) => {
    tx.insert(workspace)
      .values({
        id: input.workspace.id,
        name: input.workspace.name,
        relPath: input.workspace.relPath,
        createdAt: input.workspace.createdAt,
      })
      .run()
    tx.insert(canvas)
      .values({
        id: input.canvas.id,
        workspaceId: input.canvas.workspaceId,
        viewportJson: JSON.stringify(input.canvas.viewport),
      })
      .run()
  })
}

export function getCanvasByWorkspace(db: Db, workspaceId: string): Canvas | null {
  const row = db.select().from(canvas).where(eq(canvas.workspaceId, workspaceId)).get()
  return row ? toCanvas(row) : null
}

export function listNodes(db: Db, canvasId: string): Node[] {
  return db.select().from(node).where(eq(node.canvasId, canvasId)).all().map(toNode)
}

export function listEdges(db: Db, canvasId: string): Edge[] {
  return db.select().from(edge).where(eq(edge.canvasId, canvasId)).all().map(toEdge)
}

export function getTask(db: Db, id: string): Task | null {
  const row = db.select().from(task).where(eq(task.id, id)).get()
  return row ? toTask(row) : null
}

export function listTasks(db: Db, filter: { workspaceId: string; status?: TaskStatus }): Task[] {
  const where = filter.status
    ? and(eq(task.workspaceId, filter.workspaceId), eq(task.status, filter.status))
    : eq(task.workspaceId, filter.workspaceId)
  return db.select().from(task).where(where).orderBy(desc(task.createdAt)).all().map(toTask)
}

export function listTasksByStatus(db: Db, statuses: TaskStatus[]): Task[] {
  return db
    .select()
    .from(task)
    .where(inArray(task.status, statuses))
    .orderBy(asc(task.updatedAt), asc(task.id))
    .all()
    .map(toTask)
}

export function insertTask(tx: Tx, input: Task): void {
  tx.insert(task)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      nodeId: input.nodeId,
      title: input.title,
      prompt: input.prompt,
      status: input.status,
      engine: input.engine,
      workspaceMode: input.workspaceMode,
      branch: input.branch,
      worktreePath: input.worktreePath,
      verifyCommand: input.verifyCommand,
      retryCount: input.retryCount,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .run()
}

export function updateTaskState(
  tx: Tx,
  id: string,
  status: TaskStatus,
  retryCount: number,
  updatedAt: number,
): void {
  tx.update(task).set({ status, retryCount, updatedAt }).where(eq(task.id, id)).run()
}

export function appendTaskFeedback(
  tx: Tx,
  id: string,
  feedback: string,
  maxChars: number,
  updatedAt: number,
): void {
  const row = tx.select({ prompt: task.prompt }).from(task).where(eq(task.id, id)).get()
  if (!row) return
  const clipped =
    feedback.length > maxChars ? `${feedback.slice(0, maxChars)}\n…[truncated]` : feedback
  tx.update(task)
    .set({
      prompt: `${row.prompt}\n\n<feedback>\n${clipped}\n</feedback>`,
      updatedAt,
    })
    .where(eq(task.id, id))
    .run()
}

export function countActiveTasks(db: Db): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(task)
    .where(inArray(task.status, ACTIVE_TASK_STATUSES))
    .get()
  return row?.count ?? 0
}

export function insertSession(tx: Tx, input: Session): void {
  tx.insert(session)
    .values({
      id: input.id,
      taskId: input.taskId,
      adapter: input.adapter,
      engineSessionId: input.engineSessionId,
      status: input.status,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    })
    .run()
}

export function getSession(db: Db, id: string): Session | null {
  const row = db.select().from(session).where(eq(session.id, id)).get()
  return row ? toSession(row) : null
}

export function listSessionsByTask(db: Db, taskId: string): Session[] {
  return db
    .select()
    .from(session)
    .where(eq(session.taskId, taskId))
    .orderBy(asc(session.startedAt))
    .all()
    .map(toSession)
}

export function listSessionsByStatus(db: Db, statuses: SessionStatus[]): Session[] {
  return db
    .select()
    .from(session)
    .where(inArray(session.status, statuses))
    .orderBy(asc(session.startedAt))
    .all()
    .map(toSession)
}

export function getActiveSession(db: Db, taskId: string): Session | null {
  const sessions = listSessionsByTask(db, taskId)
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const current = sessions[index]!
    if (current.status === 'running' || current.status === 'waiting_input') return current
  }
  return null
}

export function updateSessionStatus(
  tx: Tx,
  id: string,
  status: SessionStatus,
  endedAt: number | null = null,
): void {
  tx.update(session).set({ status, endedAt }).where(eq(session.id, id)).run()
}

export function updateSessionEngineId(tx: Tx, id: string, engineSessionId: string): void {
  tx.update(session).set({ engineSessionId }).where(eq(session.id, id)).run()
}

export function insertApproval(
  tx: Tx,
  input: {
    id: string
    sessionId: string
    requestId: string
    request: ApprovalRequest
  },
): void {
  tx.insert(approval)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      requestId: input.requestId,
      requestJson: JSON.stringify(input.request),
      decision: null,
      decidedBy: null,
      decidedAt: null,
    })
    .run()
}

export function getApproval(db: Db, id: string): ApprovalRecord | null {
  const row = db.select().from(approval).where(eq(approval.id, id)).get()
  return row ? toApproval(row) : null
}

export function listApprovalsByTask(db: Db, taskId: string): ApprovalRecord[] {
  return db
    .select({ approval })
    .from(approval)
    .innerJoin(session, eq(approval.sessionId, session.id))
    .where(eq(session.taskId, taskId))
    .orderBy(asc(approval.id))
    .all()
    .map((row) => toApproval(row.approval))
}

export function listPendingApprovals(db: Db): ApprovalRecord[] {
  return db
    .select()
    .from(approval)
    .where(sql`${approval.decision} is null`)
    .orderBy(asc(approval.id))
    .all()
    .map(toApproval)
}

export function updateApprovalDecision(
  tx: Tx,
  id: string,
  decision: ApprovalDecision,
  decidedBy: string,
  decidedAt: number,
): void {
  tx.update(approval).set({ decision, decidedBy, decidedAt }).where(eq(approval.id, id)).run()
}

export function insertReview(tx: Tx, input: Review): void {
  tx.insert(review)
    .values({
      id: input.id,
      taskId: input.taskId,
      verdict: input.verdict,
      verifyExitCode: input.verifyExitCode,
      verifyOutput: input.verifyOutput,
      diffStatJson: JSON.stringify(input.diffStat),
      decidedAt: input.decidedAt,
    })
    .run()
}

export function getReviewByTask(db: Db, taskId: string): Review | null {
  const row = db
    .select()
    .from(review)
    .where(eq(review.taskId, taskId))
    .orderBy(desc(sql`rowid`))
    .limit(1)
    .get()
  return row ? toReview(row) : null
}

export function getReview(db: Db, id: string): Review | null {
  const row = db.select().from(review).where(eq(review.id, id)).get()
  return row ? toReview(row) : null
}

export function updateReviewVerdict(
  tx: Tx,
  id: string,
  verdict: ReviewVerdict,
  decidedAt: number,
): void {
  tx.update(review).set({ verdict, decidedAt }).where(eq(review.id, id)).run()
}

export function insertAudit(
  tx: Tx,
  input: { id: string; ts: number; actor: string; action: string; detail: unknown },
): void {
  tx.insert(audit)
    .values({
      id: input.id,
      ts: input.ts,
      actor: input.actor,
      action: input.action,
      detailJson: JSON.stringify(input.detail),
    })
    .run()
}
