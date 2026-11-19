import {
  Approval,
  Audit,
  Canvas,
  ContextSnapshot,
  Edge,
  Node,
  Notice,
  Policy,
  PolicySchema,
  Review,
  Session,
  Task,
  TaskDetail,
  TaskOrigin,
  Workspace,
  type ApprovalDecision,
  type ApprovalRequest,
  type ReviewVerdict,
  type SessionOutcome,
  type SessionStatus,
  type SessionEventRecord,
  type TaskStatus,
  type WaitingReason,
} from '@baton/protocol'
import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from 'drizzle-orm'
import {
  approval,
  audit,
  canvas,
  edge,
  event,
  node,
  notice,
  review,
  session,
  setting,
  task,
  workspace,
} from './schema.js'
import type { Db, Tx } from './types.js'

export interface ApprovalRecord extends Approval {
  requestId: string | null
}

function toWorkspace(row: typeof workspace.$inferSelect): Workspace {
  return Workspace.parse({
    id: row.id,
    name: row.name,
    relPath: row.relPath,
    trusted: row.trusted,
    projectHooks: row.projectHooks,
    trustedAt: row.trustedAt,
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
    waitingReason: row.waitingReason as WaitingReason | null,
    engine: row.engine,
    workspaceMode: row.workspaceMode,
    branch: row.branch,
    worktreePath: row.worktreePath,
    verifyCommand: row.verifyCommand,
    retryCount: row.retryCount,
    dangerouslySkipPermissions: row.dangerouslySkipPermissions,
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
    outcome: row.outcome as SessionOutcome | null,
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
    response: row.responseJson ? (JSON.parse(row.responseJson) as unknown) : null,
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
        trusted: input.workspace.trusted,
        projectHooks: input.workspace.projectHooks,
        trustedAt: input.workspace.trustedAt,
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

export function updateWorkspaceTrust(
  tx: Tx,
  id: string,
  input: { trusted: boolean; projectHooks: 'off' | 'on'; trustedAt: number | null },
): void {
  tx.update(workspace).set(input).where(eq(workspace.id, id)).run()
}

export function getCanvasByWorkspace(db: Db, workspaceId: string): Canvas | null {
  const row = db.select().from(canvas).where(eq(canvas.workspaceId, workspaceId)).get()
  return row ? toCanvas(row) : null
}

export function listNodes(db: Db, canvasId: string): Node[] {
  return db.select().from(node).where(eq(node.canvasId, canvasId)).all().map(toNode)
}

export function getCanvas(db: Db, id: string): Canvas | null {
  const row = db.select().from(canvas).where(eq(canvas.id, id)).get()
  return row ? toCanvas(row) : null
}

export function getNode(db: Db, id: string): Node | null {
  const row = db.select().from(node).where(eq(node.id, id)).get()
  return row ? toNode(row) : null
}

export function insertNode(tx: Tx, input: Node): void {
  tx.insert(node)
    .values({
      id: input.id,
      canvasId: input.canvasId,
      type: input.type,
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      groupId: input.groupId,
      dataJson: JSON.stringify(input.data),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .run()
}

export function updateNode(
  tx: Tx,
  id: string,
  patch: {
    x?: number
    y?: number
    w?: number
    h?: number
    data?: unknown
    updatedAt: number
  },
): void {
  const set: Partial<typeof node.$inferInsert> = { updatedAt: patch.updatedAt }
  if (patch.x !== undefined) set.x = patch.x
  if (patch.y !== undefined) set.y = patch.y
  if (patch.w !== undefined) set.w = patch.w
  if (patch.h !== undefined) set.h = patch.h
  if (patch.data !== undefined) set.dataJson = JSON.stringify(patch.data)
  tx.update(node).set(set).where(eq(node.id, id)).run()
}

export function deleteNode(tx: Tx, id: string): void {
  tx.delete(node).where(eq(node.id, id)).run()
}

export function getEdge(db: Db, id: string): Edge | null {
  const row = db.select().from(edge).where(eq(edge.id, id)).get()
  return row ? toEdge(row) : null
}

export function findEdge(
  db: Db,
  input: { canvasId: string; sourceId: string; targetId: string; type: string },
): Edge | null {
  const row = db
    .select()
    .from(edge)
    .where(
      and(
        eq(edge.canvasId, input.canvasId),
        eq(edge.sourceId, input.sourceId),
        eq(edge.targetId, input.targetId),
        eq(edge.type, input.type),
      ),
    )
    .get()
  return row ? toEdge(row) : null
}

export function insertEdge(tx: Tx, value: Edge): void {
  tx.insert(edge)
    .values({
      id: value.id,
      canvasId: value.canvasId,
      sourceId: value.sourceId,
      targetId: value.targetId,
      type: value.type,
    })
    .run()
}

export function deleteEdgeById(tx: Tx, id: string): void {
  tx.delete(edge).where(eq(edge.id, id)).run()
}

export function deleteEdgesForNode(tx: Tx, nodeId: string): void {
  tx.delete(edge)
    .where(or(eq(edge.sourceId, nodeId), eq(edge.targetId, nodeId)))
    .run()
}

export function hasTaskForNode(db: Db, nodeId: string): boolean {
  return (
    db.select({ id: task.id }).from(task).where(eq(task.nodeId, nodeId)).limit(1).get() !==
    undefined
  )
}

export function listSessionEvents(
  db: Db,
  sessionId: string,
  sinceSeq: number,
  limit: number,
): { rows: SessionEventRecord[]; hasMore: boolean } {
  const rows = db
    .select()
    .from(event)
    .where(and(eq(event.sessionId, sessionId), gt(event.seq, sinceSeq)))
    .orderBy(asc(event.seq))
    .limit(limit + 1)
    .all()

  return {
    rows: rows.slice(0, limit).map((row) => ({
      seq: row.seq,
      type: row.type,
      payload: JSON.parse(row.payloadJson) as unknown,
      ts: row.ts,
    })),
    hasMore: rows.length > limit,
  }
}

export function listEdges(db: Db, canvasId: string): Edge[] {
  return db.select().from(edge).where(eq(edge.canvasId, canvasId)).all().map(toEdge)
}

function getTaskRow(db: Db, id: string) {
  return db.select().from(task).where(eq(task.id, id)).get()
}

export function getTask(db: Db, id: string): Task | null {
  const row = getTaskRow(db, id)
  return row ? toTask(row) : null
}

export function getTaskDetail(
  db: Db,
  id: string,
): { task: TaskDetail; contextInvalid: boolean; originInvalid: boolean } | null {
  const row = getTaskRow(db, id)
  if (!row) return null
  const base = toTask(row)

  let context: ContextSnapshot | null = null
  let contextInvalid = false
  if (row.contextJson) {
    try {
      const parsed = ContextSnapshot.safeParse(JSON.parse(row.contextJson) as unknown)
      if (parsed.success) {
        context = parsed.data
      } else {
        contextInvalid = true
      }
    } catch {
      contextInvalid = true
    }
  }

  let origin: TaskOrigin | null = null
  let originInvalid = false
  if (row.originJson) {
    try {
      const parsed = TaskOrigin.safeParse(JSON.parse(row.originJson) as unknown)
      if (parsed.success) {
        origin = parsed.data
      } else {
        originInvalid = true
      }
    } catch {
      originInvalid = true
    }
  }

  return {
    task: TaskDetail.parse({ ...base, context, origin }),
    contextInvalid,
    originInvalid,
  }
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

export function insertTask(
  tx: Tx,
  input: Task,
  contextJson: string | null = null,
  originJson: string | null = null,
): void {
  tx.insert(task)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      nodeId: input.nodeId,
      title: input.title,
      prompt: input.prompt,
      status: input.status,
      waitingReason: input.waitingReason,
      engine: input.engine,
      workspaceMode: input.workspaceMode,
      branch: input.branch,
      worktreePath: input.worktreePath,
      verifyCommand: input.verifyCommand,
      retryCount: input.retryCount,
      dangerouslySkipPermissions: input.dangerouslySkipPermissions,
      contextJson,
      originJson,
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
  waitingReason: WaitingReason | null,
  now: number,
): void {
  tx.update(task)
    .set({ status, retryCount, waitingReason, updatedAt: now })
    .where(eq(task.id, id))
    .run()
}

export function updateTaskPolicy(tx: Tx, id: string, policy: Policy): void {
  tx.update(task)
    .set({ policyJson: JSON.stringify(policy) })
    .where(eq(task.id, id))
    .run()
}

export function getTaskPolicy(db: Db, id: string): Policy | null {
  const row = db.select({ policyJson: task.policyJson }).from(task).where(eq(task.id, id)).get()
  if (!row?.policyJson) return null
  try {
    return PolicySchema.parse(JSON.parse(row.policyJson))
  } catch {
    return null
  }
}

export function appendTaskFeedback(
  tx: Tx,
  id: string,
  feedback: string,
  maxChars: number,
  updatedAt: number,
): void {
  appendTaskPromptBlock(tx, id, 'feedback', feedback, maxChars, updatedAt)
}

export function appendTaskPromptBlock(
  tx: Tx,
  id: string,
  tag: 'feedback' | 'user_reply',
  content: string,
  maxChars: number,
  updatedAt: number,
): void {
  const row = tx.select({ prompt: task.prompt }).from(task).where(eq(task.id, id)).get()
  if (!row) {
    return
  }
  const clipped =
    content.length > maxChars ? `${content.slice(0, maxChars)}\n…[truncated]` : content
  tx.update(task)
    .set({
      prompt: `${row.prompt}\n\n<${tag}>\n${clipped}\n</${tag}>`,
      updatedAt,
    })
    .where(eq(task.id, id))
    .run()
}

export function countActiveTasks(db: Db): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(task)
    .where(sql`${task.status} in ('running', 'verifying')`)
    .get()
  return row?.count ?? 0
}

export function countLiveSessions(db: Db): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(session)
    .where(sql`${session.status} in ('running', 'waiting_input')`)
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
      outcome: input.outcome,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    })
    .run()
}

export function getSession(db: Db, id: string): Session | null {
  const row = db.select().from(session).where(eq(session.id, id)).get()
  return row ? toSession(row) : null
}

export function listSessionsByTask(db: Pick<Db, 'select'>, taskId: string): Session[] {
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

export function getActiveSession(db: Pick<Db, 'select'>, taskId: string): Session | null {
  const sessions = listSessionsByTask(db, taskId)
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const current = sessions[index]!
    if (current.status === 'running' || current.status === 'waiting_input') {
      return current
    }
  }
  return null
}

export function updateSessionStatus(
  tx: Tx,
  id: string,
  status: SessionStatus,
  endedAt: number | null = null,
  outcome: SessionOutcome | null = null,
): void {
  tx.update(session).set({ status, endedAt, outcome }).where(eq(session.id, id)).run()
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

export function updateApprovalResponse(tx: Tx, id: string, response: unknown): void {
  tx.update(approval)
    .set({ responseJson: JSON.stringify(response) })
    .where(eq(approval.id, id))
    .run()
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

function toAudit(row: typeof audit.$inferSelect): Audit {
  return Audit.parse({
    id: row.id,
    ts: row.ts,
    actor: row.actor,
    action: row.action,
    detail: JSON.parse(row.detailJson) as unknown,
  })
}

function toNotice(row: typeof notice.$inferSelect): Notice {
  return Notice.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    ts: row.ts,
    kind: row.kind,
    payload: JSON.parse(row.payloadJson) as unknown,
    readAt: row.readAt,
  })
}

export function getSetting(db: Db, key: string): unknown {
  const row = db.select().from(setting).where(eq(setting.key, key)).get()
  if (!row) return null
  // 安全设置（如 kill switch）不能把损坏 JSON 静默当成“未设置”。
  return JSON.parse(row.valueJson) as unknown
}

export function setSetting(tx: Tx, key: string, value: unknown, now: number): void {
  const valueJson = JSON.stringify(value)
  tx.insert(setting)
    .values({ key, valueJson, updatedAt: now })
    .onConflictDoUpdate({
      target: setting.key,
      set: { valueJson, updatedAt: now },
    })
    .run()
}

export function insertNotice(
  tx: Tx,
  input: {
    id: string
    workspaceId: string | null
    ts: number
    kind: string
    payload: unknown
  },
): void {
  tx.insert(notice)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      ts: input.ts,
      kind: input.kind,
      payloadJson: JSON.stringify(input.payload),
      readAt: null,
    })
    .run()
}

export function listNotices(
  db: Db,
  filter: { workspaceId?: string; kind?: string; limit: number; before?: number },
): Notice[] {
  const conditions = [
    filter.workspaceId ? eq(notice.workspaceId, filter.workspaceId) : undefined,
    filter.kind ? eq(notice.kind, filter.kind) : undefined,
    filter.before !== undefined ? lt(notice.ts, filter.before) : undefined,
  ].filter((condition) => condition !== undefined)
  return db
    .select()
    .from(notice)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(notice.ts))
    .limit(filter.limit)
    .all()
    .map(toNotice)
}

export function markNoticeRead(tx: Tx, id: string, readAt: number): boolean {
  return tx.update(notice).set({ readAt }).where(eq(notice.id, id)).run().changes > 0
}

export function listAudit(
  db: Db,
  filter: { actionPrefix?: string; limit: number; before?: number },
): Audit[] {
  const conditions = [
    filter.actionPrefix ? gte(audit.action, filter.actionPrefix) : undefined,
    filter.actionPrefix ? lt(audit.action, `${filter.actionPrefix}\uffff`) : undefined,
    filter.before !== undefined ? lt(audit.ts, filter.before) : undefined,
  ].filter((condition) => condition !== undefined)
  return db
    .select()
    .from(audit)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(audit.ts))
    .limit(filter.limit)
    .all()
    .map(toAudit)
}
