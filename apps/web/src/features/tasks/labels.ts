const sessionStatusLabels: Record<string, string> = {
  running: '进行中',
  waiting_input: '等待输入',
  ended: '已结束',
  failed: '失败',
}

export function sessionStatusLabel(status: string): string {
  return sessionStatusLabels[status] ?? status
}
