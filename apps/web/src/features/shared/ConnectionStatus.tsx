import { useAppStore, type WsStatus } from '../../stores/app'

const labels: Record<WsStatus, string> = {
  connecting: '连接中',
  online: '在线',
  reconnecting: '重连中',
  offline: '离线',
}

const dot: Record<WsStatus, string> = {
  connecting: 'bg-warning',
  online: 'bg-success',
  reconnecting: 'bg-warning',
  offline: 'bg-danger',
}

export function ConnectionStatus() {
  const status = useAppStore((state) => state.wsStatus)
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span className={`h-2 w-2 rounded-full ${dot[status]}`} />
      {labels[status]}
    </span>
  )
}
