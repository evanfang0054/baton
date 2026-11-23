import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const AcceptanceItemStatus = z.enum(['pending', 'pass', 'fail', 'waived'])
export type AcceptanceItemStatus = z.infer<typeof AcceptanceItemStatus>

export const AcceptanceVerdict = z.enum(['pass', 'fail', 'incomplete'])
export type AcceptanceVerdict = z.infer<typeof AcceptanceVerdict>

export const AcceptanceContractStatus = z.enum(['draft', 'frozen'])
export type AcceptanceContractStatus = z.infer<typeof AcceptanceContractStatus>

export const AcceptanceRunStatus = z.enum(['running', 'complete', 'failed'])
export type AcceptanceRunStatus = z.infer<typeof AcceptanceRunStatus>

export const AcceptanceContract = z.object({
  id: Id,
  taskId: Id,
  version: z.number().int().positive(),
  status: AcceptanceContractStatus,
  createdBy: z.enum(['verifier', 'human']),
  revision: z.number().int().nonnegative(),
  truncated: z.boolean(),
  createdAt: Timestamp,
  frozenAt: Timestamp.nullable(),
})
export type AcceptanceContract = z.infer<typeof AcceptanceContract>

export const AcceptanceItem = z.object({
  id: Id,
  contractId: Id,
  ordinal: z.number().int().positive(),
  text: z.string().min(1).max(200),
  status: AcceptanceItemStatus,
  evidence: z.string().max(200).nullable(),
  source: z.enum(['verifier', 'human']),
  updatedAt: Timestamp,
})
export type AcceptanceItem = z.infer<typeof AcceptanceItem>

/** 一次合同最多 8 条；0 条表示无法生成或人主动清空。 */
export const AcceptanceItems = z.array(AcceptanceItem).max(8)
export type AcceptanceItems = z.infer<typeof AcceptanceItems>

export const AcceptanceRun = z.object({
  id: Id,
  taskId: Id,
  contractId: Id,
  reviewId: Id,
  verifierTaskId: Id.nullable(),
  status: AcceptanceRunStatus,
  verdict: AcceptanceVerdict.nullable(),
  summary: z.string().max(1000).nullable(),
  createdAt: Timestamp,
  completedAt: Timestamp.nullable(),
})
export type AcceptanceRun = z.infer<typeof AcceptanceRun>

export const AcceptanceCounts = z.object({
  total: z.number().int().nonnegative(),
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  waived: z.number().int().nonnegative(),
})
export type AcceptanceCounts = z.infer<typeof AcceptanceCounts>

export const AcceptanceFailure = z.object({
  text: z.string(),
  evidence: z.string().nullable(),
})
export type AcceptanceFailure = z.infer<typeof AcceptanceFailure>

export const TaskAcceptanceSummary = z.object({
  contractId: Id,
  version: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  status: AcceptanceContractStatus,
  counts: AcceptanceCounts,
  verdict: AcceptanceVerdict,
  topFailures: z.array(AcceptanceFailure).max(3),
})
export type TaskAcceptanceSummary = z.infer<typeof TaskAcceptanceSummary>

const ReportChanges = z.object({
  filesChanged: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  files: z.array(z.string()),
})

const ReportVerify = z.object({
  command: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  outputSummary: z.string(),
  skipped: z.boolean(),
})

const ReportPreliminary = z.object({
  verdict: AcceptanceVerdict.nullable(),
  summary: z.string().nullable(),
})

export const AcceptanceReportFacts = z.object({
  taskId: Id,
  contractId: Id,
  contractVersion: z.number().int().positive(),
  contractRevision: z.number().int().nonnegative(),
  goal: z.string(),
  result: z.string(),
  changes: ReportChanges,
  verify: ReportVerify,
  acceptance: z.object({
    items: AcceptanceItems,
    counts: AcceptanceCounts,
    verdict: AcceptanceVerdict,
  }),
  risks: z.array(z.string()),
  unverified: z.array(z.string()),
  preliminary: ReportPreliminary,
})
export type AcceptanceReportFacts = z.infer<typeof AcceptanceReportFacts>

export const AcceptanceReport = AcceptanceReportFacts.extend({
  hash: z.string(),
})
export type AcceptanceReport = z.infer<typeof AcceptanceReport>
