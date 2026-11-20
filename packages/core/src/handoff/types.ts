import type { DiffStat, SessionOutcome, TaskStatus } from '@baton/protocol'

export type HandoffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'binary'

export interface HandoffFile {
  path: string
  status: HandoffFileStatus
  insertions: number
  deletions: number
}

export interface HandoffInput {
  task: { id: string; title: string; status: TaskStatus }
  goal: string
  session: { outcome: SessionOutcome | null; failureReason: string | null }
  review: {
    verifyExitCode: number | null
    diffStat: DiffStat | null
    files: HandoffFile[]
  } | null
  artifact: { worktree: boolean; branch: string | null }
  lastReply: string | null
  /** 已知的 workspace/worktree 绝对路径；输出时替换为占位符。 */
  redactPaths: string[]
}

export type HandoffDropped = 'goal' | 'reply' | 'files' | 'total'

export interface HandoffSummary {
  content: string
  truncated: boolean
  dropped: HandoffDropped[]
  warnings: string[]
}
