---
spec_ref: ../specs/2026-11-17-m1-claude-adapter-design.md
spec_topic: m1-claude-adapter
task_count: 6
estimated_phases: [tests, implementation, verification]
dod: "Workspace trust 字段/migration/API/审计；waiting_input 接受 session_reported；countActiveTasks 排除 waiting_input；maxLiveSessions=5 双上限；boot 对账进 waiting_input(stalled)"
depends_on: []
---

# M1-7a 契约与并发基座实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为真实 Claude 接入准备最小契约与并发基座：workspace trust、`waiting_input` 的会话报告收敛、执行槽/live session 双上限、重启对账进 `waiting_input(stalled)`。

**Architecture:** 自下而上改：protocol/schema/migration → repository/API → core 状态机 → daemon 计数/调度/对账。Plan A 的性能改动不在此分支；本计划不接真实 Claude、不改 web。

**Tech Stack:** TypeScript ESM、zod 4、Drizzle / better-sqlite3、Fastify 5、vitest。

---

## 计划地图

| Plan | 范围 | 状态 |
|---|---|---|
| A. 性能热路径 | SQLite/event-store/session-cache/WS | 已完成，PR #12（栈 #10/#11/#12 待合并） |
| **B. 契约与并发基座（本计划）** | trust、状态机、并发、boot | 已完成（2026-11-18） |
| C. Claude adapter 与 daemon 接线 | S2 spike、adapter、engine/trust 接线 | 待写；依赖 B |
| D. Web UX 与真实验收 | trust 弹窗、引擎选择、ego-lite | 待写；依赖 B+C |

**Commit strategy:** 每个 Task 结束提交一次；Task 6 跑全量 `pnpm verify`。

---

## Task 1: Workspace trust 字段与 migration

Blocking: none
Slice type: tracer-bullet
Seam: `Workspace.parse` 与 `workspace` 表列

**Files:**

- Modify: `packages/protocol/src/entities/workspace.ts`
- Create: `packages/protocol/test/workspace.test.ts`
- Modify: `apps/daemon/src/db/schema.ts`
- Create: `apps/daemon/migrations/0003_*.sql`（drizzle-kit 生成）
- Modify: `apps/daemon/src/db/repositories.ts`
- Modify: `apps/daemon/src/http/workspaces.ts`
- Test: `apps/daemon/test/repositories.test.ts`

**Interfaces:**

- Produces: `Workspace.trusted: boolean`、`projectHooks: 'off'|'on'`、`trustedAt: Timestamp|null`；新工作区默认 `false/off/null`。

- [ ] **Step 1: 写失败测试**

```ts
// packages/protocol/test/workspace.test.ts
import { describe, expect, it } from 'vitest'
import { Workspace } from '../src/entities/workspace.js'

describe('Workspace trust', () => {
  it('round-trips trust fields', () => {
    const parsed = Workspace.parse({
      id: 'w1',
      name: 'demo',
      relPath: 'demo',
      trusted: true,
      projectHooks: 'on',
      trustedAt: 10,
      createdAt: 1,
    })
    expect(parsed).toMatchObject({ trusted: true, projectHooks: 'on', trustedAt: 10 })
  })
})
```

```ts
// apps/daemon/test/repositories.test.ts，追加
it('defaults workspace trust to off', () => {
  const database = db()
  const seeded = seedTask(database.raw)
  expect(repo.getWorkspace(database.db, seeded.workspaceId)).toMatchObject({
    trusted: false,
    projectHooks: 'off',
    trustedAt: null,
  })
  const columns = database.raw.pragma('table_info(workspace)') as Array<{ name: string }>
  expect(columns.map((column) => column.name)).toEqual(
    expect.arrayContaining(['trusted', 'project_hooks', 'trusted_at']),
  )
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @baton/protocol test -- workspace
pnpm --filter @evanfang0054/baton exec vitest run test/repositories.test.ts
```

Expected: FAIL（schema 缺字段 / 表缺列）。

- [ ] **Step 3: 扩 protocol schema**

```ts
// packages/protocol/src/entities/workspace.ts
export const Workspace = z.object({
  id: Id,
  name: z.string().min(1),
  /** 相对 BATON_WORKSPACES_ROOT；路径 jail 与真实路径解析由 daemon 的 resolveWithin 负责。 */
  relPath: z.string().min(1),
  trusted: z.boolean(),
  projectHooks: z.enum(['off', 'on']),
  trustedAt: Timestamp.nullable(),
  createdAt: Timestamp,
})
```

- [ ] **Step 4: 扩 DB schema 并生成 migration**

```ts
// apps/daemon/src/db/schema.ts
export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  relPath: text('rel_path').notNull().unique(),
  trusted: integer('trusted', { mode: 'boolean' }).notNull().default(false),
  projectHooks: text('project_hooks').notNull().default('off'),
  trustedAt: integer('trusted_at'),
  createdAt: integer('created_at').notNull(),
})
```

```bash
pnpm --filter @evanfang0054/baton exec drizzle-kit generate --name workspace_trust
```

检查生成的 `apps/daemon/migrations/0003_*.sql` 包含三列与默认值，并提交 `meta/_journal.json` 更新。

- [ ] **Step 5: 更新 repository 映射与插入**

```ts
function toWorkspace(row: typeof workspace.$inferSelect): Workspace {
  return Workspace.parse({
    id: row.id,
    name: row.name,
    relPath: row.relPath,
    trusted: row.trusted,
    projectHooks: row.projectHooks,
    trustedAt: row.trustedAt,
    createdAt: row.createdAt,
  })
}

// insertWorkspaceWithCanvas 的 values 增加：
trusted: input.workspace.trusted,
projectHooks: input.workspace.projectHooks,
trustedAt: input.workspace.trustedAt,
```

- [ ] **Step 6: 更新 workspace 创建默认值**

`apps/daemon/src/http/workspaces.ts` 的 `const workspace: Workspace` 增加：

```ts
trusted: false,
projectHooks: 'off',
trustedAt: null,
```

运行 `pnpm typecheck`，修掉所有缺字段的 `Workspace` 字面量。

- [ ] **Step 7: 跑测试确认通过**

```bash
pnpm --filter @baton/protocol test
pnpm --filter @evanfang0054/baton exec vitest run test/repositories.test.ts test/migrate.test.ts
pnpm --filter @evanfang0054/baton typecheck
```

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add packages/protocol/src/entities/workspace.ts packages/protocol/test/workspace.test.ts \
  apps/daemon/src/db/schema.ts apps/daemon/src/db/repositories.ts \
  apps/daemon/src/http/workspaces.ts apps/daemon/migrations
git commit -m "feat(protocol): workspace trust 字段与 migration"
```

---

## Task 2: Trust API 与审计

Blocking: Task 1
Slice type: tracer-bullet
Seam: `PATCH /api/workspaces/:id/trust`

**Files:**

- Modify: `packages/protocol/src/api.ts`
- Modify: `apps/daemon/src/db/repositories.ts`
- Modify: `apps/daemon/src/http/workspaces.ts`
- Test: `apps/daemon/test/workspace-trust.test.ts`

**Interfaces:**

- Produces: `WorkspaceTrustInput`、`WorkspaceTrustResponse`；`updateWorkspaceTrust(tx, id, input)`；审计 `workspace.trust`/`workspace.untrust`/`workspace.project_hooks_changed`。

- [ ] **Step 1: 写失败测试**

```ts
// apps/daemon/test/workspace-trust.test.ts
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTestApp, type TestApp } from './helpers/app.js'

const apps: TestApp[] = []
const auth = { authorization: 'Bearer secret' }

async function setup(): Promise<TestApp> {
  const app = await buildTestApp({ config: { token: 'secret' } })
  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.app.close()))
})

describe('workspace trust API', () => {
  it('trusts a workspace, records audit and can revoke', async () => {
    const { app, handle } = await setup()
    mkdirSync(join(handle.root, 'demo'))
    const created = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: auth,
      payload: { name: 'demo', relPath: 'demo' },
    })
    const id = (created.json() as { workspace: { id: string } }).workspace.id

    const trusted = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/trust`,
      headers: auth,
      payload: { trusted: true, projectHooks: 'on' },
    })
    expect(trusted.statusCode).toBe(200)
    expect(trusted.json()).toMatchObject({
      workspace: { trusted: true, projectHooks: 'on' },
    })

    const audit = handle.database.raw
      .prepare("select action from audit where action like 'workspace.%' order by rowid")
      .all() as Array<{ action: string }>
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(['workspace.trust', 'workspace.project_hooks_changed']),
    )

    const revoked = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${id}/trust`,
      headers: auth,
      payload: { trusted: false },
    })
    expect(revoked.json()).toMatchObject({
      workspace: { trusted: false, projectHooks: 'on' },
    })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @evanfang0054/baton exec vitest run test/workspace-trust.test.ts
```

Expected: FAIL（404 / schema 不存在）。

- [ ] **Step 3: 加 protocol API schema**

```ts
// packages/protocol/src/api.ts
export const WorkspaceTrustInput = z.object({
  trusted: z.boolean(),
  projectHooks: z.enum(['off', 'on']).optional(),
})
export type WorkspaceTrustInput = z.infer<typeof WorkspaceTrustInput>

export const WorkspaceTrustResponse = z.object({ workspace: Workspace })
export type WorkspaceTrustResponse = z.infer<typeof WorkspaceTrustResponse>
```

- [ ] **Step 4: 加 repository 更新函数**

```ts
export function updateWorkspaceTrust(
  tx: Tx,
  id: string,
  input: { trusted: boolean; projectHooks: 'off' | 'on'; trustedAt: number | null },
): void {
  tx.update(workspace).set(input).where(eq(workspace.id, id)).run()
}
```

- [ ] **Step 5: 加路由**

`apps/daemon/src/http/workspaces.ts` 注册：

```ts
app.patch('/api/workspaces/:id/trust', async (req) => {
  const parsed = WorkspaceTrustInput.safeParse(req.body)
  if (!parsed.success) {
    throw appError('invalid_payload', 'invalid trust payload', parsed.error.issues)
  }
  const current = getWorkspace(deps.db, (req.params as { id: string }).id)
  if (!current) throw appError('workspace_not_found', 'workspace not found')
  const projectHooks = parsed.data.projectHooks ?? current.projectHooks
  const trustedAt = parsed.data.trusted ? deps.now() : null

  deps.db.transaction((tx) => {
    updateWorkspaceTrust(tx, current.id, {
      trusted: parsed.data.trusted,
      projectHooks,
      trustedAt,
    })
    insertAudit(tx, {
      id: deps.newId(),
      ts: deps.now(),
      actor: 'user',
      action: parsed.data.trusted ? 'workspace.trust' : 'workspace.untrust',
      detail: { workspaceId: current.id, projectHooks },
    })
    if (projectHooks !== current.projectHooks) {
      insertAudit(tx, {
        id: deps.newId(),
        ts: deps.now(),
        actor: 'user',
        action: 'workspace.project_hooks_changed',
        detail: { workspaceId: current.id, projectHooks },
      })
    }
  })

  return WorkspaceTrustResponse.parse({ workspace: getWorkspace(deps.db, current.id) })
})
```

补 import：`WorkspaceTrustInput`、`WorkspaceTrustResponse`、`insertAudit`、`updateWorkspaceTrust`、`appError` 已有。

- [ ] **Step 6: 跑测试确认通过**

```bash
pnpm --filter @evanfang0054/baton exec vitest run test/workspace-trust.test.ts test/rest-api.test.ts
```

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/api.ts apps/daemon/src/db/repositories.ts \
  apps/daemon/src/http/workspaces.ts apps/daemon/test/workspace-trust.test.ts
git commit -m "feat(daemon): workspace trust API 与审计"
```

---

## Task 3: `waiting_input` 接受 `session_reported`

Blocking: none
Slice type: tracer-bullet
Seam: `transition({ status:'waiting_input' }, { type:'session_reported' })`

**Files:**

- Modify: `packages/core/src/state-machine/transition.ts`
- Test: `packages/core/test/transition-attention.test.ts`
- Test: `packages/core/test/transition-matrix.test.ts`（如矩阵需要补组合）

**Interfaces:**

- Produces: `waiting_input` 收到 `unreported` 时保持 `waiting_input` + `waitingReason='stalled'`；`blocked/dropped` 更新对应 reason；不新增事件类型。

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/test/transition-attention.test.ts，追加
it('refreshes a waiting task to stalled on an unreported session', () => {
  const result = transition(
    { ...base, status: 'waiting_input', waitingReason: 'question' },
    { type: 'session_reported', outcome: 'unreported', reason: 'daemon restarted' },
  )
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.status).toBe('waiting_input')
  expect(result.waitingReason).toBe('stalled')
  expect(result.effects.at(-1)?.type).toBe('emitTaskStatus')
})

it('updates waiting reason on a repeated blocked/dropped report', () => {
  const blocked = transition(
    { ...base, status: 'waiting_input', waitingReason: 'stalled' },
    { type: 'session_reported', outcome: 'blocked' },
  )
  expect(blocked.ok && blocked.waitingReason).toBe('question')
  const dropped = transition(
    { ...base, status: 'waiting_input', waitingReason: 'stalled' },
    { type: 'session_reported', outcome: 'dropped' },
  )
  expect(dropped.ok && dropped.waitingReason).toBe('dropped')
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @baton/core exec vitest run test/transition-attention.test.ts
```

Expected: FAIL（`waiting_input` 没有 `session_reported` 分支）。

- [ ] **Step 3: 加状态机分支**

在 `packages/core/src/state-machine/transition.ts` 的 `case 'waiting_input'` 中、`enqueue` 之前加：

```ts
if (event.type === 'session_reported') {
  const waitingReason: WaitingReason =
    event.outcome === 'blocked'
      ? 'question'
      : event.outcome === 'dropped'
        ? 'dropped'
        : 'stalled'
  return ok('waiting_input', ctx.retryCount, [], waitingReason, {
    waitingReason,
    outcome: event.outcome,
    ...(event.reason ? { reason: event.reason } : {}),
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @baton/core test
```

Expected: PASS；矩阵/快照如有变化按实际更新。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state-machine/transition.ts \
  packages/core/test/transition-attention.test.ts packages/core/test/transition-matrix.test.ts
git commit -m "feat(core): waiting_input 接受 session_reported"
```

---

## Task 4: 执行槽与 live session 双上限

Blocking: none
Slice type: tracer-bullet
Seam: `countActiveTasks` / `countLiveSessions` / `SchedulerRuntime`

**Files:**

- Modify: `apps/daemon/src/db/repositories.ts`
- Modify: `packages/protocol/src/config.ts`
- Modify: `apps/daemon/src/config.ts`
- Modify: `apps/daemon/src/runtime/scheduler.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Test: `apps/daemon/test/scheduler.test.ts`
- Test: `apps/daemon/test/repositories.test.ts`
- Test: `apps/daemon/test/config.test.ts`

**Interfaces:**

- Produces: `countActiveTasks` 只计 `running|verifying`；`countLiveSessions` 计 `running|waiting_input` session；`Config.maxLiveSessions` 默认 5 / `BATON_MAX_LIVE_SESSIONS`。

- [ ] **Step 1: 写失败测试**

```ts
// apps/daemon/test/repositories.test.ts，追加
it('does not count a blocked task as an execution slot', () => {
  const database = db()
  const seeded = seedTask(database.raw, {
    taskStatus: 'waiting_input',
    sessionStatus: 'waiting_input',
  })
  expect(repo.countActiveTasks(database.db)).toBe(0)
  expect(repo.countLiveSessions(database.db)).toBe(1)
  expect(repo.getTask(database.db, seeded.taskId)?.status).toBe('waiting_input')
})
```

```ts
// apps/daemon/test/scheduler.test.ts：queueRuntime 增加 live 计数
function queueRuntime(tasks, failing, live = 0, maxLiveSessions = 5) {
  // ...
  return {
    maxConcurrency: 1,
    maxLiveSessions,
    countActiveTasks: () => active,
    countLiveSessions: () => live,
    // ...
  }
}

it('stops starting when live sessions reach the cap', () => {
  const runtime = queueRuntime(['next'], new Set(), 5, 5)
  createScheduler(runtime).pump()
  expect(runtime.started).toEqual([])
})
```

```ts
// apps/daemon/test/config.test.ts，追加
it('defaults maxLiveSessions to 5 and reads the env override', () => {
  const base = loadConfig([], { HOME: '/tmp/home' })
  expect(base.maxLiveSessions).toBe(5)
  const overridden = loadConfig([], { HOME: '/tmp/home', BATON_MAX_LIVE_SESSIONS: '3' })
  expect(overridden.maxLiveSessions).toBe(3)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @evanfang0054/baton exec vitest run test/repositories.test.ts test/scheduler.test.ts test/config.test.ts
```

Expected: FAIL（`countLiveSessions`/`maxLiveSessions` 不存在）。

- [ ] **Step 3: 改计数 SQL**

```ts
export function countActiveTasks(db: Db): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(task)
    .where(sql`${task.status} in ('running', 'verifying')`)
    .get()
  return row?.count ?? 0
}

export function countLiveSessions(db: Db): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(session)
    .where(sql`${session.status} in ('running', 'waiting_input')`)
    .get()
  return row?.count ?? 0
}
```

- [ ] **Step 4: 扩 config 与 scheduler**

`packages/protocol/src/config.ts`：

```ts
maxConcurrency: z.number().int().positive().default(1),
maxLiveSessions: z.number().int().positive().default(5),
```

`apps/daemon/src/config.ts`：

```ts
maxConcurrency: Number(env.BATON_MAX_CONCURRENCY ?? 1),
maxLiveSessions: Number(env.BATON_MAX_LIVE_SESSIONS ?? 5),
```

`apps/daemon/src/runtime/scheduler.ts`：

```ts
export interface SchedulerRuntime {
  readonly maxConcurrency: number
  readonly maxLiveSessions: number
  countActiveTasks(): number
  countLiveSessions(): number
  findNextQueued(exclude?: ReadonlySet<string>): { id: string } | null
  applyTransition(taskId: string, event: TaskTransitionEvent): TransitionOutcome
}
```

`pump()` 增加：

```ts
if (runtime.countLiveSessions() >= runtime.maxLiveSessions) break
```

`apps/daemon/src/runtime/index.ts` 的 runtime 对象增加：

```ts
countLiveSessions: () => countLiveSessions(deps.db),
maxLiveSessions: deps.config.maxLiveSessions,
```

补 import `countLiveSessions`。

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm --filter @evanfang0054/baton exec vitest run test/repositories.test.ts test/scheduler.test.ts test/config.test.ts
```

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/db/repositories.ts packages/protocol/src/config.ts \
  apps/daemon/src/config.ts apps/daemon/src/runtime/scheduler.ts \
  apps/daemon/src/runtime/index.ts apps/daemon/test/repositories.test.ts \
  apps/daemon/test/scheduler.test.ts apps/daemon/test/config.test.ts
git commit -m "feat(daemon): 执行槽与 live session 双上限"
```

---

## Task 5: 重启对账进 `waiting_input(stalled)`

Blocking: Task 3
Slice type: tracer-bullet
Seam: `reconcileOnBoot`

**Files:**

- Modify: `apps/daemon/src/runtime/boot.ts`
- Test: `apps/daemon/test/boot.test.ts`

**Interfaces:**

- Produces: `running/waiting_input` 任务在重启后 `waiting_input(stalled)`；session `failed`；approval expired；`verifying` 仍 `verify_fail(124) → review`。

- [ ] **Step 1: 更新失败测试**

把 `apps/daemon/test/boot.test.ts` 的断言从 `failed` 改为：

```ts
expect(handle.runtime.getTask(first)?.status).toBe('waiting_input')
expect(handle.runtime.getTask(first)?.waitingReason).toBe('stalled')
expect(handle.runtime.getTask(second)?.status).toBe('waiting_input')
expect(handle.runtime.getTask(second)?.waitingReason).toBe('stalled')
```

保留 `verifying → review`、review exit code 124、approval deny/system、`approval.expired` 审计断言。

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @evanfang0054/baton exec vitest run test/boot.test.ts
```

Expected: FAIL（仍是 `failed`）。

- [ ] **Step 3: 改对账逻辑**

`apps/daemon/src/runtime/boot.ts`：

```ts
for (const task of listTasksByStatus(deps.db, ['running', 'waiting_input'])) {
  apply(task.id, {
    type: 'session_reported',
    outcome: 'unreported',
    reason: 'daemon restarted',
  })
}
```

保留 `verifying` 的 `verify_fail` 与 approval 处理。

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @evanfang0054/baton exec vitest run test/boot.test.ts test/session-runner-attention.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/runtime/boot.ts apps/daemon/test/boot.test.ts
git commit -m "feat(daemon): 重启对账收敛到 waiting_input(stalled)"
```

---

## Task 6: 全量校验与记录

Blocking: Task 1-5
Slice type: verification
Seam: `pnpm verify` / `pnpm verify:full` / `pnpm pack:check`

**Files:**

- Modify: `docs/plans/2026-11-17-m1-7a-foundation.md`（执行记录）

- [ ] **Step 1: 全量校验**

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
```

Expected: 全部退出码 0。

- [ ] **Step 2: 记录**

在文末追加执行记录：测试数量、迁移文件名、关键行为（blocked 不占执行槽、重启进 stalled）。

- [ ] **Step 3: Commit**

```bash
git add docs/plans/2026-11-17-m1-7a-foundation.md
git commit -m "docs(plan): M1-7a 契约与并发基座执行记录"
```

---

## Self-Review

- **Spec coverage**：覆盖 spec §4.1-4.3（trust 字段/migration/API）、§4.5（`session_reported` 扩展）、§7.1-7.2（双上限/重启对账）。
- **Placeholder scan**：无 TBD/TODO；每个 Task 有测试与实现片段。
- **Type consistency**：`Workspace.trusted/projectHooks/trustedAt`、`countLiveSessions`、`maxLiveSessions`、`WorkspaceTrustInput` 在后续 Task 中名称一致。
- **Scope**：只改 protocol/core/daemon/migration；不接真实 Claude、不改 web、不动 Plan A 的 event-store/ws/session-cache。

---

## 执行记录（2026-11-18）

分支 `feat/m1-7a-foundation`，基于 `docs/m1-7-spec`（`6fa6969`）。

**Commit 序列**

- `docs(plan)`：本计划落库。
- `feat(protocol): workspace trust 字段与 migration`：`Workspace` 增加 `trusted/projectHooks/trustedAt`；migration `apps/daemon/migrations/0003_workspace_trust.sql`（`trusted INTEGER NOT NULL DEFAULT false`、`project_hooks TEXT NOT NULL DEFAULT 'off'`、`trusted_at INTEGER`）。
- `feat(daemon): workspace trust API 与审计`：`PATCH /api/workspaces/:id/trust`；审计 `workspace.trust` / `workspace.untrust` / `workspace.project_hooks_changed`；撤销信任时 `trustedAt` 归零但保留 hooks 偏好。
- `feat(core): waiting_input 接受 session_reported`：`unreported → stalled`、`blocked → question`、`dropped → dropped`，不新增事件类型；矩阵测试补 `waiting_input:session_reported`。
- `feat(daemon): 执行槽与 live session 双上限`：`countActiveTasks` 只计 `running|verifying`；新增 `countLiveSessions` 计 `running|waiting_input` session；`BATON_MAX_LIVE_SESSIONS` 默认 5；调度器在 live 到顶时停止启动。
- `feat(daemon): 重启对账收敛到 waiting_input(stalled)`：启动时活跃 session 置 `failed`，任务走 `session_reported(unreported, "daemon restarted")`；`verifying` 仍 `verify_fail(124) → review`；pending approval 记 `approval.expired`。
- 两个补充修复：`style(daemon)` 修 repository 格式；`test(web)` 为 App fixture 补 trust 字段（协议收紧暴露的运行时校验缺口）。

**行为确认**

- blocked 任务释放执行槽，但保留 live session 计数；live 上限独立阻断新启动。
- stalled 任务可 `enqueue` 回到 queued；waiting_input 上的重复上报只刷新 waitingReason。
- 重启不会把正在运行的任务判死，用户可重新入队或取消。

**验证**

- `pnpm verify`：通过（typecheck、lint、format、boundaries、protocol、test、build）。
- `pnpm verify:full`：通过（e2e 1 passed）。
- `pnpm pack:check`：`pack-check ok`，tarball 包含 `dist/migrations/0003_workspace_trust.sql`。
- 测试总数 399：protocol 101、adapters 13、core 98、web 68、daemon 119。
