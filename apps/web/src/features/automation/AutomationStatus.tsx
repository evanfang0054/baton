import type { AutomationSummary } from '@baton/protocol'
import { Button } from '@heroui/react/button'

export function AutomationStatus({
  summary,
  onPause,
  onOpenSettings,
}: {
  summary: AutomationSummary | null
  onPause: () => void
  onOpenSettings: () => void
}) {
  if (!summary) {
    return (
      <div data-testid="automation-status" className="flex items-center gap-2">
        <span className="text-xs text-muted">自动化状态未知</span>
        <Button variant="secondary" onPress={onOpenSettings}>
          设置
        </Button>
      </div>
    )
  }
  const paused = summary.killSwitch
  // 有效自动化 = 策略开启 && 工作区已信任 && 未暂停；未信任时不能显示“运行中”。
  const running = summary.policy.autopilot.enabled && summary.trusted && !paused
  const label = paused ? '自动化已暂停' : running ? '自动化运行中' : '自动化关闭'
  const tone = paused ? 'text-warning' : running ? 'text-success' : 'text-muted'

  return (
    <div data-testid="automation-status" className="flex items-center gap-2">
      <span className={`text-xs font-medium ${tone}`}>{label}</span>
      {paused ? (
        <>
          {summary.killSwitchForced ? (
            <span className="text-xs text-muted">由环境变量强制暂停</span>
          ) : (
            <Button variant="secondary" onPress={onOpenSettings}>
              恢复
            </Button>
          )}
          <Button variant="tertiary" onPress={onOpenSettings}>
            设置
          </Button>
        </>
      ) : running ? (
        <>
          <Button variant="secondary" onPress={onPause}>
            暂停自动化
          </Button>
          <Button variant="tertiary" onPress={onOpenSettings}>
            设置
          </Button>
        </>
      ) : (
        <Button variant="secondary" onPress={onOpenSettings}>
          设置
        </Button>
      )}
    </div>
  )
}
