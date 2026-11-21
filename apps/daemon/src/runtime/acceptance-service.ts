import type { AcceptanceContract, AcceptanceItem, AcceptanceRun, Task } from '@baton/protocol'
import { cloneAcceptanceItems } from '@baton/core'
import {
  getAcceptanceItems,
  getLatestFrozenAcceptanceContract,
  insertAcceptanceContract,
  insertAcceptanceItems,
  insertAcceptanceRun,
} from '../db/acceptance-repository.js'
import type { Tx } from '../db/types.js'

export interface EnsureAcceptanceForReviewInput {
  task: Pick<Task, 'id'>
  reviewId: string
  now: number
  newId: () => string
}

export interface EnsureAcceptanceForReviewResult {
  contractId: string
  runId: string
  version: number
}

export function ensureAcceptanceForReview(
  tx: Tx,
  input: EnsureAcceptanceForReviewInput,
): EnsureAcceptanceForReviewResult {
  const previous = getLatestFrozenAcceptanceContract(tx, input.task.id)
  const previousItems = previous ? getAcceptanceItems(tx, previous.id) : []
  const version = previous ? previous.version + 1 : 1
  const contractId = input.newId()

  const contract: AcceptanceContract = {
    id: contractId,
    taskId: input.task.id,
    version,
    status: 'draft',
    createdBy: 'verifier',
    revision: 0,
    truncated: false,
    createdAt: input.now,
    frozenAt: null,
  }
  insertAcceptanceContract(tx, contract)

  const items: AcceptanceItem[] = cloneAcceptanceItems(previousItems).map((item) => ({
    id: input.newId(),
    contractId,
    ordinal: item.ordinal,
    text: item.text,
    status: item.status,
    evidence: item.evidence,
    source: item.source,
    updatedAt: input.now,
  }))
  insertAcceptanceItems(tx, items)

  const runId = input.newId()
  const run: AcceptanceRun = {
    id: runId,
    taskId: input.task.id,
    contractId,
    reviewId: input.reviewId,
    verifierTaskId: null,
    status: 'running',
    verdict: null,
    summary: null,
    createdAt: input.now,
    completedAt: null,
  }
  insertAcceptanceRun(tx, run)

  return { contractId, runId, version }
}
