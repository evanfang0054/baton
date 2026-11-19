import type { AutomationSummary } from '@baton/protocol'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AutomationStatus } from './AutomationStatus'

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

describe('AutomationStatus', () => {
  it('shows running state and pauses automation', async () => {
    const onPause = vi.fn()
    render(<AutomationStatus summary={summary()} onPause={onPause} onOpenSettings={() => {}} />)
    expect(screen.getByText('自动化运行中')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '暂停自动化' }))
    expect(onPause).toHaveBeenCalledTimes(1)
  })

  it('shows paused state and routes restore through settings', async () => {
    const onOpenSettings = vi.fn()
    render(
      <AutomationStatus
        summary={summary({ killSwitch: true })}
        onPause={() => {}}
        onOpenSettings={onOpenSettings}
      />,
    )
    expect(screen.getByText('自动化已暂停')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '暂停自动化' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '恢复' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('disables restore when the kill switch is forced by env', () => {
    render(
      <AutomationStatus
        summary={summary({ killSwitch: true, killSwitchForced: true })}
        onPause={() => {}}
        onOpenSettings={() => {}}
      />,
    )
    expect(screen.getByText('由环境变量强制暂停')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复' })).not.toBeInTheDocument()
  })

  it('shows off state when autopilot is disabled', async () => {
    const onOpenSettings = vi.fn()
    render(
      <AutomationStatus
        summary={summary({
          policy: {
            verify: { timeoutSec: 900, maxOutputBytes: 262144 },
            approval: { default: 'ask', allow: [], deny: [], autoApproveMaxRisk: 'low' },
            autopilot: { enabled: false, retryMax: 2, digestCron: '0 9,21 * * *' },
          },
        })}
        onPause={() => {}}
        onOpenSettings={onOpenSettings}
      />,
    )
    expect(screen.getByText('自动化关闭')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('renders nothing before the summary loads', () => {
    const { container } = render(
      <AutomationStatus summary={null} onPause={() => {}} onOpenSettings={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
