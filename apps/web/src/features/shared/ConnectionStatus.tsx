import { useAppStore, type WsStatus } from '../../stores/app'

const labels: Record<WsStatus, string> = {
  connecting: '连接中',
  online: '在线',
  reconnecting: '重连中',
  offline: '离线',
  unauthorized: '未认证',
}

const dot: Record<WsStatus, string> = {
  connecting: 'bg-warning',
  online: 'bg-success',
  reconnecting: 'bg-warning',
  offline: 'bg-danger',
  unauthorized: 'bg-danger',
}

export function ConnectionStatus({ compact = false }: { compact?: boolean }) {
  const status = useAppStore((state) => state.wsStatus)
  if (compact) {
    return (
      <span className="flex items-center" title={labels[status]}>
        <span className={`h-2 w-2 rounded-full ${dot[status]}`} />
        <span className="sr-only">{labels[status]}</span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span className={`h-2 w-2 rounded-full ${dot[status]}`} />
      {labels[status]}
    </span>
  )
}
