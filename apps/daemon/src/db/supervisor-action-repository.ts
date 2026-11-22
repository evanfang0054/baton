import { and, desc, eq, lt, lte, ne, or } from 'drizzle-orm'
import { SupervisorAction } from '@baton/protocol'
import { supervisorAction } from './schema.js'
import type { Db, Tx } from './types.js'

function toAction(row: typeof supervisorAction.$inferSelect): SupervisorAction {
  return SupervisorAction.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    threadId: row.threadId,
    taskId: row.taskId,
    kind: row.kind,
    status: row.status,
    strength: row.strength,
    mode: row.mode,
    reason: row.reason,
    payload: JSON.parse(row.payloadJson) as unknown,
    result: row.resultJson ? (JSON.parse(row.resultJson) as unknown) : null,
    policyVersion: row.policyVersion,
    mandateVersion: row.mandateVersion,
    dedupeKey: row.dedupeKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    appliedAt: row.appliedAt,
    ignoredAt: row.ignoredAt,
  })
}

export function insertAction(tx: Tx, action: SupervisorAction): void {
  tx.insert(supervisorAction)
    .values({
      id: action.id,
      workspaceId: action.workspaceId,
      threadId: action.threadId,
      taskId: action.taskId,
      kind: action.kind,
      status: action.status,
      strength: action.strength,
      mode: action.mode,
      reason: action.reason,
      payloadJson: JSON.stringify(action.payload),
      resultJson: action.result === null ? null : JSON.stringify(action.result),
      policyVersion: action.policyVersion,
      mandateVersion: action.mandateVersion,
      dedupeKey: action.dedupeKey,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      expiresAt: action.expiresAt,
      appliedAt: action.appliedAt,
      ignoredAt: action.ignoredAt,
    })
    .run()
}

export function getActionRow(db: Db, id: string): SupervisorAction | null {
  const row = db.select().from(supervisorAction).where(eq(supervisorAction.id, id)).get()
  return row ? toAction(row) : null
}

export function findActionByDedupeKey(db: Db, key: string): SupervisorAction | null {
  const row = db.select().from(supervisorAction).where(eq(supervisorAction.dedupeKey, key)).get()
  return row ? toAction(row) : null
}

export function listActionRows(
  db: Db,
  input: { workspaceId: string; status?: string; limit?: number },
): SupervisorAction[] {
  const where = input.status
    ? and(
        eq(supervisorAction.workspaceId, input.workspaceId),
        eq(supervisorAction.status, input.status),
      )
    : eq(supervisorAction.workspaceId, input.workspaceId)
  return db
    .select()
    .from(supervisorAction)
    .where(where)
    .orderBy(desc(supervisorAction.createdAt))
    .limit(input.limit ?? 20)
    .all()
    .map(toAction)
}

export function listExpiredProposed(db: Db, now: number): SupervisorAction[] {
  return db
    .select()
    .from(supervisorAction)
    .where(and(eq(supervisorAction.status, 'proposed'), lte(supervisorAction.expiresAt, now)))
    .all()
    .map(toAction)
}

export function deleteActionsBefore(
  db: Db,
  proposedBefore: number,
  terminalBefore: number,
): number {
  return db
    .delete(supervisorAction)
    .where(
      or(
        and(
          eq(supervisorAction.status, 'proposed'),
          lt(supervisorAction.createdAt, proposedBefore),
        ),
        and(
          ne(supervisorAction.status, 'proposed'),
          lt(supervisorAction.updatedAt, terminalBefore),
        ),
      ),
    )
    .run().changes
}
