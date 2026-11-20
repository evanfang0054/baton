import type { DiffStat } from '@baton/protocol'

export type Verdict = 'pass' | 'fail' | 'unknown'

export interface ParsedVerdict {
  verdict: Verdict
  reason: string
}

/**
 * 验收员必须在最后一行输出 VERDICT: PASS/FAIL。
 * 取最后一次出现，避免模型在思考过程中复述格式导致误判。
 * 模型偶尔只在 report_outcome 的 reason 里下结论，所以第二参数也参与判定。
 */
export function parseVerdict(text: string, outcomeReason?: string | null): ParsedVerdict {
  const combined = `${text}\n${outcomeReason ?? ''}`
  if (!combined.trim()) return { verdict: 'unknown', reason: '验收员没有返回文本结论' }
  const pattern = /VERDICT\s*[：:]\s*(PASS|FAIL)/gi
  let last: RegExpExecArray | null = null
  let match: RegExpExecArray | null
  while ((match = pattern.exec(combined)) !== null) last = match
  const reason = combined
    .replace(/VERDICT\s*[：:]\s*(PASS|FAIL)/gi, '')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-6)
    .join('\n')
    .slice(-900)
  if (last) {
    return { verdict: last[1]?.toUpperCase() === 'PASS' ? 'pass' : 'fail', reason }
  }

  // 兜底：只看 outcome reason，避免把普通正文里的“通过”误当验收结论。
  if (outcomeReason?.trim()) {
    const outcome = outcomeReason.trim()
    const negative =
      /不满足|未满足|不符合|未通过|没有通过|失败|需(要)?修改|存在问题|无法确认|未完成|缺少/.test(
        outcome,
      )
    const positive = /满足|符合|通过|已完成|完成要求|核对无误|正确|没有问题/.test(outcome)
    if (negative) return { verdict: 'fail', reason: outcome.slice(-900) }
    if (positive) return { verdict: 'pass', reason: outcome.slice(-900) }
  }
  return { verdict: 'unknown', reason: reason || '验收员没有给出明确结论' }
}

export interface VerifierPromptInput {
  title: string
  taskId: string
  prompt: string
  workerOutput: string
  verifyExitCode: number | null
  diffStat: DiffStat | null
  /** worktree 任务的验收员直接运行在目标的隔离 worktree 中。 */
  isolatedWorktree?: boolean
}

function diffLine(diffStat: DiffStat | null): string {
  return diffStat
    ? `${diffStat.filesChanged} 个文件，+${diffStat.insertions}/-${diffStat.deletions}`
    : '没有 diff 快照'
}

/** 验收员只做检查；总管只拿结论，不直接读代码或日志。 */
export function buildVerifierPrompt(input: VerifierPromptInput): string {
  const workspaceNote = input.isolatedWorktree
    ? '\n<workspace_note>你运行在目标任务的隔离 worktree 中，直接检查当前目录即可；不要切换目录。</workspace_note>'
    : ''
  return `<role>你是 baton 的验收员。你只验收，不实现、不修改文件、不提交代码。</role>
<verdict_protocol>
结束前必须单独发送一条消息，内容只能是下面两行之一，不能有任何其他文字、标点或代码块：
VERDICT: PASS
VERDICT: FAIL
理由放在这条消息之前。上报 session outcome 时，reason 也必须以 VERDICT: PASS 或 VERDICT: FAIL 开头。
没有这一行，系统会视为验收未完成，目标任务不会自动通过。
</verdict_protocol>
<target_task id="${input.taskId}" title="${input.title}">
${input.prompt.slice(0, 2000)}
</target_task>
<evidence>
verify 退出码：${input.verifyExitCode ?? '未执行'}
diff：${diffLine(input.diffStat)}
工人最后回复（截断）：
${input.workerOutput.slice(-4000) || '（没有文本输出）'}
</evidence>${workspaceNote}
<instructions>
1. 用 git status / git diff 检查实际改动（如果有），核对是否满足原始要求。
2. 只运行只读校验命令（如测试、构建、lint）；不要安装依赖，不要改文件，不要 git commit。
3. 如果任务只产出资料而没有代码改动，就核对工人回复是否覆盖要求。
4. 得出结论后，先写最多 5 行理由，再发送只含 VERDICT 行的最后一条消息。
5. 不要创建任务、不要联系总管、不要输出 Markdown 代码块。
</instructions>
最后提醒：你的最后一条消息必须只有一行：VERDICT: PASS 或 VERDICT: FAIL。不要输出其他内容。`
}
