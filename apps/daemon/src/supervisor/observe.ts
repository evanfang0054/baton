import { parsePreliminaryVerdict } from '@baton/core'
import { VERIFY_SKIPPED, type DiffStat } from '@baton/protocol'
import { xmlEscape } from './xml.js'

export type Verdict = 'pass' | 'fail' | 'unknown'

export interface ParsedVerdict {
  verdict: Verdict
  reason: string
}

/** 兼容旧调用点；纯解析逻辑已下沉到 core/review。 */
export const parseVerdict = parsePreliminaryVerdict

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
  const title = xmlEscape(input.title)
  const targetPrompt = xmlEscape(input.prompt.slice(0, 2000))
  const workerOutput = xmlEscape(input.workerOutput.slice(-4000) || '（没有文本输出）')
  return `<role>你是 baton 的验收员。你只验收，不实现、不修改文件、不提交代码。</role>
<verdict_protocol>
结束前必须单独发送一条消息，内容只能是下面两行之一，不能有任何其他文字、标点或代码块：
VERDICT: PASS
VERDICT: FAIL
理由放在这条消息之前。上报 session outcome 时，reason 也必须以 VERDICT: PASS 或 VERDICT: FAIL 开头。
没有这一行，系统会视为初步验收未完成，目标任务仍等你决定。
</verdict_protocol>
<target_task id="${xmlEscape(input.taskId)}" title="${title}">
${targetPrompt}
</target_task>
<evidence>
verify 退出码：${
    input.verifyExitCode === VERIFY_SKIPPED
      ? '未执行（工作区未配置 verify 命令）'
      : (input.verifyExitCode ?? '未执行')
  }
diff：${diffLine(input.diffStat)}
工人最后回复（截断）：
${workerOutput}
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
