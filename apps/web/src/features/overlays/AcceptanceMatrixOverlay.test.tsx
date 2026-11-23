import type { DeliveryDetail } from '@baton/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { AcceptanceMatrixOverlay } from './AcceptanceMatrixOverlay'

const getTask = vi.fn()
const getTaskAcceptance = vi.fn()

vi.mock('../../lib/api', () => ({
  getTask: (...args: unknown[]) => getTask(...args),
  getTaskAcceptance: (...args: unknown[]) => getTaskAcceptance(...args),
}))

const delivery = {
  id: 'd1',
  title: '演示交付',
  goal: '验证验收矩阵通过时的 override 理由',
  status: 'waiting_person',
  currentStageKey: 'acceptance',
  stageProgress: { done: 0, total: 1 },
  waitingSince: null,
  openAnnotationCount: 0,
  artifacts: [],
  annotations: [],
  playbook: {
    stages: [
      {
        key: 'acceptance',
        label: '验收',
        gate: 'human',
        acceptance: { checklist: ['最终由人拍板'] },
      },
    ],
  },
  stages: [
    {
      key: 'acceptance',
      label: '验收',
      ordinal: 1,
      gate: 'human',
      status: 'waiting_person',
      taskId: 't1',
      taskStatus: 'review',
      artifactCount: 0,
      openAnnotationCount: 0,
      skillStatus: null,
    },
  ],
} as unknown as DeliveryDetail

function renderOverlay(send = vi.fn().mockResolvedValue(undefined)) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <CommandProvider send={send}>
        <AcceptanceMatrixOverlay delivery={delivery} onClose={vi.fn()} />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return send
}

afterEach(() => {
  vi.restoreAllMocks()
  getTask.mockReset()
  getTaskAcceptance.mockReset()
})

describe('AcceptanceMatrixOverlay', () => {
  it('prompts for an override reason when AC is empty and sends it with approve', async () => {
    getTask.mockResolvedValue({
      task: { id: 't1', verifyCommand: 'npm test' },
      review: {
        id: 'r1',
        taskId: 't1',
        verdict: null,
        verifyExitCode: 1,
        verifyOutput: 'fail',
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        decidedAt: null,
        diffAvailable: false,
        preliminaryVerdict: null,
        preliminaryReason: null,
        preliminaryAt: null,
      },
    })
    getTaskAcceptance.mockResolvedValue({
      contract: { id: 'ac1', version: 1, revision: 0, status: 'draft' },
      items: [],
      run: null,
      report: {
        acceptance: {
          items: [],
          counts: { total: 0, pass: 0, fail: 0, pending: 0, waived: 0 },
          verdict: 'incomplete',
        },
      },
      budget: {},
    })
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('已知问题，先合')
    const send = renderOverlay()

    fireEvent.click(await screen.findByRole('button', { name: '通过阶段' }))

    expect(prompt).toHaveBeenCalledWith('还没有验收项，仍要直接通过吗？')
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'approve', overrideReason: '已知问题，先合' },
      }),
    )
  })

  it('cancels approve when the override prompt is dismissed', async () => {
    getTask.mockResolvedValue({
      task: { id: 't1', verifyCommand: 'npm test' },
      review: {
        id: 'r1',
        taskId: 't1',
        verdict: null,
        verifyExitCode: 0,
        verifyOutput: '',
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        decidedAt: null,
        diffAvailable: false,
        preliminaryVerdict: null,
        preliminaryReason: null,
        preliminaryAt: null,
      },
    })
    getTaskAcceptance.mockResolvedValue({
      contract: { id: 'ac1', version: 1, revision: 0, status: 'draft' },
      items: [],
      run: null,
      report: {
        acceptance: {
          items: [],
          counts: { total: 2, pass: 1, fail: 1, pending: 0, waived: 0 },
          verdict: 'fail',
        },
      },
      budget: {},
    })
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    const send = renderOverlay()

    fireEvent.click(await screen.findByRole('button', { name: '通过阶段' }))

    expect(send).not.toHaveBeenCalled()
  })

  it('rejects with feedback without prompting', async () => {
    getTask.mockResolvedValue({
      task: { id: 't1', verifyCommand: 'npm test' },
      review: {
        id: 'r1',
        taskId: 't1',
        verdict: null,
        verifyExitCode: 0,
        verifyOutput: '',
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        decidedAt: null,
        diffAvailable: false,
        preliminaryVerdict: null,
        preliminaryReason: null,
        preliminaryAt: null,
      },
    })
    getTaskAcceptance.mockResolvedValue({
      contract: { id: 'ac1', version: 1, revision: 0, status: 'draft' },
      items: [],
      run: null,
      report: {
        acceptance: {
          items: [],
          counts: { total: 1, pass: 0, fail: 1, pending: 0, waived: 0 },
          verdict: 'fail',
        },
      },
      budget: {},
    })
    const prompt = vi.spyOn(window, 'prompt')
    const send = renderOverlay()

    fireEvent.click(await screen.findByRole('button', { name: '打回' }))

    expect(prompt).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'reject', feedback: '验收矩阵未通过' },
      }),
    )
  })
})
