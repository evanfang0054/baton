import type { ReviewView, TaskAcceptanceSummary } from '@baton/protocol'

/** 通过验收是否必须填写理由：verify 未通过，或验收项缺失/未过/待验。 */
export function needsAcceptanceOverride(
  review: Pick<ReviewView, 'verifyExitCode'>,
  acceptance: TaskAcceptanceSummary | null,
): boolean {
  const acceptanceIssue =
    !acceptance ||
    acceptance.counts.total === 0 ||
    acceptance.counts.fail > 0 ||
    acceptance.counts.pending > 0
  return review.verifyExitCode !== 0 || acceptanceIssue
}
