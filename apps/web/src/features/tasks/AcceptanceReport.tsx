import type {
  AcceptanceItemStatus,
  AcceptanceReport as AcceptanceReportValue,
} from '@baton/protocol'
import { Button } from '@heroui/react/button'

const STATUS_MARKS: Record<AcceptanceItemStatus, string> = {
  pass: '✓ 通过',
  fail: '✗ 未过',
  pending: '○ 待验',
  waived: '— 豁免',
}

export function AcceptanceReport({
  report,
  onOpenDiff,
}: {
  report: AcceptanceReportValue
  onOpenDiff?: () => void
}) {
  const { acceptance, changes, verify } = report
  return (
    <section className="flex shrink-0 flex-col gap-3 rounded-lg border border-separator bg-surface p-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">验收报告</h3>
          <p className="mt-1 text-xs text-muted">{report.goal}</p>
        </div>
        <span className="rounded bg-background px-2 py-1 text-xs text-muted">
          v{report.contractVersion} · r{report.contractRevision}
        </span>
      </header>

      <section>
        <h4 className="text-xs font-medium text-foreground">结果</h4>
        <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{report.result}</p>
      </section>

      <section>
        <h4 className="text-xs font-medium text-foreground">改动</h4>
        <p className="mt-1 text-xs text-muted">
          {changes.filesChanged} 个文件 · +{changes.insertions} / -{changes.deletions}
        </p>
        {changes.files.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs text-muted">
            {changes.files.slice(0, 20).map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        ) : null}
        {onOpenDiff ? (
          <Button size="sm" variant="tertiary" className="mt-2" onPress={onOpenDiff}>
            查看改动
          </Button>
        ) : null}
      </section>

      <section>
        <h4 className="text-xs font-medium text-foreground">校验</h4>
        <p className="mt-1 text-xs text-muted">
          {verify.skipped
            ? '未执行自动校验'
            : `${verify.command ?? '未配置命令'} · 退出码 ${verify.exitCode ?? '—'}`}
        </p>
        {verify.outputSummary ? (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-xs text-muted">
            {verify.outputSummary}
          </pre>
        ) : null}
      </section>

      <section>
        <h4 className="text-xs font-medium text-foreground">
          验收 {acceptance.counts.pass}/{acceptance.counts.total}
        </h4>
        <ul className="mt-1 flex flex-col gap-1 text-xs">
          {acceptance.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-0.5">
              <span className={item.status === 'fail' ? 'text-danger' : 'text-muted'}>
                {STATUS_MARKS[item.status]} · {item.text}
              </span>
              {item.evidence ? (
                <span className="pl-4 font-mono text-muted">{item.evidence}</span>
              ) : null}
            </li>
          ))}
          {acceptance.items.length === 0 ? (
            <li className="text-muted">初步验收未完成，没有可展示的验收条目。</li>
          ) : null}
        </ul>
      </section>

      <section>
        <h4 className="text-xs font-medium text-foreground">风险与未验证</h4>
        {report.risks.length === 0 && report.unverified.length === 0 ? (
          <p className="mt-1 text-xs text-muted">无额外风险。</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
            {report.risks.map((risk) => (
              <li key={`risk-${risk}`} className="text-warning">
                {risk}
              </li>
            ))}
            {report.unverified.map((item) => (
              <li key={`unverified-${item}`}>未验证：{item}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4 className="text-xs font-medium text-foreground">初步结论</h4>
        <p className="mt-1 text-xs text-muted">
          {report.preliminary.verdict ?? '未完成'}
          {report.preliminary.summary ? ` · ${report.preliminary.summary}` : ''}
        </p>
      </section>

      <details className="text-xs text-muted">
        <summary className="cursor-pointer">审计</summary>
        <p className="mt-1 break-all font-mono">hash {report.hash}</p>
      </details>
    </section>
  )
}
