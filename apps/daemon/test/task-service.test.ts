import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TaskCreateInput } from '@baton/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import type { Config } from '../src/config.js'
import { getTask } from '../src/db/repositories.js'
import { createTaskService } from '../src/runtime/task-service.js'
import { createTestDb, seedTask, type TestDb } from './helpers/db.js'

const dirs: string[] = []
const dbs: TestDb[] = []

interface Setup {
  database: TestDb
  seeded: ReturnType<typeof seedTask>
  workspacePath: string
  service: ReturnType<typeof createTaskService>
}

function setup(options: { allowBypassPermissions?: boolean } = {}): Setup {
  const root = mkdtempSync(join(tmpdir(), 'baton-task-'))
  dirs.push(root)
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw)
  const workspacePath = join(root, seeded.relPath)
  mkdirSync(workspacePath, { recursive: true })
  database.raw
    .prepare(
      `insert into node (id, canvas_id, type, x, y, w, h, group_id, data_json, created_at, updated_at)
       values ('text-1', ?, 'text', 10, 10, 320, 200, null, ?, 1, 1)`,
    )
    .run(seeded.canvasId, JSON.stringify({ content: '登录页需求' }))

  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    token: null,
    dataDir: root,
    webRoot: root,
    workspacesRoot: root,
    maxConcurrency: 1,
    maxLiveSessions: 5,
    claudeMaxTurns: 30,
    claudeMaxBudgetUsd: 2,
    claudeProjectHooks: 'on',
    allowBypassPermissions: options.allowBypassPermissions ?? false,
    killSwitch: false,
  }
  const service = createTaskService({
    db: database.db,
    config,
    now: () => 10,
    newId: () => 'task-new',
  })
  return { database, seeded, workspacePath, service }
}

function input(seeded: ReturnType<typeof seedTask>): TaskCreateInput {
  return {
    workspaceId: seeded.workspaceId,
    nodeId: seeded.nodeId,
    title: 'demo',
    prompt: '把登录页改成暗黑模式',
    contextNodeIds: ['text-1'],
    engine: 'fake',
    workspaceMode: 'main',
    dangerouslySkipPermissions: false,
  }
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dbs.splice(0).forEach((entry) => entry.raw.close())
})

describe('createTask', () => {
  it('assembles context and persists a todo task', () => {
    const { database, seeded, service } = setup()
    const result = service.createTask(input(seeded))
    expect(result).toEqual({ ok: true, taskId: 'task-new' })

    const task = getTask(database.db, 'task-new')
    expect(task?.status).toBe('todo')
    expect(task?.prompt).toContain('<task>把登录页改成暗黑模式</task>')
    expect(task?.prompt).toContain('<node id="text-1"')
    expect(task?.prompt).toContain('登录页需求')
  })

  it('persists a context snapshot from the same assembly', () => {
    const { database, seeded, service } = setup()
    const result = service.createTask(input(seeded))
    expect(result).toEqual({ ok: true, taskId: 'task-new' })

    const row = database.raw
      .prepare('select context_json from task where id = ?')
      .get('task-new') as { context_json: string }
    const snapshot = JSON.parse(row.context_json) as {
      included: Array<{ id: string; title: string }>
      dropped: unknown[]
      relations: unknown[]
      relationsTruncated: boolean
    }
    expect(snapshot.included.map((item) => item.id)).toEqual(['text-1'])
    expect(snapshot.included[0]?.title).toBe('登录页需求')
    expect(snapshot.dropped).toEqual([])
    expect(snapshot.relations).toEqual([])
    expect(snapshot.relationsTruncated).toBe(false)
  })

  it('rejects worktree mode and the pty engine', () => {
    const { seeded, service } = setup()
    const worktree = service.createTask({ ...input(seeded), workspaceMode: 'worktree' })
    expect(worktree.ok).toBe(false)
    if (!worktree.ok) {
      expect(worktree.error.code).toBe('unsupported_workspace_mode')
    }

    const claude = service.createTask({ ...input(seeded), engine: 'claude-sdk' })
    expect(claude.ok).toBe(true)

    const pty = service.createTask({ ...input(seeded), engine: 'pty' })
    expect(pty.ok).toBe(false)
    if (!pty.ok) {
      expect(pty.error.code).toBe('unsupported_engine')
    }
  })

  it('requires an agent target and existing context nodes', () => {
    const { seeded, service } = setup()
    const textTarget = service.createTask({ ...input(seeded), nodeId: 'text-1' })
    expect(textTarget.ok).toBe(false)
    if (!textTarget.ok) {
      expect(textTarget.error.code).toBe('invalid_payload')
    }

    const missing = service.createTask({
      ...input(seeded),
      contextNodeIds: ['missing-node'],
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.error.code).toBe('node_not_found')
    }
  })

  it('requires the global switch and a trusted workspace for bypass', () => {
    const disabled = setup()
    const blocked = disabled.service.createTask({
      ...input(disabled.seeded),
      dangerouslySkipPermissions: true,
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.error.code).toBe('bypass_not_allowed')
    }

    const enabled = setup({ allowBypassPermissions: true })
    const untrusted = enabled.service.createTask({
      ...input(enabled.seeded),
      dangerouslySkipPermissions: true,
    })
    expect(untrusted.ok).toBe(false)
    if (!untrusted.ok) {
      expect(untrusted.error.code).toBe('workspace_untrusted')
    }
  })

  it('persists bypass and writes an audit entry', () => {
    const { database, seeded, service } = setup({ allowBypassPermissions: true })
    database.raw
      .prepare('update workspace set trusted = 1, trusted_at = 1 where id = ?')
      .run(seeded.workspaceId)

    const result = service.createTask({
      ...input(seeded),
      dangerouslySkipPermissions: true,
    })
    expect(result).toEqual({ ok: true, taskId: 'task-new' })
    expect(getTask(database.db, 'task-new')?.dangerouslySkipPermissions).toBe(true)
    const audits = database.raw
      .prepare("select action from audit where action = 'task.bypass_permissions'")
      .all()
    expect(audits).toHaveLength(1)
  })

  it('rejects an invalid policy file', () => {
    const { seeded, service, workspacePath } = setup()
    mkdirSync(join(workspacePath, '.baton'))
    writeFileSync(join(workspacePath, '.baton', 'policy.json'), '{')
    const result = service.createTask(input(seeded))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_policy')
    }
  })
})
