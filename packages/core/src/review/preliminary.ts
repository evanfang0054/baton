import type { PreliminaryVerdict } from '@baton/protocol'

export type { PreliminaryVerdict }

export interface ParsedPreliminary {
  verdict: PreliminaryVerdict
  reason: string
}

/**
 * 验收员必须在最后一行输出 VERDICT: PASS/FAIL。
 * 取最后一次出现，避免模型在思考过程中复述格式导致误判。
 * 模型偶尔只在 report_outcome 的 reason 里下结论，所以第二参数也参与判定。
 */
export function parsePreliminaryVerdict(
  text: string,
  outcomeReason?: string | null,
): ParsedPreliminary {
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
