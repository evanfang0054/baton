---
spec_ref: ../specs/2026-11-19-m2-autopilot-design.md
spec_topic: m2-autopilot-v0
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: "policy 写入/审计、kill switch、automation REST、notice/audit/task-automation REST、digest 调度与 notice 广播、runtime 动态接线完成；daemon 集成测试与 pnpm verify 全绿"
depends_on: [2026-11-19-m2-autopilot-contracts.md]
status: completed
---

# M2-2a 无人值守与汇报：daemon 实施计划（Plan 2/4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选。

**Goal:** 在契约层之上实现自动化控制面、digest 调度与 notice/audit 查询，并把 kill switch、workspace trust、policyVersion 接进现有 runtime。

**Architecture:** `apps/daemon/src/automation/**` 承载 policy 读写、kill switch 状态、digest 生成与调度；HTTP 路由保持薄，只做 schema 校验与 service 调用；runtime 通过 getter 读取动态 kill switch，不重启 daemon。

**Tech Stack:** TypeScript ESM、Fastify 5、Drizzle ORM、croner（候选 MIT）、vitest。

---

## 计划地图

| Plan | 范围 | 状态 |
|---|---|---|
| 1. 契约层 | protocol / core / migration / 仓储 | 前置 |
| **2. daemon（本计划）** | policy / kill switch / digest / notice & audit / runtime | 已完成 |
| 3. web | 设置弹窗 / 顶栏状态 / digest 卡 / 任务自动化卡 / 批量开工 | 依赖 2 |
| 4. 验收 | Playwright / ego-lite / 证据 / 全量验证 | 依赖 3 |

**GDD:** 按仓库先例显式跳过；测试设计由 contract 14 条 DoD 与任务内测试承担。

**Commit strategy:** 每个 Task 结束提交一次；Task 5 跑 `pnpm verify`。

**测试 helper 约定**：本计划的 daemon 测试统一在 `apps/daemon/test/helpers/runtime.ts` 扩展以下方法，形状沿用现有 `createTestRuntime`：

```ts
export interface TestRuntimeHandle {
  seedWorkspace(options?: { trusted?: boolean }): { id: string; relPath: string }
  seedTask(workspaceId: string, options?: { taskStatus?: TaskStatus }): { taskId: string }
  seedTaskWithAutoApproval(): { taskId: string; approvalId: string }
  seedRunningTask(): { taskId: string; sessionId: string }
  seedTaskInVerifying(): { taskId: string; reviewId: string }
  emitApproval(taskId: string, request: ApprovalRequest): Promise<void>
  approvals(taskId: string): Approval[]
}
```

---

## Task 1: policy 写入、automation state/service 与 HTTP 控制面

Blocking: Plan 1
Slice type: tracer-bullet
Seam: `GET/PATCH /api/workspaces/:id/automation` 与 `PUT /api/automation/kill-switch`

**Files：**

- Modify: `apps/daemon/src/workspace/policy.ts`
- Create: `apps/daemon/src/automation/version.ts`
- Create: `apps/daemon/src/automation/state.ts`
- Create: `apps/daemon/src/automation/service.ts`
- Create: `apps/daemon/src/http/automation.ts`
- Modify: `apps/daemon/src/app.ts`
- Create: `apps/daemon/test/automation-service.test.ts`
- Create: `apps/daemon/test/automation-rest.test.ts`
- Modify: `apps/daemon/test/policy.test.ts`

**Interfaces：**

- Produces: `writePolicy(workspacePath, policy): { policyVersion: string }`；`createAutomationState({ initial, forced })`；`createAutomationService({ db, config, state, now, newId })`，含 `getSummary/patchPolicy/setKillSwitch`；`registerAutomationRoutes(app, deps)`。
- Consumes: `PolicySchema`、`AutomationPolicyPatch`、`AutomationSummary`、`KillSwitchInput/Response`、`resolveWithin`、`getWorkspace`、`insertAudit`、`getSetting/setSetting`。

- [x] **Step 1: 写失败测试**

`apps/daemon/test/automation-service.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { PolicySchema } from '@baton/protocol'
import { createAutomationService } from '../src/automation/service.js'
import { createAutomationState } from '../src/automation/state.js'
import { createTestDb, seedTask } from './helpers/db.js'

describe('automation service', () => {
  it('rejects policy changes for an untrusted workspace', () => {
    const { db, raw } = createTestDb()
    const seeded = seedTask(raw)
    const service = createAutomationService({
      db,
      config: { killSwitch: false } as never,
      state: createAutomationState({ initial: false, forced: false }),
      now: () => 10,
      newId: () => 'audit-1',
    })
    expect(() =>
      service.patchPolicy(seeded.workspaceId, { autopilot: { enabled: true } }),
    ).toThrowError(/not trusted/)
  })

  it('does not allow disabling an env-forced kill switch', () => {
    const { db } = createTestDb()
    const service = createAutomationService({
      db,
      config: { killSwitch: true } as never,
      state: createAutomationState({ initial: true, forced: true }),
      now: () => 10,
      newId: () => 'audit-1',
    })
    expect(() => service.setKillSwitch(false)).toThrowError(/kill_switch_forced/)
  })
})
```

`apps/daemon/test/automation-rest.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/app.js'

describe('automation REST', () => {
  it('returns a summary and rejects unexpected patch fields', async () => {
    const { app, handle } = await buildTestApp()
    const workspace = handle.seedWorkspace()
    const response = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${workspace.id}/automation`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ workspaceId: workspace.id, trusted: false })

    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${workspace.id}/automation`,
      payload: { autopilot: { enabled: true, extra: true } },
    })
    expect(invalid.statusCode).toBe(400)
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/automation-service.test.ts test/automation-rest.test.ts`
Expected: FAIL，提示模块或路由不存在。

- [x] **Step 3: 实现 policy 写入**

`apps/daemon/src/workspace/policy.ts` 增加：

```ts
export function writePolicy(workspacePath: string, policy: Policy): { policyVersion: string } {
  const batonDir = resolveWithin(workspacePath, '.baton')
  mkdirSync(batonDir, { recursive: true })
  const realRoot = realpathSync(workspacePath)
  const realDir = realpathSync(batonDir)
  if (realDir !== realRoot && !realDir.startsWith(`${realRoot}${sep}`)) {
    throw appError('policy_write_failed', 'policy directory escapes workspace')
  }
  const parsed = PolicySchema.parse(policy)
  const file = join(realDir, 'policy.json')
  const temp = join(realDir, `.policy.${process.pid}.tmp`)
  writeFileSync(temp, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, file)
  return { policyVersion: hashPolicy(parsed) }
}
```

`apps/daemon/src/automation/version.ts`：

```ts
import { createHash } from 'node:crypto'
import type { Policy } from '@baton/protocol'

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    )
  }
  return value
}

export function hashPolicy(policy: Policy): string {
  return createHash('sha256').update(JSON.stringify(stable(policy))).digest('hex').slice(0, 12)
}
```

- [x] **Step 4: 实现 state/service**

`automation/state.ts`：

```ts
export interface AutomationState {
  isKillSwitchOn(): boolean
  isForced(): boolean
  setKillSwitch(enabled: boolean): void
}

export function createAutomationState(input: { initial: boolean; forced: boolean }): AutomationState {
  let enabled = input.forced || input.initial
  return {
    isKillSwitchOn: () => enabled,
    isForced: () => input.forced,
    setKillSwitch: (next) => {
      enabled = input.forced || next
    },
  }
}
```

`automation/service.ts`：

```ts
export function createAutomationService(deps: AutomationServiceDeps) {
  function getSummary(workspaceId: string): AutomationSummary {
    const workspace = getWorkspace(deps.db, workspaceId)
    if (!workspace) throw appError('workspace_not_found', 'workspace not found')
    const policyPath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
    const policy = loadPolicy(policyPath)
    return AutomationSummary.parse({
      workspaceId,
      trusted: workspace.trusted,
      policy,
      policyVersion: hashPolicy(policy),
      killSwitch: deps.state.isKillSwitchOn(),
      killSwitchForced: deps.state.isForced(),
      digestCronUnsupported: false,
    })
  }

  function patchPolicy(workspaceId: string, patch: AutomationPolicyPatch): AutomationSummary {
    const workspace = getWorkspace(deps.db, workspaceId)
    if (!workspace) throw appError('workspace_not_found', 'workspace not found')
    if (!workspace.trusted) throw appError('workspace_untrusted', 'workspace is not trusted')
    const workspacePath = resolveWorkspaceDir(deps.config.workspacesRoot, workspace.relPath)
    const current = loadPolicy(workspacePath)
    const next: Policy = {
      ...current,
      autopilot: { ...current.autopilot, ...patch.autopilot },
      approval: { ...current.approval, ...patch.approval },
    }
    const { policyVersion } = writePolicy(workspacePath, next)
    deps.db.transaction((tx) =>
      insertAudit(tx, {
        id: deps.newId(),
        ts: deps.now(),
        actor: 'user',
        action: 'automation.policy.update',
        detail: { workspaceId, patch, policyVersion },
      }),
    )
    return getSummary(workspaceId)
  }

  function setKillSwitch(enabled: boolean): KillSwitchResponse {
    if (deps.state.isForced() && !enabled) {
      throw appError('kill_switch_forced', 'kill switch is forced by environment')
    }
    deps.state.setKillSwitch(enabled)
    deps.db.transaction((tx) => {
      setSetting(tx, 'kill_switch', { enabled }, deps.now())
      insertAudit(tx, {
        id: deps.newId(),
        ts: deps.now(),
        actor: 'user',
        action: 'automation.kill_switch',
        detail: { enabled },
      })
    })
    return { killSwitch: deps.state.isKillSwitchOn(), killSwitchForced: deps.state.isForced() }
  }

  return { getSummary, patchPolicy, setKillSwitch, isForced: () => deps.state.isForced() }
}
```

`setKillSwitch` 不依赖 workspace；路由返回 `KillSwitchResponse` 即可，不返回 summary。

- [x] **Step 5: 注册 HTTP 路由**

`http/automation.ts`：

```ts
export function registerAutomationRoutes(
  app: FastifyInstance,
  deps: { service: AutomationService },
): void {
  app.get('/api/workspaces/:id/automation', async (req) => {
    const { id } = req.params as { id: string }
    return deps.service.getSummary(id)
  })

  app.patch('/api/workspaces/:id/automation', async (req) => {
    const { id } = req.params as { id: string }
    const parsed = AutomationPolicyPatch.safeParse(req.body)
    if (!parsed.success) throw appError('invalid_policy', 'invalid policy patch', parsed.error.issues)
    return deps.service.patchPolicy(id, parsed.data)
  })

  app.put('/api/automation/kill-switch', async (req) => {
    const parsed = KillSwitchInput.safeParse(req.body)
    if (!parsed.success) throw appError('invalid_payload', 'invalid kill switch payload')
    return KillSwitchResponse.parse(deps.service.setKillSwitch(parsed.data.enabled))
  })
}
```

`app.ts` 在 `registerTaskRoutes` 之前/后注册 `registerAutomationRoutes`。

- [x] **Step 6: 运行测试与 daemon 全量测试**

Run: `pnpm --filter @evanfang0054/baton test`
Expected: PASS；如 `seedWorkspace` 不存在，在 `test/helpers/runtime.ts` 补一个返回 trusted=false 的 helper。

- [x] **Step 7: Commit**

```bash
git add apps/daemon/src apps/daemon/test
git commit -m "feat(daemon): 自动化策略与 kill switch 控制面"
```

---

## Task 2: notice / audit / task automation 查询接口

Blocking: Task 1
Slice type: tracer-bullet
Seam: `GET /api/notices`、`POST /api/notices/:id/read`、`GET /api/audit`、`GET /api/tasks/:id/automation`

**Files：**

- Create: `apps/daemon/src/http/notices.ts`
- Create: `apps/daemon/src/http/audit.ts`
- Modify: `apps/daemon/src/http/tasks.ts`
- Modify: `apps/daemon/src/app.ts`
- Create: `apps/daemon/test/notices-rest.test.ts`
- Create: `apps/daemon/test/task-automation.test.ts`

**Interfaces：**

- Produces: notice 分页/已读、audit 分页、`TaskAutomationSummary`。
- Consumes: `listNotices/markNoticeRead/listAudit/listApprovalsByTask/getTaskDetail/getReviewByTask`。

- [x] **Step 1: 写失败测试**

`apps/daemon/test/notices-rest.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/app.js'

describe('notices REST', () => {
  it('lists and marks notices read', async () => {
    const { app, handle } = await buildTestApp()
    const workspace = handle.seedWorkspace()
    handle.insertDigestNotice(workspace.id, 'n1')

    const list = await app.inject({
      method: 'GET',
      url: `/api/notices?workspaceId=${workspace.id}`,
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().notices).toHaveLength(1)

    const read = await app.inject({ method: 'POST', url: '/api/notices/n1/read' })
    expect(read.statusCode).toBe(200)
    const after = await app.inject({
      method: 'GET',
      url: `/api/notices?workspaceId=${workspace.id}`,
    })
    expect(after.json().notices[0].readAt).not.toBeNull()
  })
})
```

`apps/daemon/test/task-automation.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/app.js'

describe('task automation', () => {
  it('returns auto decisions without transcript or prompt', async () => {
    const { app, handle } = await buildTestApp()
    const { taskId } = handle.seedTaskWithAutoApproval()
    const response = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/automation` })
    expect(response.statusCode).toBe(200)
    expect(response.json().autoDecisions).toHaveLength(1)
    expect(response.body).not.toContain('<task>')
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/notices-rest.test.ts test/task-automation.test.ts`
Expected: FAIL，路由 404 或 helper 不存在。

- [x] **Step 3: 实现路由与查询**

`http/notices.ts`：

```ts
export function registerNoticeRoutes(app: FastifyInstance, deps: { db: Db }): void {
  app.get('/api/notices', async (req) => {
    const parsed = NoticeListQuery.safeParse(req.query)
    if (!parsed.success) throw appError('invalid_payload', 'invalid notice query')
    const notices = listNotices(deps.db, parsed.data)
    return NoticeListResponse.parse({
      notices,
      ...(notices.length === parsed.data.limit
        ? { nextBefore: notices.at(-1)?.ts }
        : {}),
    })
  })

  app.post('/api/notices/:id/read', async (req) => {
    const { id } = req.params as { id: string }
    deps.db.transaction((tx) => markNoticeRead(tx, id, Date.now()))
    return { ok: true }
  })
}
```

`http/audit.ts` 按 `AuditListQuery` 返回 `AuditListResponse`；`http/tasks.ts` 增加：

```ts
app.get('/api/tasks/:id/automation', async (req) => {
  const { id } = req.params as { id: string }
  const detail = getTaskDetail(deps.db, id)
  if (!detail) throw appError('task_not_found', 'task not found')
  const approvals = listApprovalsByTask(deps.db, id).filter((item) => item.decidedBy === 'auto')
  const autoAudits = listAudit(deps.db, { actionPrefix: 'approval.auto_', limit: 100 }).entries
  const policyByApproval = new Map(
    autoAudits
      .map((entry) => [String((entry.detail as { approvalId?: string }).approvalId ?? ''), entry])
      .filter(([approvalId]) => approvalId.length > 0),
  )
  const retryAudits = listAudit(deps.db, { actionPrefix: 'task.retry', limit: 100 }).entries
  const taskRetryAudits = retryAudits
    .filter((entry) => (entry.detail as { taskId?: string }).taskId === id)
    .sort((a, b) => b.ts - a.ts)
  return TaskAutomationSummary.parse({
    taskId: id,
    retryCount: detail.task.retryCount,
    lastVerifyExitCode: detail.review?.verifyExitCode ?? null,
    lastPolicyVersion:
      (taskRetryAudits[0]?.detail as { policyVersion?: string } | undefined)?.policyVersion ?? null,
    autoDecisions: approvals.map((item) => ({
      approvalId: item.id,
      decision: item.decision,
      toolName: item.request.toolName,
      risk: item.request.risk,
      decidedAt: item.decidedAt,
      policyVersion:
        (policyByApproval.get(item.id)?.detail as { policyVersion?: string } | undefined)
          ?.policyVersion ?? null,
    })),
  })
})
```

- [x] **Step 4: 运行测试与 daemon 全量测试**

Run: `pnpm --filter @evanfang0054/baton test`
Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add apps/daemon/src apps/daemon/test
git commit -m "feat(daemon): notice、audit 与任务自动化查询"
```

---

## Task 3: digest 生成、调度与 NoticeEvent 广播

Blocking: Task 1
Slice type: tracer-bullet
Seam: `POST /api/workspaces/:id/digest` 产生 `notice` + `notice` WS 事件

**Files：**

- Create: `apps/daemon/src/automation/digest.ts`
- Create: `apps/daemon/src/automation/scheduler.ts`
- Modify: `apps/daemon/src/runtime/index.ts`（`publishNotice`）
- Create: `apps/daemon/test/automation-digest.test.ts`
- Create: `apps/daemon/test/automation-scheduler.test.ts`
- Modify: `apps/daemon/src/app.ts`（注册 `POST /digest`）

**Interfaces：**

- Produces: `createDigestService({ db, config, eventStore, broadcast, now, newId })`，含 `generate(workspaceId, trigger)` 与 `publish(notice)`；`createDigestScheduler({ deps, schedule })`，含 `start/reschedule/stop`。
- Consumes: `buildDigest`、`listTasks`、`listAutoDecisions`、`listRetryAudits`、`insertNotice`、`setSetting`、`eventStore.appendWs`、`hooks.broadcast`。

- [x] **Step 1: 写失败测试**

`apps/daemon/test/automation-digest.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/app.js'

describe('digest service', () => {
  it('creates a digest notice through the REST endpoint', async () => {
    const { app, handle } = await buildTestApp()
    const workspace = handle.seedWorkspace({ trusted: true })
    handle.seedTask(workspace.id, { taskStatus: 'review' })

    const response = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.id}/digest`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().notice).toMatchObject({
      kind: 'digest',
      workspaceId: workspace.id,
    })
  })
})
```

`apps/daemon/test/automation-scheduler.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import { createDigestScheduler } from '../src/automation/scheduler.js'

describe('digest scheduler', () => {
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
    scheduler.stop()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/automation-digest.test.ts test/automation-scheduler.test.ts`
Expected: FAIL，模块不存在。

- [x] **Step 3: 实现 digest service**

`automation/digest.ts`：

- `generate(workspaceId, trigger)`：
  - `getWorkspace`，`loadPolicy`，`listTasks`，`listAutoDecisionsSince`，`listRetryAuditsSince`，`completedAtByTask`。
  - `last = getSetting(db, 'digest:last:' + workspaceId)?.at ?? now - 12h`。
  - `buildDigest` 后，`db.transaction` 内 `insertNotice`、`setSetting`、`eventStore.appendWs(tx, { type:'notice', payload: notice, ts: now })`。
  - 返回 `{ notice, event }`；路由提交后 `broadcast(event)`。
- `publish(notice)` 用于手动广播；`notice` row 必须已落库。
- 定时无任务时返回 `null`；手动始终返回。

- [x] **Step 4: 实现 scheduler**

`automation/scheduler.ts`：

```ts
export interface DigestSchedule {
  stop(): void
}
export interface DigestSchedulerDeps {
  listWorkspaces(): Array<{ id: string; trusted: boolean; digestCron: string }>
  generate(workspaceId: string): Promise<unknown>
  schedule(cron: string, run: () => void): DigestSchedule
}

export function createDigestScheduler(deps: DigestSchedulerDeps) {
  let jobs: DigestSchedule[] = []
  function stop() {
    jobs.forEach((job) => job.stop())
    jobs = []
  }
  function start() {
    stop()
    for (const workspace of deps.listWorkspaces()) {
      if (!workspace.trusted) continue
      jobs.push(deps.schedule(workspace.digestCron, () => void deps.generate(workspace.id)))
    }
  }
  return { start, stop, reschedule: start }
}
```

生产 `schedule` 用 `croner`；测试用 fake schedule。`croner` 不支持时 `start` 跳过定时并设置 `digestCronUnsupported`（service summary 读取一个内存标记）。

- [x] **Step 5: 注册手动生成路由**

`POST /api/workspaces/:id/digest` → `digest.generate(id, 'manual')`；成功后 `broadcast(event)`，返回 `{ notice }`。定时任务同样在生成后广播。

- [x] **Step 6: 运行测试与 daemon 全量测试**

Run: `pnpm --filter @evanfang0054/baton test`
Expected: PASS；notice 事件可在 `ws_event` 中查到。

- [x] **Step 7: Commit**

```bash
git add apps/daemon/src apps/daemon/test
git commit -m "feat(daemon): digest 生成、调度与 notice 广播"
```

---

## Task 4: runtime 动态接线（kill switch / trust / policyVersion / scheduler 生命周期）

Blocking: Tasks 1–3
Slice type: tracer-bullet
Seam: 运行中打开 kill switch 后，下一次审批回 ask、verify_fail 进 review；重启后状态保留

**Files：**

- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/src/runtime/session-runner.ts`
- Modify: `apps/daemon/src/runtime/transition-runner.ts`
- Modify: `apps/daemon/src/runtime/effects.ts`
- Modify: `apps/daemon/src/bootstrap.ts`
- Modify: `apps/daemon/test/helpers/runtime.ts`
- Create: `apps/daemon/test/automation-runtime.test.ts`

**Interfaces：**

- Produces: `SessionRunnerDeps.killSwitch: () => boolean`；`TransitionRunnerDeps.killSwitch: () => boolean`；`createRuntime` 返回 `automation` 与 `digest`；`Runtime.close()` 先停 scheduler。
- Consumes: `AutomationState`、`AutomationService`、`DigestScheduler`、`getWorkspace`、`hashPolicy`。

- [x] **Step 1: 写失败测试**

`apps/daemon/test/automation-runtime.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { createTestRuntime } from './helpers/runtime.js'

describe('automation runtime', () => {
  it('stops auto-approving immediately after kill switch is enabled', async () => {
    const handle = await createTestRuntime({ trusted: true, autopilot: true })
    const task = handle.seedRunningTask()
    expect(handle.runtime.automation.setKillSwitch(true)).toBeTruthy()
    await handle.emitApproval(task.taskId, {
      toolName: 'Bash',
      input: { command: 'pnpm test' },
      risk: 'low',
    })
    expect(handle.approvals(task.taskId).at(-1)?.decidedBy).toBeNull()
  })

  it('does not retry verify_fail when kill switch is on', async () => {
    const handle = await createTestRuntime({ trusted: true, autopilot: true, killSwitch: true })
    const task = handle.seedTaskInVerifying()
    handle.runtime.applyTransition(task.taskId, {
      type: 'verify_fail',
      reviewId: 'r1',
      exitCode: 1,
      output: 'fail',
      diffStat: { files: 0, additions: 0, deletions: 0 },
    })
    expect(handle.runtime.getTask(task.taskId)?.status).toBe('review')
  })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/automation-runtime.test.ts`
Expected: FAIL，helper 或 dynamic kill switch 不存在。

- [x] **Step 3: 改 session-runner**

`SessionRunnerDeps.killSwitch` 改为 `() => boolean`；`handleApproval`：

```ts
const task = getTask(deps.db, active.taskId)
const workspace = task ? getWorkspace(deps.db, task.workspaceId) : null
const decision = evaluateApproval(policy, request, {
  killSwitch: deps.killSwitch(),
  workspaceTrusted: workspace?.trusted === true,
})
```

audit detail 增加 `policyVersion: hashPolicy(policy)`。

- [x] **Step 4: 改 transition-runner / effects**

`TransitionRunnerDeps` 增加 `killSwitch: () => boolean`；`start`/`verify_fail` 传入：

```ts
transition(
  {
    status: task.status,
    retryCount: task.retryCount,
    runningCount: countActiveTasks(deps.db),
    maxConcurrency: deps.config.maxConcurrency,
    autopilot: policy.autopilot,
    workspaceTrusted: workspace?.trusted === true,
    killSwitch: deps.killSwitch(),
    waitingReason: task.waitingReason,
  },
  event,
)
```

`effects.ts` 的 `task.retry` audit detail 增加：

```ts
detail: {
  taskId: ctx.task.id,
  retryCount: ctx.retryCount,
  workspaceId: ctx.task.workspaceId,
  policyVersion: hashPolicy(ctx.policy),
}
```

- [x] **Step 5: 改 runtime/bootstrap**

`createRuntime` 创建 `automationState`、`automationService`、`digestService`、`digestScheduler`；`sessionRunner` 传 `killSwitch: () => automationState.isKillSwitchOn()`；`transitionRunner` 同样；`close` 先 `digestScheduler.stop()`，再 `supervisor.close()`。

`bootstrap` 先读 `getSetting(orm, 'kill_switch')`，传 `initialKillSwitch` 给 `createRuntime`；runtime 启动后 `digestScheduler.start()`。

`createTestRuntime` 增加 `trusted/autopilot/killSwitch` 选项，并在 seed 时写 policy/trust。

- [x] **Step 6: 运行 daemon 全量测试**

Run: `pnpm --filter @evanfang0054/baton test`
Expected: PASS；现有 session-runner/transition-runner 测试按新签名更新。

- [x] **Step 7: Commit**

```bash
git add apps/daemon/src apps/daemon/test
git commit -m "feat(daemon): runtime 接入动态 kill switch 与 digest"
```

---

## Task 5: daemon 集成验收与完成记录

Blocking: Tasks 1–4
Slice type: verification
Seam: `pnpm verify` 退出码 0；自动化闭环集成测试通过

**Files：**

- Create: `apps/daemon/test/automation-e2e.test.ts`
- Modify: 本计划末尾「完成记录」
- Modify: `docs/README.md`（如 plan 索引尚未加入）

- [x] **Step 1: 写集成测试**

`apps/daemon/test/automation-e2e.test.ts` 覆盖：

1. trusted workspace + autopilot → 低风险审批 `decidedBy='auto'`，audit 带 policyVersion。
2. kill switch on → 审批不自动通过；`verify_fail` 进 review。
3. `POST /digest` → notice 落库、`ws_event` 有 `notice`、`last_digest_at` 更新。
4. untrusted workspace 写 policy `autopilot.enabled=true` → 审批仍 ask。
5. migration 0007 后旧 notice 的 `workspaceId` 为 null。

- [x] **Step 2: 运行全量校验**

```bash
pnpm verify
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

Expected: 全部退出码 0。

- [x] **Step 3: 记录完成情况**

在本计划末尾追加：

```md
## 完成记录（YYYY-MM-DD）

- 关键 commit：
- 测试结果：
- 与计划的偏差：
- 未解决风险：
```

- [x] **Step 4: Commit**

```bash
git add apps/daemon/test docs/plans/2026-11-19-m2-autopilot-daemon.md
git commit -m "docs(plan): 记录 M2-2a daemon 完成"
```

---

## 完成记录（2026-11-19）

- 关键 commit：`cf57615` policy 写入/automation service/HTTP 控制面；`6079c93` notice/audit/task-automation 查询；`3effb2e` digest 生成/调度/notice 广播；`f542dc0` runtime 动态 kill switch、digest 生命周期与 policyVersion 审计。
- 测试结果：daemon 53 files / 193 tests；protocol 119、core 121、adapters 25、web 115；`pnpm verify` 退出码 0。
- 与计划的偏差：未引入 `croner`，改用内置 `parseDailyCron` + `setTimeout` 支持默认 `m h[,h...] * * *`；不支持的自定义 cron 保留手动生成。`digestCronUnsupported` 字段暂固定 false（默认 cron 可解析），后续如需任意 cron 再接回。
- 未解决风险：Digest 生成对每个 task 做 approval/review 查询（N+1），任务量大时再测量优化；Policy 文件与 audit 仍非同一事务（ADR 0006 已记录）。

---

