import type { DiffFile, DiffStat, SessionOutcome, TaskStatus } from '@baton/protocol'

export type HandoffFile = Pick<DiffFile, 'path' | 'status' | 'insertions' | 'deletions'>

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
  /** 已知的 workspace 绝对路径；输出时替换为 <workspace>。 */
  redactPaths: string[]
  /** 已知的 worktree 绝对路径；输出时替换为 <worktree>。 */
  worktreePaths?: string[]
}

export type HandoffDropped = 'goal' | 'reply' | 'files' | 'total'

export interface HandoffSummary {
  content: string
  truncated: boolean
  dropped: HandoffDropped[]
  warnings: string[]
}
