import { describe, expect, it, vi } from 'vitest'
import { createDigestScheduler, parseDailyCron } from '../src/automation/scheduler.js'

describe('digest scheduler', () => {
  it('accepts the default daily cron and rejects unsupported expressions', () => {
    expect(parseDailyCron('0 9,21 * * *')).toEqual([
      { hour: 9, minute: 0 },
      { hour: 21, minute: 0 },
    ])
    expect(parseDailyCron('*/5 * * * *')).toBeNull()
    expect(parseDailyCron('0 25 * * *')).toBeNull()
  })

  it('schedules only trusted workspaces and can stop jobs', async () => {
    const generate = vi.fn().mockResolvedValue(undefined)
    const stop = vi.fn()
    const runs: Array<() => void> = []
    const scheduler = createDigestScheduler({
      listWorkspaces: () => [
        { id: 'w1', trusted: true, digestCron: '0 9,21 * * *' },
        { id: 'w2', trusted: false, digestCron: '0 9,21 * * *' },
      ],
      generate,
      schedule: (_cron, run) => {
        runs.push(run)
        return { stop }
      },
    })
    scheduler.start()
    expect(runs).toHaveLength(1)
    runs[0]!()
    expect(generate).toHaveBeenCalledWith('w1')
    scheduler.reschedule()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(runs).toHaveLength(2)
    scheduler.stop()
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('logs scheduled generation failures instead of throwing', () => {
    const error = vi.fn()
    const runs: Array<() => void> = []
    const scheduler = createDigestScheduler({
      listWorkspaces: () => [{ id: 'w1', trusted: true, digestCron: '0 9,21 * * *' }],
      generate: () => {
        throw new Error('boom')
      },
      schedule: (_cron, run) => {
        runs.push(run)
        return { stop: () => {} }
      },
      logger: { error } as never,
    })
    scheduler.start()
    expect(() => runs[0]!()).not.toThrow()
    expect(error).toHaveBeenCalled()
  })
})
