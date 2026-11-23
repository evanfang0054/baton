import { createHash } from 'node:crypto'
import { buildAcceptanceReport } from '@baton/core'
import type {
  AcceptanceContract,
  AcceptanceItem,
  AcceptanceReport,
  AcceptanceRun,
  Task,
} from '@baton/protocol'
import type { Config } from '../config.js'
import { getAcceptanceBundle } from '../db/acceptance-repository.js'
import { getReviewByTask, getReviewDiff, getWorkspace } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'

export interface AcceptanceResponse {
  contract: AcceptanceContract
  items: AcceptanceItem[]
  run: AcceptanceRun | null
  report: AcceptanceReport
}

export function getAcceptanceResponse(
  db: Db,
  task: Task,
  config: Pick<Config, 'workspacesRoot'>,
): AcceptanceResponse | null {
  const bundle = getAcceptanceBundle(db, task.id)
  if (!bundle) return null
  const review = getReviewByTask(db, task.id)
  const diff = review ? getReviewDiff(db, review.id) : null
  const root = workspaceRoot(db, task, config)

  const { report, canonical } = buildAcceptanceReport({
    task: {
      id: task.id,
      title: task.title,
      workspaceMode: task.workspaceMode,
      worktreePath: task.worktreePath,
    },
    contract: {
      id: bundle.contract.id,
      version: bundle.contract.version,
      revision: bundle.contract.revision,
    },
    items: bundle.items,
    run: bundle.run,
    review: review
      ? {
          verifyExitCode: review.verifyExitCode,
          verifyOutput: review.verifyOutput,
          diffStat: review.diffStat,
          preliminaryReason: review.preliminaryReason,
        }
      : null,
    changedFiles: diff?.files.map((file) => file.path) ?? [],
    verifyCommand: task.verifyCommand,
    ...(root ? { workspaceRoot: root } : {}),
  })
  const hash = createHash('sha256').update(canonical).digest('hex')
  return {
    contract: bundle.contract,
    items: bundle.items,
    run: bundle.run,
    report: { ...report, hash },
  }
}

function workspaceRoot(
  db: Db,
  task: Task,
  config: Pick<Config, 'workspacesRoot'>,
): string | undefined {
  if (task.worktreePath) return task.worktreePath
  try {
    const workspace = getWorkspace(db, task.workspaceId)
    if (!workspace) return undefined
    return resolveWorkspaceDir(config.workspacesRoot, workspace.relPath)
  } catch {
    return undefined
  }
}
