import type { SupervisorMode, SupervisorStatusResponse } from '@baton/protocol'
import { ConnectionStatus } from '../shared/ConnectionStatus'

const modeLabels: Record<SupervisorMode, string> = {
  explicit: '仅明确指令',
  observe: '观察模式',
  auto: '自动模式',
}

export function SupervisorStatusBar({ status }: { status?: SupervisorStatusResponse }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-separator px-4 py-2 text-xs text-muted">
      <span>{status ? modeLabels[status.mode] : modeLabels.explicit}</span>
      <span aria-hidden="true">·</span>
      <span>
        {!status
          ? '读取配置中'
          : status.configured
            ? status.model
              ? `模型 ${status.model}`
              : '模型已配置'
            : '未配置模型'}
      </span>
      <span className="ml-auto">
        <ConnectionStatus />
      </span>
    </div>
  )
}
