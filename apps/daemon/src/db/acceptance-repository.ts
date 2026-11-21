import {
  AcceptanceContract,
  AcceptanceItem,
  AcceptanceRun,
  TaskAcceptanceSummary,
  type AcceptanceVerdict,
} from '@baton/protocol'
import { acceptanceSummary, validateAcceptanceUpdate } from '@baton/core'
import { desc, eq, inArray } from 'drizzle-orm'
import { acceptanceContract, acceptanceItem, acceptanceRun } from './schema.js'
import type { Db, Tx } from './types.js'

function toContract(row: typeof acceptanceContract.$inferSelect): AcceptanceContract {
  return AcceptanceContract.parse({
    id: row.id,
    taskId: row.taskId,
    version: row.version,
    status: row.status,
    createdBy: row.createdBy,
    revision: row.revision,
    truncated: row.truncated,
    createdAt: row.createdAt,
    frozenAt: row.frozenAt ?? null,
  })
}

function toItem(row: typeof acceptanceItem.$inferSelect): AcceptanceItem {
  return AcceptanceItem.parse({
    id: row.id,
    contractId: row.contractId,
    ordinal: row.ordinal,
    text: row.text,
    status: row.status,
    evidence: row.evidence ?? null,
    source: row.source,
    updatedAt: row.updatedAt,
  })
}

function toRun(row: typeof acceptanceRun.$inferSelect): AcceptanceRun {
  return AcceptanceRun.parse({
    id: row.id,
    taskId: row.taskId,
    contractId: row.contractId,
    reviewId: row.reviewId,
    verifierTaskId: row.verifierTaskId ?? null,
    status: row.status,
    verdict: row.verdict ?? null,
    summary: row.summary ?? null,
    createdAt: row.createdAt,
    completedAt: row.completedAt ?? null,
  })
}

export function insertAcceptanceContract(tx: Tx, input: AcceptanceContract): void {
  tx.insert(acceptanceContract)
    .values({
      id: input.id,
      taskId: input.taskId,
      version: input.version,
      status: input.status,
      createdBy: input.createdBy,
      revision: input.revision,
      truncated: input.truncated,
      createdAt: input.createdAt,
      frozenAt: input.frozenAt,
    })
    .run()
}

export function insertAcceptanceItems(tx: Tx, items: AcceptanceItem[]): void {
  if (items.length === 0) return
  tx.insert(acceptanceItem)
    .values(
      items.map((item) => ({
        id: item.id,
        contractId: item.contractId,
        ordinal: item.ordinal,
        text: item.text,
        status: item.status,
        evidence: item.evidence,
        source: item.source,
        updatedAt: item.updatedAt,
      })),
    )
    .run()
}

export function insertAcceptanceRun(tx: Tx, input: AcceptanceRun): void {
  tx.insert(acceptanceRun)
    .values({
      id: input.id,
      taskId: input.taskId,
      contractId: input.contractId,
      reviewId: input.reviewId,
      verifierTaskId: input.verifierTaskId,
      status: input.status,
      verdict: input.verdict,
      summary: input.summary,
      createdAt: input.createdAt,
      completedAt: input.completedAt,
    })
    .run()
}

export function getLatestAcceptanceContract(
  db: Pick<Db, 'select'>,
  taskId: string,
): AcceptanceContract | null {
  const row = db
    .select()
    .from(acceptanceContract)
    .where(eq(acceptanceContract.taskId, taskId))
    .orderBy(desc(acceptanceContract.version))
    .limit(1)
    .get()
  return row ? toContract(row) : null
}

export function getLatestFrozenAcceptanceContract(
  db: Pick<Db, 'select'>,
  taskId: string,
): AcceptanceContract | null {
  const row = db
    .select()
    .from(acceptanceContract)
    .where(eq(acceptanceContract.taskId, taskId))
    .orderBy(desc(acceptanceContract.version))
    .all()
    .find((candidate) => candidate.status === 'frozen')
  return row ? toContract(row) : null
}

export function getAcceptanceItems(db: Pick<Db, 'select'>, contractId: string): AcceptanceItem[] {
  return db
    .select()
    .from(acceptanceItem)
    .where(eq(acceptanceItem.contractId, contractId))
    .orderBy(acceptanceItem.ordinal)
    .all()
    .map(toItem)
}

export function getAcceptanceRunByContract(
  db: Pick<Db, 'select'>,
  contractId: string,
): AcceptanceRun | null {
  const row = db
    .select()
    .from(acceptanceRun)
    .where(eq(acceptanceRun.contractId, contractId))
    .orderBy(desc(acceptanceRun.createdAt))
    .limit(1)
    .get()
  return row ? toRun(row) : null
}

export interface AcceptanceBundle {
  contract: AcceptanceContract
  items: AcceptanceItem[]
  run: AcceptanceRun | null
}

export function getAcceptanceBundle(
  db: Pick<Db, 'select'>,
  taskId: string,
): AcceptanceBundle | null {
  const contract = getLatestAcceptanceContract(db, taskId)
  if (!contract) return null
  return {
    contract,
    items: getAcceptanceItems(db, contract.id),
    run: getAcceptanceRunByContract(db, contract.id),
  }
}

export function listAcceptanceSummaries(
  db: Pick<Db, 'select'>,
  taskIds: string[],
): Map<string, TaskAcceptanceSummary> {
  const result = new Map<string, TaskAcceptanceSummary>()
  if (taskIds.length === 0) return result

  const contracts = db
    .select()
    .from(acceptanceContract)
    .where(inArray(acceptanceContract.taskId, taskIds))
    .orderBy(desc(acceptanceContract.version))
    .all()
  const latestByTask = new Map<string, (typeof contracts)[number]>()
  for (const contract of contracts) {
    if (!latestByTask.has(contract.taskId)) latestByTask.set(contract.taskId, contract)
  }
  if (latestByTask.size === 0) return result

  const contractIds = [...latestByTask.values()].map((contract) => contract.id)
  const items = db
    .select()
    .from(acceptanceItem)
    .where(inArray(acceptanceItem.contractId, contractIds))
    .orderBy(acceptanceItem.ordinal)
    .all()
  const itemsByContract = new Map<string, AcceptanceItem[]>()
  for (const row of items) {
    const list = itemsByContract.get(row.contractId) ?? []
    list.push(toItem(row))
    itemsByContract.set(row.contractId, list)
  }

  for (const [taskId, contract] of latestByTask) {
    const contractItems = itemsByContract.get(contract.id) ?? []
    const { counts, verdict } = acceptanceSummary(contractItems)
    result.set(
      taskId,
      TaskAcceptanceSummary.parse({
        contractId: contract.id,
        version: contract.version,
        revision: contract.revision,
        status: contract.status,
        counts,
        verdict,
        topFailures: contractItems
          .filter((item) => item.status === 'fail' || item.status === 'pending')
          .slice(0, 3)
          .map((item) => ({ text: item.text, evidence: item.evidence })),
      }),
    )
  }
  return result
}

export type ReplaceAcceptanceItemsResult =
  | { ok: true; revision: number }
  | {
      ok: false
      code:
        | 'not_found'
        | 'invalid_state'
        | 'revision_conflict'
        | 'too_many_items'
        | 'empty_text'
        | 'text_too_long'
        | 'evidence_too_long'
        | 'total_too_long'
        | 'invalid_status'
      message: string
      index?: number
    }

export function replaceAcceptanceItems(
  tx: Tx,
  input: {
    contractId: string
    expectedRevision: number
    items: AcceptanceItem[]
  },
): ReplaceAcceptanceItemsResult {
  const contract = tx
    .select()
    .from(acceptanceContract)
    .where(eq(acceptanceContract.id, input.contractId))
    .get()
  if (!contract) {
    return { ok: false, code: 'not_found', message: '验收合同不存在' }
  }
  if (contract.status !== 'draft') {
    return { ok: false, code: 'invalid_state', message: '验收清单已冻结，不能修改' }
  }

  const validation = validateAcceptanceUpdate({
    items: input.items.map((item) => ({
      text: item.text,
      status: item.status,
      evidence: item.evidence,
    })),
    expectedRevision: input.expectedRevision,
    currentRevision: contract.revision,
  })
  if (!validation.ok) return validation

  tx.delete(acceptanceItem).where(eq(acceptanceItem.contractId, input.contractId)).run()
  insertAcceptanceItems(
    tx,
    input.items.map((item, index) => ({
      ...item,
      contractId: input.contractId,
      ordinal: index + 1,
    })),
  )
  const revision = contract.revision + 1
  tx.update(acceptanceContract)
    .set({ revision })
    .where(eq(acceptanceContract.id, input.contractId))
    .run()
  return { ok: true, revision }
}

export function freezeAcceptanceContract(tx: Tx, contractId: string, at: number): void {
  tx.update(acceptanceContract)
    .set({ status: 'frozen', frozenAt: at })
    .where(eq(acceptanceContract.id, contractId))
    .run()
}

export function updateAcceptanceRun(
  tx: Tx,
  id: string,
  patch: {
    status?: string
    verdict?: AcceptanceVerdict | null
    summary?: string | null
    verifierTaskId?: string | null
    completedAt?: number | null
  },
): void {
  tx.update(acceptanceRun)
    .set({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.verdict !== undefined ? { verdict: patch.verdict } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.verifierTaskId !== undefined ? { verifierTaskId: patch.verifierTaskId } : {}),
      ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
    })
    .where(eq(acceptanceRun.id, id))
    .run()
}

export type { AcceptanceVerdict }
