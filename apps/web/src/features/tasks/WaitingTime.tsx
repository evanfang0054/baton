import { useEffect, useState } from 'react'

export function formatElapsed(since: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `已等 ${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  return `已等 ${hours} 小时 ${minutes % 60} 分`
}

export function WaitingTime({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return <span className="text-xs text-warning">{formatElapsed(since, now)}</span>
}
