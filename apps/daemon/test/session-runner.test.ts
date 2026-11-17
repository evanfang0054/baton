import { FakeAdapter } from '@baton/adapters'
import type { AgentAdapter } from '@baton/protocol'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listApprovalsByTask, getApproval } from '../src/db/repositories.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import type { TestRuntimeHandle } from './helpers/runtime.js'
import { createTestRuntime } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(options?: {
  policy?: unknown
  adapters?: ReturnType<typeof createAdapterFactory>
}): TestRuntimeHandle {
  const handle = createTestRuntime({
    useSessionRunner: true,
    adapters: options?.adapters ?? createAdapterFactory(),
  })
  handles.push(handle)
  if (options?.policy) {
    mkdirSync(join(handle.root, handle.seeded.relPath, '.baton'))
    writeFileSync(
      join(handle.root, handle.seeded.relPath, '.baton', 'policy.json'),
      JSON.stringify(options.policy),
    )
  }
  return handle
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('session runner', () => {
  it('asks for approval and resumes after a user allow', async () => {
    const handle = setup()
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input')

    const approval = listApprovalsByTask(handle.database.db, taskId)[0]
    expect(approval?.decision).toBeNull()
    expect(approval?.requestId).toBeTruthy()
    expect(handle.events.map((event) => event.type)).toContain('approval.request')

    const decided = handle.runtime.decideApproval({
      approvalId: approval!.id,
      decision: 'allow',
    })
    expect(decided.ok).toBe(true)
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'verifying')

    const stored = getApproval(handle.database.db, approval!.id)
    expect(stored?.decision).toBe('allow')
    expect(stored?.decidedBy).toBe('user')
  })

  it('auto-approves a low/medium risk tool when autopilot allows it', async () => {
    const handle = setup({
      policy: {
        autopilot: { enabled: true, retryMax: 1 },
        approval: { autoApproveMaxRisk: 'medium' },
      },
    })
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'verifying')

    const approval = listApprovalsByTask(handle.database.db, taskId)[0]
    expect(approval?.decision).toBe('allow')
    expect(approval?.decidedBy).toBe('auto')
  })

  it('auto-denies a matching deny rule and lets the engine finish', async () => {
    const handle = setup({ policy: { approval: { deny: ['Bash:*'] } } })
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'verifying')

    const approval = listApprovalsByTask(handle.database.db, taskId)[0]
    expect(approval?.decision).toBe('deny')
    expect(approval?.decidedBy).toBe('auto')
  })

  it('interrupts the adapter when the task is cancelled', async () => {
    const handle = setup()
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input')

    const outcome = handle.runtime.cancel(taskId, 'user cancelled')
    expect(outcome.ok).toBe(true)
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'cancelled')
    const sessions = handle.database.raw
      .prepare('select status from session where task_id = ?')
      .all(taskId) as Array<{ status: string }>
    expect(sessions.map((row) => row.status)).toContain('ended')
  })

  it('fails the task when the adapter emits RUN_ERROR', async () => {
    const handle = setup({
      adapters: createAdapterFactory({
        fake: new FakeAdapter({ script: [{ kind: 'error', message: 'boom' }] }),
      }),
    })
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'failed')
    const session = handle.database.raw
      .prepare('select status from session where task_id = ?')
      .get(taskId) as { status: string }
    expect(session.status).toBe('failed')
  })

  it('fails the task when the adapter stream ends unexpectedly', async () => {
    const emptyAdapter: AgentAdapter = {
      name: 'fake',
      async start() {
        return {
          events: (async function* () {})(),
          approve: async () => {},
          send: async () => {},
          interrupt: async () => {},
          dispose: async () => {},
        }
      },
    }
    const handle = setup({ adapters: createAdapterFactory({ fake: emptyAdapter }) })
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })
    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'failed')
  })
})
