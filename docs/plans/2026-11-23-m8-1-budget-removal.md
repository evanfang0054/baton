---
spec_ref: ../specs/2026-11-23-m8-attention-gate-authority-design.md
spec_topic: m8-attention-gate-authority
task_count: 4
estimated_phases: [tests, implementation, verification]
dod: "预算从 web/daemon/core/protocol/DB 彻底移除；内部 cost/turn 保留；migration 0016 删除 budget_usd 并迁移旧 budget 等待任务；pnpm verify 全绿"
status: completed
depends_on: none
---

# M8-1 预算彻底移除实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement task-by-task. Steps use `- [ ]` syntax for tracking.

**Goal:** 把任务级预算、budget 等待、提额、预算/成本展示从产品面彻底移除，同时保留内部 cost/turn 采集。

**Architecture:** 采用 expand-contract，先移除 UI 与 daemon 行为，再移除 protocol/core/DB 映射，最后加 migration 删列。每个 task 结束都保持可编译、可回滚。

**Tech Stack:** TypeScript ESM、zod、React 19、Fastify、Drizzle、better-sqlite3、vitest、Playwright。

**关键边界：** 只移除「金钱预算」（task budget / SDK maxBudgetUsd / budget waiting）。**不要动** `packages/core/src/context/assemble.ts` 的上下文预算（字符/token 预算）与 `context_budget_exceeded`。

---

### Task 1: Web 停止展示预算/成本

Blocking: none  
Slice type: refactor  
Seam: component render assertions

**Files:**
- Delete: `apps/web/src/features/tasks/BudgetCard.tsx`
- Delete: `apps/web/src/features/tasks/BudgetCard.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskActions.tsx`
- Modify: `apps/web/src/features/tasks/TaskDetailPanel.tsx`
- Modify: `apps/web/src/features/tasks/TaskCard.tsx`
- Modify: `apps/web/src/features/tasks/ReviewCard.tsx`
- Modify: `apps/web/src/features/tasks/AcceptanceReport.tsx`
- Modify: `apps/web/src/features/canvas/TaskSceneBar.tsx`
- Modify: `apps/web/src/features/canvas/CanvasPanel.tsx`
- Modify: `apps/web/src/features/canvas/nodes/ReviewCardNode.tsx`
- Modify: `apps/web/src/features/canvas/model.ts`
- Test: `apps/web/src/features/tasks/TaskDetailPanel.test.tsx`
- Test: `apps/web/src/features/tasks/TaskCard.test.tsx`
- Test: `apps/web/src/features/tasks/ReviewCard.test.tsx`
- Test: `apps/web/src/features/tasks/AcceptanceReport.test.tsx`
- Test fixtures: `apps/web/src/App.test.tsx`, `apps/web/src/lib/api.test.ts`, `apps/web/src/features/canvas/CanvasPanel.test.tsx`, `apps/web/src/features/canvas/NodePanel.test.tsx`, `apps/web/src/features/canvas/nodes/nodes.test.tsx`, `apps/web/src/features/canvas/InjectContextDialog.test.tsx`, `apps/web/src/features/supervisor/SupervisorMessage.test.tsx`, `apps/web/src/features/supervisor/SupervisorPlanCard.test.tsx`

**Interfaces:**
- Consumes: existing `TaskCard`, `TaskDetailPanel`, `ReviewCard`, `TaskSceneBar`, `AcceptanceReport` props.
- Produces: same components without `budget` props; no UI text matching `任务预算|预算|剩余|超预算|接近预算|累计 \$|成本|turns` except internal context-injection wording.

- [ ] **Step 1: 写失败断言**

在 `TaskDetailPanel.test.tsx` 的 describe 内加入：

```tsx
it('does not render task budget or accumulated cost', async () => {
  renderPanel()
  expect(await screen.findByText('上下文与来源')).toBeInTheDocument()
  expect(screen.queryByText('任务预算')).not.toBeInTheDocument()
  expect(screen.queryByText(/累计 \$/)).not.toBeInTheDocument()
})
```

在 `TaskCard.test.tsx` 加：

```tsx
it('does not render legacy budget badges', () => {
  const legacy = { budgetUsd: 2, spentUsd: 3, remainingUsd: 0, ratio: 1.5, overBudget: true, nearBudget: false, workerCostUsd: 3, verifierCostUsd: 0, turns: 1 }
  render(<TaskCard task={{ ...task, budget: legacy } as unknown as TaskSummary} onSelect={vi.fn()} />)
  expect(screen.queryByText('超预算')).not.toBeInTheDocument()
  expect(screen.queryByText('接近预算')).not.toBeInTheDocument()
})
```

在 `AcceptanceReport.test.tsx` 加：

```tsx
it('does not render cost or budget sections', () => {
  render(<AcceptanceReportView report={report} />)
  expect(screen.queryByText(/成本/)).not.toBeInTheDocument()
  expect(screen.queryByText(/预算/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/tasks/TaskDetailPanel.test.tsx src/features/tasks/TaskCard.test.tsx src/features/tasks/ReviewCard.test.tsx src/features/tasks/AcceptanceReport.test.tsx`  
Expected: 新断言失败（仍渲染预算/成本）。

- [ ] **Step 3: 移除 UI**

- 删除 `BudgetCard.tsx` 与 `BudgetCard.test.tsx`。
- `TaskActions.tsx`：删除 `BudgetCard` import、`budget` prop、`waitingReason === 'budget'` 分支及其类型引用；`waitingReason` 仍可显示为普通等待。
- `TaskDetailPanel.tsx`：删除 `budgetSummary`、`累计 $/turns` 行、传给 `ReviewCard`/`TaskActions` 的 `budget`、`TaskSceneBar` 的 `budget`。
- `TaskCard.tsx`：删除 `task.budget` 徽标。
- `ReviewCard.tsx`：删除 `TaskBudgetSummary` import、`budget` prop 与展示。
- `AcceptanceReport.tsx`：删除成本/预算 section。
- `TaskSceneBar.tsx`：删除 `budget` prop 与 `$spent/$budget` 文本。
- `CanvasPanel.tsx` / `ReviewCardNode.tsx` / `canvas/model.ts`：删除传递/存储的 budget 字段。
- 所有列出的 test fixtures 删除 `budgetUsd`、`budget` 字段；删除 `BudgetCard` 相关测试。

- [ ] **Step 4: 运行并确认通过**

Run: `pnpm --filter @baton/web typecheck && pnpm --filter @baton/web test`  
Expected: PASS；`rg -n "任务预算|超预算|接近预算|累计 \\$|BudgetCard" apps/web/src` 无产品 UI 命中。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "refactor(web): remove budget and cost UI"
```

---

### Task 2: Daemon 停止预算等待/提额/输出

Blocking: Task 1  
Slice type: refactor  
Seam: command handling + adapter start input

**Files:**
- Delete: `apps/daemon/src/budget/service.ts`
- Delete: `apps/daemon/src/runtime/budget-command.ts`
- Delete: `apps/daemon/test/budget-raise.test.ts`
- Delete: `apps/daemon/test/approval-cap.test.ts` 中 budget 相关用例（保留自动批准上限用例）
- Modify: `apps/daemon/src/runtime/session-runner.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/src/runtime/task-service.ts`
- Modify: `apps/daemon/src/supervisor/service.ts`
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Modify: `apps/daemon/src/delivery/service.ts`
- Modify: `apps/daemon/src/acceptance/report-service.ts`
- Modify: `apps/daemon/src/http/tasks.ts`
- Modify: `apps/daemon/test/helpers/runtime.ts`
- Test: `apps/daemon/test/budget-command-removed.test.ts`（新建）

**Interfaces:**
- Consumes: existing `createTestRuntime`, `runtime.handleCommand`, `ScriptedAdapter`.
- Produces: `task.set_budget` command returns `unknown_command`; session start no longer accepts/passes `maxBudgetUsd`; task/detail/supervisor responses no longer include budget summary.

- [ ] **Step 1: 写失败测试**

新建 `apps/daemon/test/budget-command-removed.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { createTestRuntime } from './helpers/runtime.js'

describe('budget command removal', () => {
  it('rejects task.set_budget as unknown command', () => {
    const handle = createTestRuntime()
    const result = handle.runtime.handleCommand({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'task.set_budget',
      payload: { taskId: 'missing', budgetUsd: 3 },
    } as never)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('unsupported_command')
  })
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/budget-command-removed.test.ts`  
Expected: FAIL（当前返回 `task_not_found` 或成功分支）。

- [ ] **Step 3: 移除 daemon 预算行为**

- `session-runner.ts`：删除 `getTaskBudgetState` / `getRemainingBudget` import、`maxBudgetUsd` 参数、预算 error → `budget_exceeded`、预算触发的 `interruptSession`；保留普通 error/failure 记录。
- `runtime/index.ts`：删除 budget service import、`task.set_budget` case、任务列表/详情中的 budget summary、`claudeMaxBudgetUsd` 传参。
- `task-service.ts`：删除 `budgetUsd` 校验、写入与 audit。
- `supervisor/service.ts` / `tools.ts`：删除 verifier budget、`getTaskBudgetSummary`、list/get task 的 budget 字段、create_delivery/create_task 的 `budgetUsd` 参数、prompt 里的预算规则与话术。
- `delivery/service.ts`：删除 `budgetUsd` 输入与创建 task 时传递。
- `acceptance/report-service.ts` / `http/tasks.ts`：删除 budget summary 参数/字段。
- 删除 `budget-command.ts`、`budget/service.ts`、`budget-raise.test.ts`；更新 runtime helper 默认 config，移除 budget 字段。
- `runtime/index.ts` 的 command switch 不再包含 `task.set_budget`，落到 default `unknown_command`。

- [ ] **Step 4: 运行并确认通过**

Run: `pnpm --filter @evanfang0054/baton test`  
Expected: PASS；`rg -n "budget-command|task.set_budget|getRemainingBudget|maxBudgetUsd" apps/daemon/src` 无命中（config 字段除外，下一 task 处理）。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon
git commit -m "refactor(daemon): stop budget waiting and raise behavior"
```

---

### Task 3: 移除 protocol/core/DB 映射中的金钱预算

Blocking: Task 2  
Slice type: refactor  
Seam: schema key assertions + core exports

**Files:**
- Test: `packages/protocol/test/budget-removed.test.ts`（新建）
- Test: `packages/core/test/budget-removed.test.ts`（新建）
- Modify: `packages/protocol/src/entities/task.ts`
- Modify: `packages/protocol/src/enums.ts`
- Modify: `packages/protocol/src/attention.ts`
- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/entities/acceptance.ts`
- Modify: `packages/protocol/src/config.ts`
- Modify: `packages/protocol/src/adapter.ts`
- Modify: `packages/protocol/src/supervisor-action.ts`
- Modify: `packages/protocol/src/task-template.ts`
- Delete: `packages/core/src/budget/state.ts`
- Delete: `packages/core/src/budget/raise.ts`
- Delete: `packages/core/src/budget/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/state-machine/transition.ts`
- Modify: `packages/core/src/state-machine/types.ts`
- Modify: `packages/core/src/state-machine/attention.ts`
- Modify: `packages/core/src/tasks/board.ts`
- Modify: `packages/core/src/acceptance/report.ts`
- Modify: `packages/core/src/supervisor/attention.ts`
- Modify: `packages/core/src/supervisor/templates.ts`
- Modify: `packages/core/test/*`（删除 budget/预算用例，更新 snapshots）
- Modify: `apps/daemon/src/config.ts`
- Modify: `apps/daemon/src/db/schema.ts`
- Modify: `apps/daemon/src/db/repositories.ts`

**Interfaces:**
- Consumes: Task 1/2 已移除所有 UI/daemon 消费方。
- Produces: protocol 不再导出 `TaskBudgetSummary`、`TaskSetBudgetInput`、`budgetUsd`、`budget_exceeded`、`budget_raise`、`waitingReason='budget'`、`AttentionKind='budget'`、`maxBudgetUsd`、budget config；core 不再导出金钱预算 helpers；DB 映射不再读取 `budget_usd`。

- [ ] **Step 1: 写失败测试**

`packages/protocol/test/budget-removed.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { AcceptanceReportFacts, Task, WaitingReason } from '../src/index.js'
import { AttentionCounts, AttentionKind } from '../src/attention.js'
import { TaskSummary } from '../src/api.js'

describe('monetary budget removal', () => {
  it('removes budget enum members and fields', () => {
    expect(WaitingReason.safeParse('budget').success).toBe(false)
    expect(AttentionKind.safeParse('budget').success).toBe(false)
    expect(Object.keys(Task.shape)).not.toContain('budgetUsd')
    expect(Object.keys(TaskSummary.shape)).not.toContain('budget')
    expect(Object.keys(AttentionCounts.shape)).not.toContain('budget')
    expect(Object.keys(AcceptanceReportFacts.shape)).not.toContain('budget')
    expect(Object.keys(AcceptanceReportFacts.shape)).not.toContain('usage')
  })
})
```

`packages/core/test/budget-removed.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import * as core from '../src/index.js'

describe('budget exports removal', () => {
  it('does not export monetary budget helpers', () => {
    expect('budgetState' in core).toBe(false)
    expect('evaluateBudgetRaise' in core).toBe(false)
  })
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/protocol test -- budget-removed && pnpm --filter @baton/core test -- budget-removed`  
Expected: FAIL（字段/导出仍存在）。

- [ ] **Step 3: 删除 protocol/core/DB 预算代码**

- Protocol：删除上述字段/枚举/命令/schema；`TaskSummary`/`TaskDetailResponse`/`TaskAcceptanceResponse` 删除 budget；`AcceptanceReportFacts` 删除 budget 与 usage；`TaskCreateInput` 删除 `budgetUsd`；`TaskSetBudgetInput` 与 `task.set_budget` 命令删除；`ClientCommand` 类型移除；config 删除 `claudeMaxBudgetUsd`/`verifierBudgetUsd`/`maxTaskBudgetUsd`；adapter 删除 `maxBudgetUsd`。
- Core：删除 `src/budget/**` 与导出；state machine 删除 `budget_exceeded`/`budget_raise`、`budgetRemainingUsd`、budget waiting 分支；`state-machine/attention.ts` 不再把 budget 归为需人；`tasks/board.ts` 删除 budget over 判断；`acceptance/report.ts` 删除 budget/usage 与预算风险；`supervisor/attention.ts` 删除 budget kind；`supervisor/templates.ts` 删除 defaultBudgetUsd。
- Daemon config：删除 `claudeMaxBudgetUsd`/`verifierBudgetUsd`/`maxTaskBudgetUsd` 与 env 解析；`bootstrap.ts`/`adapter-factory.ts` 删除 maxBudgetUsd。
- DB：`schema.ts` 删除 `budgetUsd`；`repositories.ts` 删除 `budgetUsd` 映射、`updateTaskBudget`、插入/更新字段；`task-service`/`delivery` 不传 budget。
- 清理所有 imports 与 test fixtures；删除 budget-raise/core budget/exports snapshots 中的金钱预算项。

- [ ] **Step 4: 运行并确认通过**

Run: `pnpm --filter @baton/protocol test && pnpm --filter @baton/core test && pnpm --filter @evanfang0054/baton test && pnpm --filter @baton/web typecheck`  
Expected: PASS；`rg -n "budgetUsd|TaskBudgetSummary|budget_exceeded|budget_raise|task.set_budget|maxBudgetUsd|claudeMaxBudgetUsd" packages apps --glob '!**/dist/**'` 只允许出现在 migration/历史文档中。

- [ ] **Step 5: Commit**

```bash
git add packages/protocol packages/core apps/daemon/src apps/daemon/test
git commit -m "refactor: remove monetary budget from protocol core and db"
```

---

### Task 4: Migration 0016 与最终验证

Blocking: Task 3  
Slice type: refactor  
Seam: migration test

**Files:**
- Create: `apps/daemon/migrations/0016_m8_budget_removal.sql`
- Modify: `apps/daemon/migrations/meta/_journal.json`
- Create: `apps/daemon/migrations/meta/0016_snapshot.json`（由 drizzle-kit 生成或按 0015 snapshot 删除 budget_usd 后复制）
- Create: `apps/daemon/test/migration-0016.test.ts`
- Modify: `apps/daemon/test/migrate.test.ts`（如 schema snapshot 断言需要）
- Modify: `docs/evidence/2026-11-22-m7-delivery/coverage-matrix.md`（记录预算移除完成）

**Interfaces:**
- Consumes: Task 3 后所有代码不再读写 `budget_usd`。
- Produces: migration 0016 删除列；历史 `waiting_input(budget)` 变 `todo`。

- [ ] **Step 1: 写失败 migration 测试**

`apps/daemon/test/migration-0016.test.ts`：

```ts
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDb, openDb } from '../src/db/index.js'

const dirs: string[] = []
const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  delete process.env.BATON_MIGRATIONS_DIR
})

function copyThrough(maxIdx: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-m16-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>
  }
  const entries = journal.entries.filter((entry) => entry.idx <= maxIdx)
  for (const entry of entries) copyFileSync(join(migrationsDir, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`))
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  return dir
}

describe('migration 0016', () => {
  it('drops budget_usd and reopens waiting budget tasks', () => {
    const oldDir = copyThrough(15)
    const raw = openDb(':memory:')
    process.env.BATON_MIGRATIONS_DIR = oldDir
    migrateDb(raw)
    raw.prepare('insert into workspace (id, name, rel_path, created_at) values (?, ?, ?, ?)').run('w1', 'demo', 'demo', 1)
    raw.prepare(`insert into task (id, workspace_id, title, prompt, status, engine, retry_count, dangerously_skip_permissions, budget_usd, waiting_reason, created_at, updated_at) values ('t1','w1','t','p','waiting_input','claude-sdk',0,0,2,'budget',1,1)`).run()
    process.env.BATON_MIGRATIONS_DIR = migrationsDir
    migrateDb(raw)
    const columns = raw.prepare('pragma table_info(task)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).not.toContain('budget_usd')
    expect(raw.prepare('select status, waiting_reason from task where id = ?').get('t1')).toEqual({ status: 'todo', waiting_reason: null })
  })
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/migration-0016.test.ts`  
Expected: FAIL（migration 0016 不存在）。

- [ ] **Step 3: 写 migration 与 snapshot**

`0016_m8_budget_removal.sql`：

```sql
ALTER TABLE `task` DROP COLUMN `budget_usd`;
UPDATE `task`
SET `status` = 'todo',
    `waiting_reason` = NULL,
    `updated_at` = `updated_at`
WHERE `status` = 'waiting_input' AND `waiting_reason` = 'budget';
```

在 `_journal.json` 追加：

```json
{ "idx": 16, "version": "6", "when": 1795430000000, "tag": "0016_m8_budget_removal", "breakpoints": true }
```

用 `pnpm --filter @evanfang0054/baton exec drizzle-kit generate` 或按 `0015_snapshot.json` 删除 `budget_usd` 后生成 `0016_snapshot.json`。确保 `apps/daemon/scripts/copy-migrations.mjs` 会复制它。

- [ ] **Step 4: 运行 migration 与全量验证**

Run:

```bash
pnpm --filter @evanfang0054/baton exec vitest run test/migration-0016.test.ts test/migrate.test.ts
pnpm verify
```

Expected: PASS；migration 测试通过；全仓 typecheck/lint/format/boundaries/protocol/test/build/bundle 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/migrations apps/daemon/test docs/evidence/2026-11-22-m7-delivery/coverage-matrix.md
git commit -m "refactor(daemon): migrate away monetary budget column"
```

---

## Plan 完成定义

- Web 不再出现任务预算/提额/成本/turn 展示。
- Daemon 不再产生 `waiting_input(budget)`，`task.set_budget` 返回 unknown command，adapter start 不含 `maxBudgetUsd`。
- Protocol/core 不再导出金钱预算类型/命令/枚举/helpers；context budget 不受影响。
- Migration 0016 删除 `budget_usd`，旧 budget 等待任务变 todo。
- 内部 session `costUsd/turns` 仍采集（测试断言）。
- `pnpm verify` 全绿，四个 task 各自有 commit。
