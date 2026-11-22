import {
  Approval,
  Audit,
  Canvas,
  ContextInjection,
  ContextSnapshot,
  DiffSnapshot,
  Edge,
  Node,
  Notice,
  Policy,
  PolicySchema,
  Review,
  ReviewView,
  Session,
  SessionOutcome,
  SESSION_OUTCOME_EVENT,
  Task,
  TaskDetail,
  TaskOrigin,
  TaskStatusEvent,
  Workspace,
  type ApprovalDecision,
  type ApprovalRequest,
  type PreliminaryVerdict,
  type ReviewVerdict,
  type SessionStatus,
  type SessionEventRecord,
  type TaskStatus,
  type TaskStatusHistoryItem,
  type WaitingReason,
} from '@baton/protocol'
import { and, asc, desc, eq, gt, gte, inArray, lt, ne, notInArray, or, sql } from 'drizzle-orm'
import { appError } from '../errors.js'
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
  supervisorMessage,
  task,
  workspace,
  wsEvent,
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
    budgetUsd: row.budgetUsd ?? null,
    enqueuedAt: row.enqueuedAt ?? null,
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
    costUsd: row.costUsd ?? null,
    turns: row.turns ?? null,
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
    preliminaryVerdict: row.preliminaryVerdict as Review['preliminaryVerdict'],
    preliminaryReason: row.preliminaryReason,
    preliminaryAt: row.preliminaryAt,
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
    groupId?: string | null
    data?: unknown
    updatedAt: number
  },
): void {
  const set: Partial<typeof node.$inferInsert> = { updatedAt: patch.updatedAt }
  if (patch.x !== undefined) set.x = patch.x
  if (patch.y !== undefined) set.y = patch.y
  if (patch.w !== undefined) set.w = patch.w
  if (patch.h !== undefined) set.h = patch.h
  if (patch.groupId !== undefined) set.groupId = patch.groupId
  if (patch.data !== undefined) set.dataJson = JSON.stringify(patch.data)
  tx.update(node).set(set).where(eq(node.id, id)).run()
}

export function deleteNode(tx: Tx, id: string): void {
  tx.delete(node).where(eq(node.id, id)).run()
}

/** 批量移动保持绝对坐标；任一节点不存在/不属于 canvas/重复/坐标非法时整笔拒绝。 */
export function moveNodes(
  tx: Tx,
  canvasId: string,
  moves: Array<{ nodeId: string; x: number; y: number }>,
  updatedAt = Date.now(),
): number {
  const ids = new Set<string>()
  for (const move of moves) {
    if (ids.has(move.nodeId)) {
      throw appError('node_move_invalid', 'duplicate nodeId', { nodeId: move.nodeId })
    }
    if (!Number.isFinite(move.x) || !Number.isFinite(move.y)) {
      throw appError('node_move_invalid', 'invalid coordinate', { nodeId: move.nodeId })
    }
    ids.add(move.nodeId)
  }
  const rows = tx.select({ id: node.id }).from(node).where(eq(node.canvasId, canvasId)).all()
  const known = new Set(rows.map((row) => row.id))
  for (const id of ids) {
    if (!known.has(id)) {
      throw appError('node_move_invalid', 'node not in canvas', { nodeId: id })
    }
  }
  for (const move of moves) {
    tx.update(node).set({ x: move.x, y: move.y, updatedAt }).where(eq(node.id, move.nodeId)).run()
  }
  return moves.length
}

/** 新建 group 并批量设置子节点 groupId；子节点必须同 canvas、未分组、不是 group。 */
export function createGroup(tx: Tx, canvasId: string, group: Node, childIds: string[]): void {
  if (group.type !== 'group' || group.canvasId !== canvasId || group.groupId !== null) {
    throw appError('group_invalid', 'invalid group')
  }
  const unique = new Set(childIds)
  if (unique.size !== childIds.length) throw appError('group_invalid', 'duplicate childId')
  const rows = tx.select().from(node).where(eq(node.canvasId, canvasId)).all()
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const id of childIds) {
    const child = byId.get(id)
    if (!child) throw appError('group_invalid', 'child not in canvas', { nodeId: id })
    if (child.type === 'group') {
      throw appError('group_invalid', 'nested group is not supported', { nodeId: id })
    }
    if (child.groupId !== null) {
      throw appError('group_invalid', 'child already grouped', { nodeId: id })
    }
  }
  insertNode(tx, group)
  for (const id of childIds) {
    tx.update(node)
      .set({ groupId: group.id, updatedAt: group.updatedAt })
      .where(eq(node.id, id))
      .run()
  }
}

/** 删除分组前把子节点解绑；返回解绑数量。 */
export function ungroupChildren(tx: Tx, groupId: string, updatedAt = Date.now()): number {
  const rows = tx.select({ id: node.id }).from(node).where(eq(node.groupId, groupId)).all()
  tx.update(node).set({ groupId: null, updatedAt }).where(eq(node.groupId, groupId)).run()
  return rows.length
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

/**
 * 找出为某个目标任务派出、还没结束的验收员。
 * 目标离开 review 后本轮验收结论失效，需要取消它们，避免验收员继续占用共享 worktree。
 */
export function findActiveVerifierIdsForTarget(db: Db, targetTaskId: string): string[] {
  const rows = db
    .select({ id: task.id, originJson: task.originJson })
    .from(task)
    .where(notInArray(task.status, ['done', 'cancelled', 'failed']))
    .all()
  return rows
    .filter((row) => {
      if (!row.originJson) return false
      try {
        const origin = TaskOrigin.safeParse(JSON.parse(row.originJson) as unknown)
        return (
          origin.success &&
          origin.data.source === 'supervisor-review' &&
          origin.data.reviewOfTaskId === targetTaskId
        )
      } catch {
        return false
      }
    })
    .map((row) => row.id)
}

export function countEdges(db: Db, canvasId: string): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(edge)
    .where(eq(edge.canvasId, canvasId))
    .get()
  return row?.count ?? 0
}

/** 验收员会复用目标任务的 worktree；清理前必须确认没有其他未结束任务还引用同一路径。 */
export function hasOtherWorktreeReference(db: Db, worktreePath: string, taskId: string): boolean {
  const row = db
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        eq(task.worktreePath, worktreePath),
        ne(task.id, taskId),
        notInArray(task.status, ['done', 'cancelled', 'failed']),
      ),
    )
    .limit(1)
    .get()
  return row !== undefined
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

/**
 * 取 session 最后上报的 outcome。
 * 事件页按 seq 升序分页，客户端只加载首批时看不到尾部的 outcome；
 * 这里直接从数据库倒序取，任务详情用它展示阻塞原因。
 */
export function getSessionLastOutcome(
  db: Db,
  sessionId: string,
): { outcome: SessionOutcome; reason: string | null } | null {
  const rows = db
    .select({ payloadJson: event.payloadJson })
    .from(event)
    .where(and(eq(event.sessionId, sessionId), eq(event.type, 'CUSTOM')))
    .orderBy(desc(event.seq))
    .limit(20)
    .all()
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payloadJson) as {
        name?: unknown
        value?: { outcome?: unknown; reason?: unknown }
      }
      if (payload.name !== SESSION_OUTCOME_EVENT) continue
      const outcome = SessionOutcome.safeParse(payload.value?.outcome)
      if (!outcome.success) continue
      const reason =
        typeof payload.value?.reason === 'string' && payload.value.reason.trim()
          ? payload.value.reason
          : null
      return { outcome: outcome.data, reason }
    } catch {
      continue
    }
  }
  return null
}

/**
 * 取 worker 最后上报的 outcome reason。
 * 验收员有时只在 report_outcome 的 reason 里写结论，不写最后一条消息。
 */
export function getSessionOutcomeReason(db: Db, sessionId: string): string | null {
  return getSessionLastOutcome(db, sessionId)?.reason ?? null
}

/**
 * 取最近一条 assistant 文本消息的尾部。
 * 验收员把 VERDICT 放在最后一行，因此从最新事件倒推并保留尾部。
 */
export function getLastAssistantText(db: Db, sessionId: string, maxChars = 6000): string {
  return getAssistantTranscriptText(db, sessionId, maxChars, 'last')
}

/**
 * 取整个 session 的 assistant 文本；`last` 只保留最后一条消息。
 * 验收员有时把 VERDICT 写在倒数第二条，解析时要能看到全文。
 */
export function getAssistantTranscriptText(
  db: Db,
  sessionId: string,
  maxChars = 6000,
  mode: 'last' | 'all' = 'all',
): string {
  const rows = db
    .select({ seq: event.seq, payloadJson: event.payloadJson })
    .from(event)
    .where(and(eq(event.sessionId, sessionId), eq(event.type, 'TEXT_MESSAGE_CONTENT')))
    .orderBy(asc(event.seq))
    .all()
  if (rows.length === 0) return ''

  const byMessage = new Map<string, string[]>()
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payloadJson) as {
        messageId?: unknown
        delta?: unknown
      }
      if (typeof payload.messageId !== 'string' || typeof payload.delta !== 'string') continue
      const chunks = byMessage.get(payload.messageId) ?? []
      chunks.push(payload.delta)
      byMessage.set(payload.messageId, chunks)
    } catch {
      continue
    }
  }
  const texts = [...byMessage.values()].map((chunks) => chunks.join(''))
  const selected = mode === 'last' ? (texts.at(-1) ?? '') : texts.join('\n')
  return selected.slice(-maxChars)
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

/** 队列顺序以入队时间为准；旧数据没有 enqueued_at 时退回 updated_at。 */
export function listQueuedTasksByEnqueuedAt(db: Db): Task[] {
  return db
    .select()
    .from(task)
    .where(eq(task.status, 'queued'))
    .orderBy(sql`coalesce(${task.enqueuedAt}, ${task.updatedAt})`, asc(task.id))
    .all()
    .map(toTask)
}

export function insertTask(
  tx: Tx,
  input: Omit<Task, 'enqueuedAt' | 'budgetUsd'> & {
    enqueuedAt?: number | null
    budgetUsd?: number | null
  },
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
      budgetUsd: input.budgetUsd ?? null,
      contextJson,
      originJson,
      enqueuedAt: input.enqueuedAt ?? null,
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

export function setTaskEnqueuedAt(tx: Tx, id: string, at: number): void {
  tx.update(task).set({ enqueuedAt: at }).where(eq(task.id, id)).run()
}

export function clearTaskEnqueuedAt(tx: Tx, id: string): void {
  tx.update(task).set({ enqueuedAt: null }).where(eq(task.id, id)).run()
}

export function updateTaskWorktreePath(
  db: Pick<Db, 'update'>,
  id: string,
  worktreePath: string | null,
  updatedAt: number,
  branch?: string | null,
): void {
  db.update(task)
    .set({ worktreePath, ...(branch === undefined ? {} : { branch }), updatedAt })
    .where(eq(task.id, id))
    .run()
}

/** 总管同一轮内先建后改标题时使用；只允许 todo 任务由调用方自行约束。 */
export function updateTaskTitle(
  db: Pick<Db, 'update'>,
  id: string,
  title: string,
  updatedAt: number,
): void {
  db.update(task).set({ title, updatedAt }).where(eq(task.id, id)).run()
}

/** 人重新授权时写入新的 origin 快照；不改任务状态。 */
export function updateTaskOrigin(tx: Tx, id: string, originJson: string, updatedAt: number): void {
  tx.update(task).set({ originJson, updatedAt }).where(eq(task.id, id)).run()
}

export function updateTaskBudget(tx: Tx, id: string, budgetUsd: number, updatedAt: number): void {
  tx.update(task).set({ budgetUsd, updatedAt }).where(eq(task.id, id)).run()
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
  tag: 'feedback' | 'user_reply' | 'reopen_note',
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

export function appendTaskPromptRaw(
  tx: Tx,
  id: string,
  text: string,
  maxChars: number,
  updatedAt: number,
): void {
  const row = tx.select({ prompt: task.prompt }).from(task).where(eq(task.id, id)).get()
  if (!row) {
    return
  }
  const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text
  tx.update(task)
    .set({
      prompt: `${row.prompt}\n\n${clipped}`,
      updatedAt,
    })
    .where(eq(task.id, id))
    .run()
}

export function appendTaskContextInjection(
  tx: Tx,
  taskId: string,
  injection: ContextInjection,
  limits?: { maxCumulativeChars: number },
): void {
  const row = tx
    .select({ contextJson: task.contextJson })
    .from(task)
    .where(eq(task.id, taskId))
    .get()
  if (!row) {
    return
  }
  const fallback: ContextSnapshot = {
    included: [],
    dropped: [],
    truncated: false,
    redactedPaths: [],
    relations: [],
    relationsTruncated: false,
    injections: [],
  }
  let snapshot = fallback
  if (row.contextJson) {
    try {
      const parsed = ContextSnapshot.safeParse(JSON.parse(row.contextJson) as unknown)
      if (!parsed.success) {
        throw appError('context_invalid', 'existing context snapshot is invalid', { taskId })
      }
      snapshot = parsed.data
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error
      throw appError('context_invalid', 'existing context snapshot is not valid JSON', { taskId })
    }
  }
  // prepare 与写入之间可能隔着一个事务边界；在写入时再核对一次，避免重复 seq 或超预算。
  const expectedSeq = snapshot.injections.length + 1
  if (injection.seq !== expectedSeq) {
    throw appError('context_conflict', 'context injection sequence is stale', {
      taskId,
      expectedSeq,
      seq: injection.seq,
    })
  }
  if (limits) {
    const used = snapshot.injections.reduce((sum, item) => sum + item.chars, 0)
    if (used + injection.chars > limits.maxCumulativeChars) {
      throw appError('context_budget_exceeded', 'cumulative injection budget exceeded', {
        limit: limits.maxCumulativeChars,
        used,
        requested: injection.chars,
      })
    }
  }
  tx.update(task)
    .set({
      contextJson: JSON.stringify({
        ...snapshot,
        injections: [...snapshot.injections, injection],
      }),
    })
    .where(eq(task.id, taskId))
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

export function insertSession(
  tx: Tx,
  input: Omit<Session, 'costUsd' | 'turns'> & {
    costUsd?: number | null
    turns?: number | null
  },
): void {
  tx.insert(session)
    .values({
      id: input.id,
      taskId: input.taskId,
      adapter: input.adapter,
      engineSessionId: input.engineSessionId,
      status: input.status,
      outcome: input.outcome,
      costUsd: input.costUsd ?? null,
      turns: input.turns ?? null,
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

export function listSessionsByTasks(db: Db, taskIds: string[]): Session[] {
  if (taskIds.length === 0) return []
  return db
    .select()
    .from(session)
    .where(inArray(session.taskId, taskIds))
    .orderBy(asc(session.startedAt))
    .all()
    .map(toSession)
}

export function listReviewsByTask(db: Db, taskId: string): ReviewView[] {
  return db
    .select()
    .from(review)
    .where(eq(review.taskId, taskId))
    .orderBy(desc(sql`rowid`))
    .all()
    .map((row) => {
      const parsed = toReview(row)
      return parsed ? { ...parsed, diffAvailable: row.diffJson !== null } : null
    })
    .filter((item): item is ReviewView => item !== null)
}

export function listTaskStatusHistory(
  db: Db,
  taskId: string,
  limit: number,
  beforeOrdinal?: number,
): { items: TaskStatusHistoryItem[]; nextBeforeOrdinal?: number } {
  const rows = db
    .select()
    .from(wsEvent)
    .where(
      and(
        eq(wsEvent.taskId, taskId),
        eq(wsEvent.type, 'task.status'),
        beforeOrdinal !== undefined ? lt(wsEvent.ordinal, beforeOrdinal) : undefined,
      ),
    )
    .orderBy(desc(wsEvent.ordinal))
    .limit(limit + 1)
    .all()
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const items: TaskStatusHistoryItem[] = []
  for (const row of page) {
    try {
      const payload = TaskStatusEvent.shape.payload.parse(JSON.parse(row.payloadJson))
      items.push({
        ordinal: row.ordinal,
        ts: row.ts,
        status: payload.status,
        previousStatus: payload.previousStatus,
        retryCount: payload.retryCount,
        ...(payload.cause ? { cause: payload.cause } : {}),
        ...(payload.attention ? { attention: payload.attention } : {}),
      })
    } catch {
      // 旧行或坏 JSON 不应让整页历史不可用。
    }
  }
  return {
    items,
    ...(hasMore ? { nextBeforeOrdinal: page[page.length - 1]!.ordinal } : {}),
  }
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

export function updateSessionUsage(
  tx: Tx,
  id: string,
  usage: { costUsd?: number; turns?: number },
): void {
  if (usage.costUsd === undefined && usage.turns === undefined) return
  tx.update(session)
    .set({
      ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
      ...(usage.turns !== undefined ? { turns: usage.turns } : {}),
    })
    .where(eq(session.id, id))
    .run()
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

export function countAutoApprovals(db: Db, taskId: string): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(approval)
    .innerJoin(session, eq(approval.sessionId, session.id))
    .where(and(eq(session.taskId, taskId), eq(approval.decidedBy, 'auto')))
    .get()
  return row?.count ?? 0
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

type ReviewInsert = Omit<Review, 'preliminaryVerdict' | 'preliminaryReason' | 'preliminaryAt'>

export function insertReview(tx: Tx, input: ReviewInsert): void {
  tx.insert(review)
    .values({
      id: input.id,
      taskId: input.taskId,
      verdict: input.verdict,
      verifyExitCode: input.verifyExitCode,
      verifyOutput: input.verifyOutput,
      diffStatJson: JSON.stringify(input.diffStat),
      decidedAt: input.decidedAt,
      preliminaryVerdict: null,
      preliminaryReason: null,
      preliminaryAt: null,
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

export function updateReviewDiff(db: Db, id: string, snapshot: DiffSnapshot): void {
  db.update(review)
    .set({ diffJson: JSON.stringify(snapshot) })
    .where(eq(review.id, id))
    .run()
}

export function getReviewDiff(db: Db, id: string): DiffSnapshot | null {
  const row = db.select({ diffJson: review.diffJson }).from(review).where(eq(review.id, id)).get()
  if (!row?.diffJson) {
    return null
  }
  try {
    return DiffSnapshot.parse(JSON.parse(row.diffJson))
  } catch {
    return null
  }
}

/** 详情只需要“有没有快照”；不要为算一个布尔值解析 512KB 的 diff 正文。 */
export function hasReviewDiff(db: Db, id: string): boolean {
  const row = db.select({ diffJson: review.diffJson }).from(review).where(eq(review.id, id)).get()
  return Boolean(row?.diffJson)
}

export function updateReviewVerdict(
  tx: Tx,
  id: string,
  verdict: ReviewVerdict,
  decidedAt: number,
): void {
  tx.update(review).set({ verdict, decidedAt }).where(eq(review.id, id)).run()
}

/** 验收员初步结论只写当前 review；review 不存在返回 false。 */
export function setReviewPreliminary(
  tx: Tx,
  reviewId: string,
  input: { verdict: PreliminaryVerdict; reason: string; at: number },
): boolean {
  const existing = tx.select({ id: review.id }).from(review).where(eq(review.id, reviewId)).get()
  if (!existing) return false
  tx.update(review)
    .set({
      preliminaryVerdict: input.verdict,
      preliminaryReason: input.reason.slice(0, 2000),
      preliminaryAt: input.at,
    })
    .where(eq(review.id, reviewId))
    .run()
  return true
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

/** 计划应用时取回原始用户消息，避免把计划文本再塞进 action payload。 */
export function getSupervisorMessageByTrigger(
  db: Db,
  threadId: string,
  triggerId: string,
): { content: string } | null {
  const row = db
    .select({ content: supervisorMessage.content })
    .from(supervisorMessage)
    .where(
      and(eq(supervisorMessage.threadId, threadId), eq(supervisorMessage.triggerId, triggerId)),
    )
    .get()
  return row ?? null
}
