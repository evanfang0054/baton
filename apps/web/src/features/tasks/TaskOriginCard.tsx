import type { TaskOrigin } from '@baton/protocol'

const sourceLabels: Record<TaskOrigin['source'], string> = {
  'supervisor-chat': '总管对话',
  'supervisor-review': '总管验收员',
  canvas: '画布',
  github: 'GitHub',
  feishu: '飞书',
}

export function TaskOriginCard({
  origin,
  invalid,
}: {
  origin: TaskOrigin | null
  invalid: boolean
}) {
  if (!origin) {
    return invalid ? (
      <div
        role="alert"
        className="rounded-lg border border-warning bg-warning/10 p-3 text-xs text-warning"
      >
        来源信息损坏，已忽略。
      </div>
    ) : null
  }

  return (
    <section className="shrink-0 rounded-lg border border-separator bg-background p-3">
      <h3 className="text-xs font-medium text-muted">来源</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">渠道</dt>
        <dd className="text-foreground">{sourceLabels[origin.source]}</dd>
        <dt className="text-muted">触发 ID</dt>
        <dd className="break-all font-mono text-muted" title={origin.triggerId}>
          {origin.triggerId}
        </dd>
        <dt className="text-muted">策略版本</dt>
        <dd className="break-all font-mono text-muted" title={origin.policyVersion}>
          {origin.policyVersion}
        </dd>
        <dt className="text-muted">提示词版本</dt>
        <dd className="break-all font-mono text-muted" title={origin.promptVersion}>
          {origin.promptVersion}
        </dd>
        {origin.strength ? (
          <>
            <dt className="text-muted">授权强度</dt>
            <dd className="text-foreground">
              {origin.strength === 'explicit' ? '明确授权' : '推断授权'}
            </dd>
          </>
        ) : null}
        {origin.allowedActions?.length ? (
          <>
            <dt className="text-muted">允许动作</dt>
            <dd className="text-foreground">{origin.allowedActions.join('、')}</dd>
          </>
        ) : null}
        {origin.mandateVersion ? (
          <>
            <dt className="text-muted">授权版本</dt>
            <dd className="break-all font-mono text-muted" title={origin.mandateVersion}>
              {origin.mandateVersion}
            </dd>
          </>
        ) : null}
        {origin.reviewOfTaskId ? (
          <>
            <dt className="text-muted">验收对象</dt>
            <dd className="break-all font-mono text-muted" title={origin.reviewOfTaskId}>
              {origin.reviewOfTaskId}
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  )
}
