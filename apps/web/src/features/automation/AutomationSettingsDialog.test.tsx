import type { AutomationSummary } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAutomation, listAudit, setKillSwitch, updateAutomationPolicy } from '../../lib/api'
import { AutomationSettingsDialog } from './AutomationSettingsDialog'

vi.mock('../../lib/api', () => ({
  getAutomation: vi.fn(),
  updateAutomationPolicy: vi.fn(),
  setKillSwitch: vi.fn(),
  listAudit: vi.fn(),
}))
vi.mock('@heroui/react/toast', () => ({ toast: { success: vi.fn(), danger: vi.fn() } }))

function summary(overrides: Partial<AutomationSummary> = {}): AutomationSummary {
  return {
    workspaceId: 'w1',
    trusted: true,
    policy: {
      verify: { timeoutSec: 900, maxOutputBytes: 262144 },
      approval: { default: 'ask', allow: ['Read'], deny: [], autoApproveMaxRisk: 'low' },
      autopilot: { enabled: true, retryMax: 2, digestCron: '0 9,21 * * *' },
    },
    policyVersion: 'abc123abc123',
    killSwitch: false,
    killSwitchForced: false,
    digestCronUnsupported: false,
    ...overrides,
  }
}

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AutomationSettingsDialog workspaceId="w1" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.mocked(getAutomation).mockReset()
  vi.mocked(updateAutomationPolicy).mockReset()
  vi.mocked(setKillSwitch).mockReset()
  vi.mocked(listAudit).mockReset()
})

describe('AutomationSettingsDialog', () => {
  it('saves only the changed editable policy fields', async () => {
    vi.mocked(getAutomation).mockResolvedValue(summary())
    vi.mocked(listAudit).mockResolvedValue([])
    vi.mocked(updateAutomationPolicy).mockResolvedValue(summary())
    wrap()

    const retry = await screen.findByLabelText('最大自动重试次数')
    await userEvent.clear(retry)
    await userEvent.type(retry, '3')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(updateAutomationPolicy).toHaveBeenCalledWith('w1', {
        autopilot: { retryMax: 3 },
      }),
    )
  })

  it('keeps allow/deny and digest cron read-only', async () => {
    vi.mocked(getAutomation).mockResolvedValue(summary())
    vi.mocked(listAudit).mockResolvedValue([])
    wrap()

    expect(await screen.findByText('只读策略')).toBeInTheDocument()
    expect(screen.getByText('allow：Read')).toBeInTheDocument()
    expect(screen.getByText('deny：无')).toBeInTheDocument()
    expect(screen.getByText('digest：0 9,21 * * *')).toBeInTheDocument()
  })

  it('blocks saving until the workspace is trusted', async () => {
    vi.mocked(getAutomation).mockResolvedValue(summary({ trusted: false }))
    vi.mocked(listAudit).mockResolvedValue([])
    wrap()

    expect(await screen.findByText('先信任工作区，才能启用自动化。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('restores automation from a paused kill switch', async () => {
    vi.mocked(getAutomation).mockResolvedValue(summary({ killSwitch: true }))
    vi.mocked(listAudit).mockResolvedValue([])
    vi.mocked(setKillSwitch).mockResolvedValue({ killSwitch: false, killSwitchForced: false })
    wrap()

    expect(await screen.findByText('自动化已暂停：不会自动批准或自动重试。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '恢复自动化' }))
    await waitFor(() => expect(setKillSwitch).toHaveBeenCalledWith(false))
  })

  it('does not offer restore when the kill switch is forced by env', async () => {
    vi.mocked(getAutomation).mockResolvedValue(
      summary({ killSwitch: true, killSwitchForced: true }),
    )
    vi.mocked(listAudit).mockResolvedValue([])
    wrap()

    expect(await screen.findByText('自动化已被环境变量强制暂停。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复自动化' })).not.toBeInTheDocument()
  })
})
