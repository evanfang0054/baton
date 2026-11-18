export interface DigestSchedule {
  stop(): void
}

export interface DigestSchedulerDeps {
  listWorkspaces(): Array<{ id: string; trusted: boolean; digestCron: string }>
  generate(workspaceId: string): Promise<unknown>
  schedule(cron: string, run: () => void): DigestSchedule | null
}

export interface DigestScheduler {
  start(): void
  reschedule(): void
  stop(): void
}

/** 只支持默认的 `m h[,h...] * * *`；其他 cron 视为不支持，保留手动生成。 */
export function parseDailyCron(cron: string): Array<{ hour: number; minute: number }> | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minuteRaw, hourRaw, ...rest] = parts
  if (!minuteRaw || !hourRaw || rest.some((part) => part !== '*')) return null
  const minute = Number(minuteRaw)
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null
  const hours = hourRaw.split(',').map(Number)
  if (hours.some((hour) => !Number.isInteger(hour) || hour < 0 || hour > 23)) return null
  return [...new Set(hours)].sort((a, b) => a - b).map((hour) => ({ hour, minute }))
}

function nextRunAt(times: Array<{ hour: number; minute: number }>, now: number): number | null {
  if (times.length === 0) return null
  const current = new Date(now)
  let best: number | null = null
  for (const time of times) {
    const candidate = new Date(current)
    candidate.setHours(time.hour, time.minute, 0, 0)
    if (candidate.getTime() <= now) candidate.setDate(candidate.getDate() + 1)
    if (best === null || candidate.getTime() < best) best = candidate.getTime()
  }
  return best
}

export function createTimeoutSchedule(cron: string, run: () => void): DigestSchedule | null {
  const times = parseDailyCron(cron)
  if (!times) return null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const arm = (): void => {
    if (stopped) return
    const next = nextRunAt(times, Date.now())
    if (next === null) return
    timer = setTimeout(
      () => {
        if (stopped) return
        run()
        arm()
      },
      Math.max(1, next - Date.now()),
    )
  }

  arm()
  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}

export function createDigestScheduler(deps: DigestSchedulerDeps): DigestScheduler {
  let jobs: DigestSchedule[] = []

  function stop(): void {
    jobs.forEach((job) => job.stop())
    jobs = []
  }

  function start(): void {
    stop()
    for (const workspace of deps.listWorkspaces()) {
      if (!workspace.trusted) continue
      const job = deps.schedule(workspace.digestCron, () => {
        void deps.generate(workspace.id)
      })
      if (job) jobs.push(job)
    }
  }

  return { start, reschedule: start, stop }
}
