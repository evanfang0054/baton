import type { Approval, RiskLevel } from '@baton/protocol'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { useCommandAction } from './useCommandAction'
import { codeBlockClass } from './styles'

export const riskLabel: Record<RiskLevel, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
}

export const riskColor: Record<RiskLevel, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
}

export function ApprovalCard({
  approval,
  onDone,
}: {
  approval: Approval
  onDone: () => Promise<void> | void
}) {
  const action = useCommandAction(onDone)
  const input =
    approval.request.input === undefined ? '' : JSON.stringify(approval.request.input, null, 2)

  return (
    <section className="shrink-0 rounded-lg border border-warning border-l-2 bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">需要授权</h3>
        <Chip size="sm" variant="soft" color={riskColor[approval.request.risk]}>
          {riskLabel[approval.request.risk]}
        </Chip>
      </div>
      <p className="mt-2 text-xs text-muted">工具</p>
      <p className="font-mono text-xs text-foreground">{approval.request.toolName}</p>
      {input ? <pre className={codeBlockClass}>{input}</pre> : null}
      {approval.request.reason ? (
        <p className="mt-2 text-xs text-muted">{approval.request.reason}</p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="danger"
          isDisabled={action.pending}
          onPress={() =>
            action.run({
              type: 'approval.decide',
              payload: { approvalId: approval.id, decision: 'deny' },
            })
          }
        >
          拒绝
        </Button>
        <Button
          variant={approval.request.risk === 'high' ? 'secondary' : 'primary'}
          isDisabled={action.pending}
          onPress={() =>
            action.run({
              type: 'approval.decide',
              payload: { approvalId: approval.id, decision: 'allow' },
            })
          }
        >
          允许
        </Button>
      </div>
      {action.error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {action.error}
        </p>
      ) : null}
    </section>
  )
}
