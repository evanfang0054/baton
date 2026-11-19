import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAutomation, listNotices, setKillSwitch } from './api'

afterEach(() => vi.unstubAllGlobals())

const summary = {
  workspaceId: 'w1',
  trusted: true,
  policy: {
    verify: {},
    approval: { default: 'ask', allow: ['Read'], deny: [], autoApproveMaxRisk: 'low' },
    autopilot: { enabled: true, retryMax: 2, digestCron: '0 9,21 * * *' },
  },
  policyVersion: 'abc123abc123',
  killSwitch: false,
  killSwitchForced: false,
  digestCronUnsupported: false,
}

describe('automation api', () => {
  it('parses automation summary and notices query', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input))
        if (String(input).startsWith('/api/workspaces/w1/automation')) {
          return Response.json(summary)
        }
        return Response.json({ notices: [] })
      }),
    )

    await expect(getAutomation('w1')).resolves.toMatchObject({ trusted: true })
    await listNotices('w1', { kind: 'digest', before: 10 })
    expect(calls[1]).toContain('kind=digest')
    expect(calls[1]).toContain('before=10')
  })

  it('sends kill switch payload', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ killSwitch: true, killSwitchForced: false }))
    await setKillSwitch(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/automation/kill-switch',
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})
