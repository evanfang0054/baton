import type {
  AcceptanceContract,
  AcceptanceItem,
  AcceptanceReportFacts,
  AcceptanceRun,
  Review,
  Task,
} from '@baton/protocol'
import { VERIFY_SKIPPED } from '@baton/protocol'
import { stableStringify } from '../policy/match.js'
import { acceptanceSummary } from './summary.js'

export interface BuildAcceptanceReportInput {
  task: Pick<Task, 'id' | 'title' | 'workspaceMode' | 'worktreePath'>
  contract: Pick<AcceptanceContract, 'id' | 'version' | 'revision'>
  items: AcceptanceItem[]
  run: Pick<AcceptanceRun, 'status' | 'verdict' | 'summary'> | null
  review: Pick<Review, 'verifyExitCode' | 'verifyOutput' | 'diffStat' | 'preliminaryReason'> | null
  changedFiles?: string[]
  verifyCommand: string | null
  workspaceRoot?: string
}

export interface AcceptanceReportResult {
  report: AcceptanceReportFacts
  canonical: string
}

const MAX_OUTPUT_SUMMARY = 2000
const MAX_FILES = 20
const MAX_RESULT = 1000

export function buildAcceptanceReport(input: BuildAcceptanceReportInput): AcceptanceReportResult {
  const { counts, verdict } = acceptanceSummary(input.items)
  const output = sanitizeText(input.review?.verifyOutput ?? '', input.workspaceRoot)
  const outputSummary =
    output.length > MAX_OUTPUT_SUMMARY
      ? `${output.slice(0, MAX_OUTPUT_SUMMARY)}…（已截断）`
      : output
  const verifyExitCode = input.review?.verifyExitCode ?? null
  const verifySkipped = verifyExitCode === VERIFY_SKIPPED
  const result = truncate(
    input.run?.summary ?? input.review?.preliminaryReason ?? '未生成',
    MAX_RESULT,
  )
  const files = (input.changedFiles ?? [])
    .slice(0, MAX_FILES)
    .map((file) => relativizePath(file, input.workspaceRoot))

  const risks: string[] = []
  if (verifySkipped) risks.push('未执行自动校验')
  if (counts.fail > 0) risks.push(`${counts.fail} 条验收未通过`)
  if (counts.pending > 0) risks.push(`${counts.pending} 条验收未完成`)
  if (input.task.workspaceMode === 'worktree') risks.push('在 worktree 中执行')
  if (input.run?.status === 'failed') risks.push('初步验收未完成')

  const unverified: string[] = []
  if (verifySkipped) unverified.push('自动校验未执行')
  for (const item of input.items) {
    if (item.status === 'pending') unverified.push(item.text)
    if (item.status === 'fail') unverified.push(item.text)
  }

  const report: AcceptanceReportFacts = {
    taskId: input.task.id,
    contractId: input.contract.id,
    contractVersion: input.contract.version,
    contractRevision: input.contract.revision,
    goal: input.task.title,
    result,
    changes: {
      filesChanged: input.review?.diffStat?.filesChanged ?? 0,
      insertions: input.review?.diffStat?.insertions ?? 0,
      deletions: input.review?.diffStat?.deletions ?? 0,
      files,
    },
    verify: {
      command: input.verifyCommand,
      exitCode: verifyExitCode,
      outputSummary,
      skipped: verifySkipped,
    },
    acceptance: { items: input.items, counts, verdict },
    risks,
    unverified,
    preliminary: {
      verdict: input.run?.verdict ?? null,
      summary: input.run?.summary ?? null,
    },
  }

  return { report, canonical: stableStringify(report) }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function sanitizeText(value: string, workspaceRoot?: string): string {
  const masked = workspaceRoot ? value.split(workspaceRoot).join('<workspace>') : value
  // 报告里不允许出现本机绝对路径；根未知或越界的一律遮蔽。
  // 只匹配行首或空白/引号/等号后的路径，避免破坏 URL（`https://`）。
  return masked.replace(/(^|[\s("'=])(\/[^\s"'`]+)/g, '$1<external>')
}

function relativizePath(value: string, workspaceRoot?: string): string {
  if (!value) return value
  if (!value.startsWith('/')) return value
  // 根未知时也不能把本机绝对路径写进报告。
  if (!workspaceRoot) return '<external>'
  const root = workspaceRoot.endsWith('/') ? workspaceRoot.slice(0, -1) : workspaceRoot
  if (value === root) return '<workspace>'
  if (value.startsWith(`${root}/`)) return value.slice(root.length + 1)
  return '<external>'
}
