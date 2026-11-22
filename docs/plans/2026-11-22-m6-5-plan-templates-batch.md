---
spec_ref: ../specs/2026-11-22-m6-5-supervisor-autonomy-design.md
spec_topic: m6-5-supervisor-autonomy
task_count: 6
estimated_phases: [tests, implementation, verification]
dod: "4 个模板、plan_tasks 预览、human-only plan apply、batch_tasks/dryRun、建单上下文摘要、工具面 21、计划卡；pnpm verify 全绿"
status: planned
depends_on: [2026-11-22-m6-5-governance.md, 2026-11-22-m6-5-attention-failure.md]
---

# M6-5 Plan C：计划、模板与批量

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `agent-harness:subagent-driven-development`（推荐）或 `agent-harness:executing-plans`，按 task 逐条执行。

**Goal:** 总管批量建单前先给一张可确认的计划卡；计划只能由人点击应用，模型只能忽略；批量 enqueue/retry/cancel 支持 dryRun，cancel 排除 running；4 个模板提供稳定的标题、验收 seed 和上下文规则。

**Architecture:** 协议层加 `TaskTemplate` 与计划结果类型；core 提供模板、计划构建/校验、上下文摘要纯函数；daemon 新增 `plan_tasks`、`batch_tasks`、`decide_action`，plan apply 在 runtime 内执行，action service 只负责状态机；web 在 SupervisorMessage 内渲染计划卡，通过 WS apply/ignore。工具面从 18 扩到 21。

**Tech Stack:** TypeScript ESM、zod 4、Drizzle/better-sqlite3、React 19 + TanStack Query + HeroUI v3、vitest、Playwright（mock WS）。

**Design sync:**
- 计划卡沿用 `rounded-lg border border-separator bg-background p-3`；模板 chip 用 `Chip variant="soft" color="accent"`；验收 seed 用 `text-xs text-muted` 列表。
- 应用/忽略按钮主次分明：应用 `primary`，忽略 `tertiary`；过期/失败原因用 `text-danger`，部分失败逐条列出。
- 移动端计划卡 `flex-col`，按钮占满宽度；不新增独立页面。

**Contract mapping:**
- DoD 18：1-6 条、只写 proposed、不建任务、校验 source/context/target、返回模板/上下文/引擎/预算。
- DoD 19：只有 human WS 可 apply；模型 `decide_action(apply)` 拒绝；重复 apply 幂等；部分失败 `applied + result.failed[]`。
- DoD 20：4 个模板字段完整；验收 seed 只进 verifier prompt。
- DoD 21：dryRun、batch_tasks、cancel 排除 running。
- DoD 22：建单上下文摘要最多 5 条，不含 transcript/文件正文。
- DoD 25：工具面 18→21，prompt 预算 +15%。

**Commit strategy:** 每个 task 末尾一次 commit。

---

### Task C1: 模板、计划与上下文摘要协议/core

Blocking: Plan B 完成
Slice type: tracer-bullet
Seam: 纯函数单测

**Files:**
- Create: `packages/protocol/src/task-template.ts`
- Modify: `packages/protocol/src/supervisor.ts`（TaskOrigin 加 `templateId`/`acceptanceSeed`）
- Modify: `packages/core/src/supervisor/origin.ts`（BuildTaskOriginInput 透传 `templateId`/`acceptanceSeed`）
- Modify: `packages/protocol/src/supervisor-action.ts`（`PlanToolResult`）
- Modify: `packages/protocol/src/index.ts`
- Create: `packages/core/src/supervisor/templates.ts`
- Create: `packages/core/src/supervisor/plan.ts`
- Create: `packages/core/src/supervisor/context-digest.ts`
- Modify: `packages/core/src/supervisor/index.ts`
- Test: `packages/core/test/supervisor-templates.test.ts`
- Test: `packages/core/test/supervisor-plan.test.ts`
- Test: `packages/core/test/task-context-digest.test.ts`
- Test: `packages/protocol/test/supervisor.test.ts`（旧 origin 仍可解析）

**Interfaces:**
- Consumes: A1 `PlanItem`/`PlanPayload`/`TaskTemplateId`；A3 `isActionExpired`。
- Produces: `TaskTemplate`、`PlanToolResult`、`TASK_TEMPLATES`、`matchTemplate`、`templateById`、`buildPlan`、`validatePlanApply`、`buildTaskContextDigest`。

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/test/supervisor-templates.test.ts
import { describe, expect, it } from 'vitest'
import { matchTemplate, TASK_TEMPLATES, templateById } from '../src/supervisor/templates.js'

describe('task templates', () => {
  it('ships four complete templates', () => {
    expect(TASK_TEMPLATES.map((template) => template.id)).toEqual([
      'bugfix',
      'feature',
      'review',
      'handoff',
    ])
    for (const template of TASK_TEMPLATES) {
      expect(template.label.length).toBeGreaterThan(0)
      expect(template.titlePattern).toContain('{goal}')
      expect(template.acceptanceSeed.length).toBeGreaterThanOrEqual(3)
      expect(template.acceptanceSeed.length).toBeLessThanOrEqual(5)
      expect(template.acceptanceSeed.every((seed) => seed.length <= 200)).toBe(true)
    }
  })

  it('matches intent without forcing a template', () => {
    expect(matchTemplate('修复登录页崩溃')).toBe('bugfix')
    expect(matchTemplate('审查这次改动')).toBe('review')
    expect(matchTemplate('把结果交接给 B')).toBe('handoff')
    expect(matchTemplate('做一个新功能')).toBe('feature')
    expect(matchTemplate('帮我看看')).toBeNull()
    expect(templateById('bugfix')?.titlePattern).toBe('修复：{goal}')
  })
})
```

```ts
// packages/core/test/supervisor-plan.test.ts
import { describe, expect, it } from 'vitest'
import { buildPlan, validatePlanApply } from '../src/supervisor/plan.js'
import type { SupervisorAction } from '@baton/protocol'

const source = { nodeIds: ['n1', 'n2'] }

const action: SupervisorAction = {
  id: 'a1',
  workspaceId: 'w1',
  threadId: 'th1',
  taskId: null,
  kind: 'triage_plan',
  status: 'proposed',
  strength: 'inferred',
  mode: 'observe',
  reason: '计划',
  payload: {},
  result: null,
  policyVersion: 'p1',
  mandateVersion: null,
  dedupeKey: 'plan:1',
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 100,
  appliedAt: null,
  ignoredAt: null,
}

describe('buildPlan', () => {
  it('dedupes context, excludes source nodes and expires in 24h', () => {
    const built = buildPlan({
      triggerId: 'trigger-1',
      source,
      templateId: 'bugfix',
      items: [
        {
          title: '修复登录',
          templateId: 'bugfix',
          targetNodeId: null,
          agentTitle: 'Agent 1',
          contextNodeIds: ['n1', 'c1', 'c1'],
          engine: null,
          budgetUsd: null,
        },
      ],
      contextDigest: [],
      now: 1,
    })
    expect(built.payload.items[0]?.contextNodeIds).toEqual(['c1'])
    expect(built.payload.triggerId).toBe('trigger-1')
    expect(built.expiresAt).toBe(1 + 24 * 60 * 60 * 1000)
  })

  it('rejects empty, too many, or missing target plans', () => {
    expect(
      validatePlanApply({
        action: { ...action, payload: { items: [] } },
        now: 2,
        currentPolicyVersion: 'p1',
        targetExists: () => true,
      }),
    ).toMatchObject({ ok: false, code: 'plan_invalid' })
    expect(
      validatePlanApply({
        action: { ...action, expiresAt: 1 },
        now: 2,
        currentPolicyVersion: 'p1',
        targetExists: () => true,
      }),
    ).toMatchObject({ ok: false, code: 'plan_expired' })
    expect(
      validatePlanApply({
        action,
        now: 2,
        currentPolicyVersion: 'p2',
        targetExists: () => true,
      }),
    ).toMatchObject({ ok: false, code: 'action_not_applicable' })
    expect(
      validatePlanApply({
        action,
        now: 2,
        currentPolicyVersion: 'p1',
        targetExists: (id) => id !== 'missing',
      }),
    ).toMatchObject({ ok: false, code: 'action_not_applicable' })
  })
})
```

```ts
// packages/core/test/task-context-digest.test.ts
import { describe, expect, it } from 'vitest'
import { buildTaskContextDigest } from '../src/supervisor/context-digest.js'

describe('buildTaskContextDigest', () => {
  it('dedupes tasks, keeps max 5 and prefers higher-value sources', () => {
    const digest = buildTaskContextDigest({
      candidates: [
        { taskId: 't1', title: 'A', status: 'done', source: 'same_agent', failure: null },
        { taskId: 't1', title: 'A', status: 'done', source: 'title', failure: null },
        { taskId: 't2', title: 'B', status: 'failed', source: 'recent_failure', failure: 'run: exit 1' },
        { taskId: 't3', title: 'C', status: 'review', source: 'handoff', failure: null },
        { taskId: 't4', title: 'D', status: 'todo', source: 'context_node', failure: null },
        { taskId: 't5', title: 'E', status: 'todo', source: 'title', failure: null },
        { taskId: 't6', title: 'F', status: 'todo', source: 'same_agent', failure: null },
      ],
    })
    expect(digest).toHaveLength(5)
    expect(digest.map((item) => item.taskId)).toEqual(['t1', 't6', 't3', 't4', 't2'])
    expect(digest.find((item) => item.taskId === 't2')?.failure).toBe('run: exit 1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @baton/core test -- supervisor-templates supervisor-plan task-context-digest`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement protocol/core**

`packages/protocol/src/task-template.ts`：

```ts
import { z } from 'zod'
import { Engine } from './enums.js'
import { TaskTemplateId } from './supervisor-action.js'

export const TaskTemplate = z
  .object({
    id: TaskTemplateId,
    label: z.string().min(1).max(40),
    titlePattern: z.string().min(1).max(80),
    acceptanceSeed: z.array(z.string().min(1).max(200)).min(3).max(5),
    contextRules: z
      .object({
        includeSameAgent: z.boolean(),
        includeHandoffChain: z.boolean(),
        includeRecentFailures: z.boolean(),
        maxContextNodes: z.number().int().min(1).max(10),
      })
      .strict(),
    defaultEngine: Engine.nullable(),
    defaultBudgetUsd: z.number().finite().nonnegative().nullable(),
  })
  .strict()
export type TaskTemplate = z.infer<typeof TaskTemplate>
```

`packages/protocol/src/supervisor.ts` 的 `TaskOrigin` 再加：

```ts
templateId: TaskTemplateId.optional(),
acceptanceSeed: z.array(z.string().min(1).max(200)).max(5).optional(),
```

`packages/core/src/supervisor/origin.ts` 的 `BuildTaskOriginInput` 增加同名字段，并在返回对象中透传：

```ts
export interface BuildTaskOriginInput {
  // ...existing fields...
  templateId?: TaskOrigin['templateId']
  acceptanceSeed?: TaskOrigin['acceptanceSeed']
}

// buildTaskOrigin 的 return 里：
...(templateId ? { templateId } : {}),
...(acceptanceSeed ? { acceptanceSeed } : {}),
```

`packages/protocol/src/supervisor-action.ts` 加：

```ts
export const PlanToolResult = z
  .object({
    actionId: Id,
    status: SupervisorActionStatus,
    plan: PlanPayload,
  })
  .strict()
export type PlanToolResult = z.infer<typeof PlanToolResult>
```

`packages/core/src/supervisor/templates.ts`：

```ts
import type { TaskTemplate } from '@baton/protocol'

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'bugfix',
    label: '修复',
    titlePattern: '修复：{goal}',
    acceptanceSeed: ['复现步骤可执行', '失败现象消失', '相关回归点通过'],
    contextRules: {
      includeSameAgent: true,
      includeHandoffChain: false,
      includeRecentFailures: true,
      maxContextNodes: 5,
    },
    defaultEngine: null,
    defaultBudgetUsd: null,
  },
  {
    id: 'feature',
    label: '实现',
    titlePattern: '实现：{goal}',
    acceptanceSeed: ['功能点按描述可用', '边界条件有测试', '现有行为不回归'],
    contextRules: {
      includeSameAgent: true,
      includeHandoffChain: true,
      includeRecentFailures: false,
      maxContextNodes: 5,
    },
    defaultEngine: null,
    defaultBudgetUsd: null,
  },
  {
    id: 'review',
    label: '审查',
    titlePattern: '审查：{goal}',
    acceptanceSeed: ['改动范围清楚', '风险点有结论', '验证方式可执行'],
    contextRules: {
      includeSameAgent: false,
      includeHandoffChain: false,
      includeRecentFailures: false,
      maxContextNodes: 5,
    },
    defaultEngine: null,
    defaultBudgetUsd: null,
  },
  {
    id: 'handoff',
    label: '交接',
    titlePattern: '交接：{goal}',
    acceptanceSeed: ['A 的结果可被 B 消费', '交接上下文完整', '后续任务可独立开工'],
    contextRules: {
      includeSameAgent: false,
      includeHandoffChain: true,
      includeRecentFailures: false,
      maxContextNodes: 5,
    },
    defaultEngine: null,
    defaultBudgetUsd: null,
  },
]

export function templateById(id: string | null): TaskTemplate | null {
  return TASK_TEMPLATES.find((template) => template.id === id) ?? null
}

export function matchTemplate(intent: string): TaskTemplate['id'] | null {
  const text = intent.toLowerCase()
  if (/修复|bug|错误|崩溃|失败/.test(text)) return 'bugfix'
  if (/审查|review|检查|风险/.test(text)) return 'review'
  if (/交接|handoff|接着做|继续/.test(text)) return 'handoff'
  if (/实现|新增|功能|feature/.test(text)) return 'feature'
  return null
}
```

`packages/core/src/supervisor/plan.ts`：

```ts
import type { PlanItem, PlanPayload, SupervisorAction } from '@baton/protocol'
import { isActionExpired } from './action.js'

export const PLAN_TTL_MS = 24 * 60 * 60 * 1000

export function buildPlan(input: {
  triggerId: string
  source: { nodeIds: string[] }
  templateId: PlanPayload['templateId']
  items: PlanItem[]
  contextDigest: PlanPayload['contextDigest']
  now: number
}): { payload: PlanPayload; expiresAt: number } {
  const items = input.items.slice(0, 6).map((item) => ({
    ...item,
    contextNodeIds: [...new Set(item.contextNodeIds)].filter(
      (id) => !input.source.nodeIds.includes(id),
    ),
  }))
  return {
    payload: {
      items,
      templateId: input.templateId,
      contextDigest: input.contextDigest.slice(0, 5),
      source: input.source,
      triggerId: input.triggerId,
    },
    expiresAt: input.now + PLAN_TTL_MS,
  }
}

export type PlanValidation =
  | { ok: true; payload: PlanPayload }
  | { ok: false; code: 'plan_invalid' | 'plan_expired' | 'action_not_applicable'; message: string }

export function validatePlanApply(input: {
  action: SupervisorAction
  now: number
  currentPolicyVersion: string
  targetExists: (nodeId: string) => boolean
}): PlanValidation {
  if (input.action.kind !== 'triage_plan') {
    return { ok: false, code: 'action_not_applicable', message: 'action is not a plan' }
  }
  if (input.action.policyVersion !== input.currentPolicyVersion) {
    return { ok: false, code: 'action_not_applicable', message: 'policy changed since proposal' }
  }
  if (isActionExpired(input.action, input.now)) {
    return { ok: false, code: 'plan_expired', message: 'plan expired' }
  }
  const payload = input.action.payload as PlanPayload | null
  if (!payload || !Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 6) {
    return { ok: false, code: 'plan_invalid', message: 'plan must contain 1-6 items' }
  }
  for (const item of payload.items) {
    if (item.targetNodeId && !input.targetExists(item.targetNodeId)) {
      return { ok: false, code: 'action_not_applicable', message: 'target node no longer exists' }
    }
  }
  return { ok: true, payload }
}
```

`packages/core/src/supervisor/context-digest.ts`：

```ts
import type { PlanContextItem } from '@baton/protocol'

const SOURCE_RANK: Record<PlanContextItem['source'], number> = {
  same_agent: 5,
  handoff: 4,
  context_node: 3,
  recent_failure: 2,
  title: 1,
}

export function buildTaskContextDigest(input: {
  candidates: PlanContextItem[]
  max?: number
}): PlanContextItem[] {
  const byTask = new Map<string, PlanContextItem>()
  for (const candidate of input.candidates) {
    const previous = byTask.get(candidate.taskId)
    if (!previous || SOURCE_RANK[candidate.source] > SOURCE_RANK[previous.source]) {
      byTask.set(candidate.taskId, candidate)
    }
  }
  return [...byTask.values()]
    .sort((a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source] || a.taskId.localeCompare(b.taskId))
    .slice(0, input.max ?? 5)
}
```

`packages/core/src/supervisor/index.ts` 导出三个新文件。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @baton/core test -- supervisor-templates supervisor-plan task-context-digest`
Expected: PASS；旧 TaskOrigin 仍解析成功。

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src packages/core/src/supervisor packages/core/test packages/protocol/test
git commit -m "feat(core): 增加计划模板与上下文摘要"
```

---

### Task C2: daemon plan_tasks、create_tasks dryRun、batch_tasks

Blocking: Task C1
Slice type: tracer-bullet
Seam: tool execute against temp DB

**Files:**
- Create: `apps/daemon/src/supervisor/target.ts`
- Create: `apps/daemon/src/supervisor/context-digest.ts`
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Modify: `apps/daemon/src/supervisor/engine.ts`（仅 plan_tasks/batch_tasks 接线，C4 统一补齐）
- Modify: `apps/daemon/src/supervisor/service.ts`（仅 wrapped 接线）
- Modify: `packages/core/src/supervisor/policy.ts`（allowedTools 加 plan_tasks/batch_tasks）
- Test: `apps/daemon/test/supervisor-plan-tools.test.ts`
- Test: `apps/daemon/test/supervisor-batch.test.ts`

**Interfaces:**
- Consumes: C1 `buildPlan`/`matchTemplate`/`buildTaskContextDigest`；A4 `actions.propose`。
- Produces: `plan_tasks`、`batch_tasks`、`create_tasks.dryRun`。

- [ ] **Step 1: Write failing tests**

```ts
// apps/daemon/test/supervisor-plan-tools.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { createSupervisorActionService } from '../src/supervisor/actions.js'
import { createSupervisorTools } from '../src/supervisor/tools.js'
import { createTestDb, seedTask, seedTextNode, type TestDb } from './helpers/db.js'

const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((entry) => entry.raw.close()))

describe('plan_tasks', () => {
  it('writes one proposed triage_plan and creates no task', async () => {
    const database = createTestDb()
    dbs.push(database)
    const seeded = seedTask(database.raw, { trusted: true })
    seedTextNode(database.raw, seeded.canvasId, 'text-1', '修复登录页')
    let now = 1_000
    const actions = createSupervisorActionService({
      db: database.db,
      now: () => now++,
      newId: (() => {
        let index = 0
        return () => `a-${++index}`
      })(),
      policyVersion: () => 'p1',
      requireMandate: () => null,
      applyTransition: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
      enqueueTask: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
      generateDigest: () => null,
    })
    const tools = createSupervisorTools({
      db: database.db,
      workspacesRoot: '/tmp',
      claudeMaxBudgetUsd: 2,
      taskService: { createTask: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }) } as never,
      now: () => now++,
      newId: () => 'id',
      defaultEngine: 'fake',
      enqueueTask: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
      applyTransition: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
      replyToTask: () => ({ ok: false }),
      injectContext: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
      cancelTask: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
      actions,
      contextDigest: () => [],
    })
    const result = (await tools.plan_tasks.execute(
      {
        source: { nodeIds: ['text-1'] },
        template: 'bugfix',
        maxItems: 3,
      },
      {
        workspaceId: seeded.workspaceId,
        threadId: 'th1',
        triggerId: 'trigger-1',
        text: '修复登录页',
        actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
        selection: { contextNodeIds: [], agentCandidates: [] },
        policyVersion: 'p1',
        promptVersion: 'v1',
        memo: {},
      },
    )) as { actionId: string; status: string; plan: { items: unknown[] } }
    expect(result.status).toBe('proposed')
    expect(result.plan.items).toHaveLength(1)
    expect(actions.listProposed(seeded.workspaceId)).toHaveLength(1)
    expect(database.raw.prepare('select count(*) as count from task').get()).toEqual({ count: 1 })
  })
})
```

```ts
// apps/daemon/test/supervisor-batch.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { createSupervisorTools } from '../src/supervisor/tools.js'
import { createTestDb, seedTask, seedTextNode, type TestDb } from './helpers/db.js'

const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((entry) => entry.raw.close()))

function setup() {
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw, { taskStatus: 'todo' })
  seedTextNode(database.raw, seeded.canvasId, 'text-1', '需求 A')
  database.raw
    .prepare(
      `insert into task (
         id, workspace_id, node_id, title, prompt, status, engine, workspace_mode,
         retry_count, dangerously_skip_permissions, created_at, updated_at
       ) values ('running-1', ?, ?, '运行中', 'p', 'running', 'fake', 'main', 0, 0, 1, 1)`,
    )
    .run(seeded.workspaceId, seeded.nodeId)
  const cancelled: string[] = []
  let createCalls = 0
  const tools = createSupervisorTools({
    db: database.db,
    workspacesRoot: '/tmp',
    claudeMaxBudgetUsd: 2,
    taskService: {
      createTask: () => {
        createCalls += 1
        return { ok: false, error: { code: 'unused', message: 'unused' } }
      },
    } as never,
    now: () => 1,
    newId: () => 'id',
    defaultEngine: 'fake',
    enqueueTask: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
    applyTransition: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
    replyToTask: () => ({ ok: false }),
    injectContext: () => ({ ok: false, error: { code: 'unused', message: 'unused' } as never }),
    cancelTask: (taskId) => {
      cancelled.push(taskId)
      return {
        ok: true,
        taskId,
        status: 'cancelled',
        previousStatus: 'todo',
        retryCount: 0,
        waitingReason: null,
        events: [],
      }
    },
    actions: {
      propose: () => ({ ok: false, error: { code: 'unused', message: 'unused' } }),
      decide: () => ({ ok: false, error: { code: 'unused', message: 'unused' } }),
      get: () => null,
      listProposed: () => [],
    } as never,
    contextDigest: () => [],
  })
  const ctx = {
    workspaceId: seeded.workspaceId,
    threadId: 'th1',
    triggerId: 'trigger-1',
    text: '取消这些任务',
    actor: { id: 'local-user', kind: 'human' as const, source: 'supervisor-chat' as const },
    selection: { contextNodeIds: [], agentCandidates: [] },
    policyVersion: 'p1',
    promptVersion: 'v1',
    memo: {},
  }
  return { database, seeded, tools, ctx, cancelled, createCalls: () => createCalls }
}

describe('batch_tasks', () => {
  it('dry-runs cancel, keeps running out, and executes only after confirm', async () => {
    const { seeded, tools, ctx, cancelled } = setup()
    const preview = (await tools.batch_tasks.execute(
      { action: 'cancel', taskIds: [seeded.taskId, 'running-1'], dryRun: true },
      ctx,
    )) as { dryRun: boolean; requiresConfirmation: boolean; items: Array<{ taskId: string }> }
    expect(preview.dryRun).toBe(true)
    expect(preview.requiresConfirmation).toBe(true)
    expect(preview.items.map((item) => item.taskId)).toEqual([seeded.taskId])
    expect(cancelled).toEqual([])

    const executed = (await tools.batch_tasks.execute(
      { action: 'cancel', taskIds: [seeded.taskId, 'running-1'], dryRun: false, confirm: true },
      ctx,
    )) as { dryRun: boolean; items: Array<{ taskId: string; ok: boolean }> }
    expect(executed.dryRun).toBe(false)
    expect(executed.items).toEqual([{ taskId: seeded.taskId, ok: true }])
    expect(cancelled).toEqual([seeded.taskId])
  })

  it('create_tasks dryRun previews without creating a task', async () => {
    const { seeded, tools, ctx, createCalls } = setup()
    const preview = (await tools.create_tasks.execute(
      { nodeIds: ['text-1'], targetNodeId: seeded.nodeId, dryRun: true },
      ctx,
    )) as { dryRun: boolean; items: Array<{ title: string }> }
    expect(preview.dryRun).toBe(true)
    expect(preview.items[0]?.title).toBe('需求 A')
    expect(createCalls()).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-plan-tools supervisor-batch`
Expected: FAIL because tools do not exist.

- [ ] **Step 3: Implement tools**

把 `tools.ts` 内的 `resolveAgentTarget`、`resolveEngine`、`resolveContext`、`canvasFor` 抽到 `apps/daemon/src/supervisor/target.ts`，用工厂保留原来的闭包依赖：

```ts
export interface TargetResolverDeps {
  db: Db
  defaultEngine: EngineValue
  now: () => number
  newId: () => string
}

export function createTargetResolver(deps: TargetResolverDeps) {
  // 原 tools.ts 里的 canvasFor / createAgentNode / resolveAgentTarget / resolveContext / resolveEngine
  return { canvasFor, resolveAgentTarget, resolveContext, resolveEngine }
}
```

`tools.ts` 改为 `const resolver = createTargetResolver(deps)`，内部调用 `resolver.resolveAgentTarget(...)`；Plan C3 的 `applyPlan` 也用同一工厂，避免复制逻辑。

`plan_tasks` 入参：

```ts
const planTasksInput = z
  .object({
    source: z
      .object({
        text: z.string().min(1).max(8000).optional(),
        nodeIds: z.array(z.string().min(1)).max(40).default([]),
      })
      .strict()
      .default({ nodeIds: [] }),
    template: TaskTemplateId.optional(),
    targetNodeId: z.string().min(1).optional(),
    contextNodeIds: z.array(z.string().min(1)).max(40).optional(),
    maxItems: z.number().int().min(1).max(6).default(6),
  })
  .strict()
```

execute：

```ts
const parsed = planTasksInput.parse(input)
const canvas = resolver.canvasFor(ctx)
const nodeIds = parsed.source.nodeIds.length > 0 ? parsed.source.nodeIds : ctx.selection.contextNodeIds
const nodes = nodeIds
  .map((id) => getNode(deps.db, id))
  .filter((node): node is NonNullable<typeof node> => Boolean(node))
if (nodes.some((node) => node.canvasId !== canvas.id || node.type !== 'text')) {
  throw appError('plan_invalid', 'source nodes must be text nodes on this canvas')
}
const text = parsed.source.text ?? nodes.map((node) => node.data.content).join('\n') ?? ctx.text
const templateId = parsed.template ?? matchTemplate(text)
const candidateTexts =
  nodes.length > 0
    ? nodes.map((node) => textTitle(node.data.content)).slice(0, parsed.maxItems)
    : text.split(/\n+/).map((line) => line.replace(/^[-*]\s*/, '').trim()).filter(Boolean).slice(0, parsed.maxItems)
if (candidateTexts.length === 0) throw appError('plan_invalid', 'plan source is empty')
const requestedTargetId = parsed.targetNodeId ?? ctx.selection.targetNodeId
const target = requestedTargetId
  ? resolver.resolveAgentTarget(ctx, { title: candidateTexts[0]!, targetNodeId: requestedTargetId })
  : {
      id: null,
      title: parsed.agentTitle ?? candidateTexts[0]!,
      engine: deps.defaultEngine,
      created: false,
    }
const contextNodeIds = resolver.resolveContext(
  ctx,
  parsed.contextNodeIds ?? ctx.selection.contextNodeIds,
  target.id ?? '',
)
const items: PlanItem[] = candidateTexts.map((title) => ({
  title: title.slice(0, 80),
  templateId: templateId ?? null,
  targetNodeId: target.id,
  agentTitle: target.title,
  contextNodeIds,
  engine: null,
  budgetUsd: null,
}))
const built = buildPlan({
  triggerId: ctx.triggerId,
  source: { nodeIds },
  templateId: templateId ?? null,
  items,
  contextDigest: deps.contextDigest(ctx.workspaceId, items) ?? [],
  now: deps.now(),
})
const proposed = deps.actions.propose({
  workspaceId: ctx.workspaceId,
  threadId: ctx.threadId,
  taskId: null,
  kind: 'triage_plan',
  strength: 'inferred',
  mode: 'observe',
  reason: `计划：${items.length} 个任务，等待你确认`,
  payload: built.payload,
  policyVersion: ctx.policyVersion,
  dedupeKey: `plan:${ctx.threadId}:${ctx.triggerId}:${supervisorShortHash(JSON.stringify(built.payload))}`,
  expiresAt: built.expiresAt,
})
if (!proposed.ok) throw proposed.error
return { actionId: proposed.action.id, status: proposed.action.status, plan: built.payload }
```

`apps/daemon/src/supervisor/context-digest.ts` 提供 `SupervisorToolsDeps.contextDigest(workspaceId, items)`：

```ts
export function createContextDigest(deps: {
  db: Db
  failures: ReturnType<typeof createFailureService>
  now: () => number
}) {
  return function buildContextDigest(workspaceId: string, items: PlanItem[]): PlanContextItem[] {
    const tasks = listTasks(deps.db, { workspaceId })
    const failures = deps.failures.latestByTaskIds(tasks.map((task) => task.id))
    const handoffAudits = listAudit(deps.db, { actionPrefix: 'task.handoff.create', limit: 100 })
    const handoffByTask = new Map(
      handoffAudits.map((entry) => {
        const detail = entry.detail as { taskId?: string; nodeId?: string }
        return [detail.taskId ?? '', detail.nodeId ?? ''] as const
      }),
    )
    const targetNodeId = items[0]?.targetNodeId ?? null
    const contextIds = new Set(items.flatMap((item) => item.contextNodeIds))
    const titleTokens = (items[0]?.title ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length >= 2)
    const candidates: PlanContextItem[] = []
    for (const task of tasks.slice(0, 50)) {
      const detail = getTaskDetail(deps.db, task.id)?.task
      const includedIds = new Set(detail?.context?.included.map((item) => item.id) ?? [])
      if (targetNodeId && task.nodeId === targetNodeId) {
        candidates.push({ taskId: task.id, title: task.title, status: task.status, source: 'same_agent', failure: null })
      }
      const handoffNodeId = handoffByTask.get(task.id)
      const isHandoff =
        Boolean(handoffNodeId) ||
        [...handoffByTask.values()].some((nodeId) => includedIds.has(nodeId))
      if (isHandoff) {
        candidates.push({ taskId: task.id, title: task.title, status: task.status, source: 'handoff', failure: null })
      }
      if ([...contextIds].some((id) => includedIds.has(id))) {
        candidates.push({ taskId: task.id, title: task.title, status: task.status, source: 'context_node', failure: null })
      }
      if (failures.has(task.id)) {
        candidates.push({
          taskId: task.id,
          title: task.title,
          status: task.status,
          source: 'recent_failure',
          failure: failures.get(task.id)?.summary ?? null,
        })
      }
      if (titleTokens.some((token) => task.title.toLowerCase().includes(token))) {
        candidates.push({ taskId: task.id, title: task.title, status: task.status, source: 'title', failure: null })
      }
    }
    return buildTaskContextDigest({ candidates })
  }
}
```

`tools.ts` 的 `SupervisorToolsDeps` 增加 `contextDigest`，`plan_tasks` 调用它；Runtime 用 `createContextDigest({ db, failures, now })` 注入。

`create_tasks` 加 `dryRun`：

```ts
const createTasksInput = z.object({
  // ...existing...
  dryRun: z.boolean().default(false),
})
// execute 计算 textNodes/target/context 后：
if (parsed.dryRun) {
  return {
    dryRun: true,
    items: textNodes.map((node) => ({
      title: textTitle(node.data.content).slice(0, 80),
      target: { id: target.id, title: target.title, engine },
      contextCount: contextNodeIds.length,
    })),
    failed: [],
  }
}
```

`batch_tasks`：

```ts
const batchTasksInput = z
  .object({
    action: z.enum(['enqueue', 'retry', 'cancel']),
    taskIds: z.array(z.string().min(1)).min(1).max(20),
    dryRun: z.boolean().default(true),
    confirm: z.boolean().default(false),
  })
  .strict()
```

execute 规则：
- `const unique = [...new Set(parsed.taskIds)]`；若 `unique.length !== parsed.taskIds.length` 抛 `batch_invalid`。
- 逐个 `resolveTaskId`；按 action 校验状态；cancel 跳过 `running` 并收集 `runningTaskIds`。
- `parsed.dryRun || !parsed.confirm` 时返回 `{ dryRun:true, items, skipped, requiresConfirmation: runningTaskIds.length>0 }`，不执行。
- 执行时逐条调用 `deps.enqueueTask` / `deps.applyTransition` / `deps.cancelTask`，返回 `{ dryRun:false, items:[{taskId, ok, status?, error?}] }`；部分失败逐条返回，不整体抛错。
- 写 audit `supervisor.batch`。

把 `plan_tasks`、`batch_tasks` 加入 `SupervisorToolset`/`BoundToolset`/`bindTools`，并更新 `SUPERVISOR_POLICY.allowedTools`。工具数暂为 20，C4 补 `decide_action` 后到 21。

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- supervisor-plan-tools supervisor-batch
pnpm --filter @evanfang0054/baton typecheck
```

Expected: PASS；plan_tasks 后 task 数不变；batch cancel 预览不改变 running。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/supervisor packages/core/src/supervisor/policy.ts apps/daemon/test
git commit -m "feat(daemon): 增加计划预览与批量干跑"
```

---

### Task C3: human-only plan apply 与 decide_action

Blocking: Task C2
Slice type: tracer-bullet
Seam: `runtime.handleCommand('supervisor.action.decide')`

**Files:**
- Modify: `apps/daemon/src/supervisor/actions.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Modify: `apps/daemon/src/supervisor/engine.ts`
- Modify: `apps/daemon/src/supervisor/service.ts`
- Modify: `apps/daemon/src/supervisor/observe.ts`
- Modify: `apps/daemon/src/supervisor/store.ts`
- Modify: `apps/daemon/src/db/repositories.ts`（`getSupervisorMessageByTrigger`）
- Modify: `packages/core/src/supervisor/policy.ts`
- Test: `apps/daemon/test/supervisor-plan-apply.test.ts`
- Test: `apps/daemon/test/supervisor-tools.test.ts`

**Interfaces:**
- Consumes: C1 `validatePlanApply`；C2 `plan_tasks`；A4 action service。
- Produces: `triage_plan` apply、`decide_action`（只 ignore）、21 个工具。

- [ ] **Step 1: Write failing tests**

```ts
// apps/daemon/test/supervisor-plan-apply.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { createTestRuntime, type TestRuntimeHandle } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('plan apply', () => {
  it('is human-only, idempotent, and reports partial failures', async () => {
    const handle = createTestRuntime({ trusted: true })
    handles.push(handle)
    const proposed = handle.runtime.actions.propose({
      workspaceId: handle.seeded.workspaceId,
      threadId: 'th1',
      taskId: null,
      kind: 'triage_plan',
      strength: 'inferred',
      mode: 'observe',
      reason: '计划',
      payload: {
        triggerId: 'trigger-1',
        source: { nodeIds: ['text-1'] },
        templateId: 'bugfix',
        contextDigest: [],
        items: [
          {
            title: '修复登录',
            templateId: 'bugfix',
            targetNodeId: null,
            agentTitle: 'Agent 1',
            contextNodeIds: [],
            engine: 'fake',
            budgetUsd: null,
          },
          {
            title: '目标已失效',
            templateId: null,
            targetNodeId: 'missing-node',
            agentTitle: null,
            contextNodeIds: [],
            engine: 'fake',
            budgetUsd: null,
          },
        ],
      },
      policyVersion: 'policy-1',
      dedupeKey: 'plan:apply:1',
    })
    if (!proposed.ok) throw new Error(proposed.error.message)

    const forbidden = handle.runtime.handleCommand({
      v: 1,
      id: 'p1',
      ts: 1,
      type: 'supervisor.action.decide',
      payload: { workspaceId: handle.seeded.workspaceId, actionId: proposed.action.id, decision: 'apply' },
    })
    // WS 永远注入 human；模型路径由 decide_action 测试覆盖。
    expect(forbidden.ok).toBe(true)
    const applied = handle.runtime.actions.get(proposed.action.id)
    expect(applied?.status).toBe('applied')
    const result = applied?.result as { createdTaskIds: string[]; failed: Array<{ index: number }> }
    expect(result.createdTaskIds).toHaveLength(1)
    expect(result.failed).toHaveLength(1)

    const again = handle.runtime.handleCommand({
      v: 1,
      id: 'p2',
      ts: 1,
      type: 'supervisor.action.decide',
      payload: { workspaceId: handle.seeded.workspaceId, actionId: proposed.action.id, decision: 'apply' },
    })
    expect(again).toMatchObject({ ok: false, error: { code: 'action_already_decided' } })
  })
})
```

`supervisor-tools.test.ts` 追加：

```ts
it('decide_action can only ignore', async () => {
  await expect(
    tools.decide_action.execute({ actionId: 'a1', decision: 'apply' }, ctx),
  ).rejects.toMatchObject({ code: 'supervisor_action_forbidden' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-plan-apply supervisor-tools`
Expected: FAIL because plan apply/decide_action do not exist.

- [ ] **Step 3: Implement plan apply and decide_action**

`actions.ts` 的 deps 增加：

```ts
applyPlan?: (action: SupervisorAction) => {
  ok: true
  result: PlanApplyResult
} | { ok: false; error: AppError }
```

`applyAction` 在 `attention_reminder` 之后加：

```ts
if (action.kind === 'triage_plan') {
  const result = deps.applyPlan?.(action)
  if (!result) return { ok: false, error: appError('action_not_applicable', 'plan apply is not wired') }
  if (!result.ok) return result
  if (result.result.createdTaskIds.length === 0) {
    return { ok: false, error: appError('action_not_applicable', 'no task was created', result.result) }
  }
  return { ok: true, result: result.result }
}
```

`decide` 在状态为 applied 时返回幂等结果；这段必须放在 `status !== 'proposed'` 检查之前：

```ts
if (action.status === 'applied' && input.decision === 'apply') {
  return { ok: true, action }
}
if (action.status !== 'proposed') {
  return { ok: false, error: appError('action_already_decided', 'action already decided') }
}
```

`apps/daemon/src/db/repositories.ts` 增加按 trigger 取原用户消息：

```ts
import { supervisorMessage } from './schema.js'

export function getSupervisorMessageByTrigger(
  db: Db,
  threadId: string,
  triggerId: string,
): { content: string } | null {
  const row = db
    .select({ content: supervisorMessage.content })
    .from(supervisorMessage)
    .where(and(eq(supervisorMessage.threadId, threadId), eq(supervisorMessage.triggerId, triggerId)))
    .get()
  return row ?? null
}
```

`runtime/index.ts` 增加 `applyPlan`：

```ts
function applyPlan(action: SupervisorAction): { ok: true; result: PlanApplyResult } | { ok: false; error: AppError } {
  const checked = validatePlanApply({
    action,
    now: now(),
    currentPolicyVersion: loadWorkspacePolicy(deps.db, deps.config, action.workspaceId)?.policyVersion ?? '',
    targetExists: (nodeId) => Boolean(getNode(deps.db, nodeId)),
  })
  if (!checked.ok) return { ok: false, error: appError(checked.code, checked.message) }
  const payload = checked.payload
  const sourceText =
    payload.source.nodeIds.length > 0
      ? getNode(deps.db, payload.source.nodeIds[0]!)?.data.content
      : getSupervisorMessageByTrigger(deps.db, action.threadId ?? '', payload.triggerId)?.content
  if (!sourceText?.trim()) {
    return { ok: false, error: appError('plan_invalid', 'plan source text is missing') }
  }
  const createdTaskIds: string[] = []
  const failed: PlanApplyResult['failed'] = []
  const resolver = createTargetResolver({
    db: deps.db,
    defaultEngine,
    now,
    newId,
  })
  payload.items.forEach((item, index) => {
    const target = resolver.resolveAgentTarget(
      {
        workspaceId: action.workspaceId,
        threadId: action.threadId ?? '',
        triggerId: payload.triggerId,
        text: sourceText,
        actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
        selection: { contextNodeIds: [], agentCandidates: [] },
        policyVersion: action.policyVersion,
        promptVersion: PROMPT_VERSION,
        memo: {},
      },
      {
        title: item.title,
        ...(item.targetNodeId ? { targetNodeId: item.targetNodeId } : {}),
        ...(item.agentTitle ? { agentTitle: item.agentTitle } : {}),
      },
    )
    const origin = buildTaskOrigin({
      source: 'supervisor-chat',
      triggerId: payload.triggerId,
      threadId: action.threadId ?? `plan:${action.id}`,
      workspaceId: action.workspaceId,
      targetNodeId: target.id,
      contextNodeIds: item.contextNodeIds,
      policyVersion: action.policyVersion,
      promptVersion: PROMPT_VERSION,
      createdAt: now(),
      ...(item.templateId ? { templateId: item.templateId } : {}),
      ...(templateById(item.templateId)?.acceptanceSeed
        ? { acceptanceSeed: templateById(item.templateId)!.acceptanceSeed }
        : {}),
    })
    const sourceNodeId = payload.source.nodeIds[index]
    const itemPrompt = sourceNodeId
      ? (getNode(deps.db, sourceNodeId)?.data.content ?? sourceText)
      : sourceText
    const created = taskService.createTask(
      {
        workspaceId: action.workspaceId,
        nodeId: target.id,
        title: item.title,
        prompt: itemPrompt,
        contextNodeIds: item.contextNodeIds,
        engine: resolver.resolveEngine(item.engine ?? undefined, target),
        workspaceMode: 'main',
        dangerouslySkipPermissions: false,
        ...(item.budgetUsd !== null ? { budgetUsd: item.budgetUsd } : {}),
      },
      {
        origin,
        audit: {
          actor: 'human',
          action: 'supervisor.plan.apply',
          detail: { actionId: action.id, index, templateId: item.templateId },
        },
      },
    )
    if (created.ok) createdTaskIds.push(created.taskId)
    else failed.push({ index, code: created.error.code, message: created.error.message })
  })
  if (createdTaskIds.length === 0) {
    return { ok: false, error: appError('action_not_applicable', 'no plan item could be created', { failed }) }
  }
  return { ok: true, result: { createdTaskIds, failed } }
}
```

`buildTaskOrigin` 的 input 增加 `templateId`/`acceptanceSeed`，原样透传。

`decide_action` 工具：

```ts
const decideActionInput = z
  .object({
    actionId: z.string().min(1),
    decision: z.literal('ignore'),
  })
  .strict()
```

execute 调 `deps.actions.decide({ workspaceId: ctx.workspaceId, actionId, actor: 'supervisor', decision: 'ignore' })`；任何 apply 值在 schema 层被拒绝；如测试直接传入 apply，先显式判断并抛 `supervisor_action_forbidden`。

`SUPERVISOR_POLICY.allowedTools` 加 `decide_action`；工具面 21。`engine.ts`、`service.ts` wrapped、`SupervisorToolset`/`BoundToolset`/`bindTools` 同步。

`buildVerifierPrompt`：

```ts
// buildVerifierPrompt 的入参增加 acceptanceSeed?: string[]
const seed = input.acceptanceSeed ?? []
const seedBlock =
  seed.length > 0
    ? `\n<acceptance_seed>\n${seed.map((item) => `- ${item}`).join('\n')}\n</acceptance_seed>`
    : ''
// prompt 末尾追加 seedBlock
```

`dispatchVerifier` 传 `acceptanceSeed: task.origin?.acceptanceSeed`；任务 prompt 不拼 seed。

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- supervisor-plan-apply supervisor-tools supervisor-observe
pnpm --filter @evanfang0054/baton typecheck
```

Expected: PASS；apply 两次第二次 `action_already_decided`；部分失败 `applied + failed[]`。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src packages/core/src/supervisor/policy.ts apps/daemon/test
git commit -m "feat(daemon): 计划应用与只读决策工具"
```

---

### Task C4: 工具面 21、prompt 与接线快照

Blocking: Task C3
Slice type: tracer-bullet
Seam: mock OpenAI-compatible request body

**Files:**
- Modify: `apps/daemon/src/supervisor/prompt.ts`
- Modify: `apps/daemon/test/supervisor-engine-mock.test.ts`
- Create: `apps/daemon/test/supervisor-prompt.test.ts`
- Modify: `packages/core/test/supervisor-policy.test.ts`

**Interfaces:**
- Consumes: C2/C3 的 4 个新工具。
- Produces: 21 工具接线 + prompt 字符上限。

- [ ] **Step 1: Write failing assertions**

```ts
// supervisor-engine-mock.test.ts
expect(sentTools.sort()).toEqual([
  'batch_tasks',
  'cancel_task',
  'create_agent',
  'create_edge',
  'create_task',
  'create_tasks',
  'create_text',
  'decide_action',
  'enqueue_task',
  'get_task',
  'get_task_failure',
  'get_task_history',
  'handoff_task',
  'inject_context',
  'list_canvas',
  'list_tasks',
  'plan_tasks',
  'reopen_task',
  'reply_task',
  'retry_task',
  'update_node',
])
```

```ts
// packages/core/test/supervisor-policy.test.ts
expect(SUPERVISOR_POLICY.allowedTools).toHaveLength(21)
```

```ts
// apps/daemon/test/supervisor-prompt.test.ts
import { describe, expect, it } from 'vitest'
import { SUPERVISOR_PROMPT } from '../src/supervisor/prompt.js'

describe('supervisor prompt budget', () => {
  it('stays within the measured 3,222-char budget plus 15%', () => {
    expect(SUPERVISOR_PROMPT.length).toBeLessThanOrEqual(3_705)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- supervisor-engine-mock supervisor-prompt
pnpm --filter @baton/core test -- supervisor-policy
```

Expected: FAIL because tools/prompt are not updated.

- [ ] **Step 3: Update prompt and wiring**

`prompt.ts` 第 2 条改为 21 个工具，新增规则：

```text
2. 你有 21 个工具：list_canvas、list_tasks、get_task、get_task_history、get_task_failure、\
create_task、create_tasks、plan_tasks、handoff_task、enqueue_task、retry_task、reopen_task、\
cancel_task、reply_task、inject_context、batch_tasks、decide_action、\
create_text、create_agent、create_edge、update_node。
...
36. 多条需求先用 plan_tasks 生成计划；计划只写 proposed，不建任务；必须等用户在计划卡点击应用。
37. 你不能应用计划；decide_action 只能 ignore。计划 apply 只能由人通过 WS 触发。
38. batch_tasks 默认 dryRun=true；只有用户明确确认后才传 confirm=true。batch cancel 自动跳过 running。
39. get_task_failure 只返回脱敏摘要；不要据此编造 transcript 或文件内容。
```

更新 `PROMPT_VERSION` 自动跟随 `SUPERVISOR_PROMPT` 重新计算，不需要手改哈希。

`engine.ts` 增加 4 个 `tool(...)`；`service.ts` 的 `wrapped` 增加 4 个 `wrapTool`；`tools.ts` 的类型与 `bindTools` 增加 4 项。`SUPERVISOR_POLICY.allowedTools` 顺序与 prompt 一致。

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- supervisor-engine-mock supervisor-prompt
pnpm --filter @baton/core test -- supervisor-policy
pnpm --filter @baton/core test
```

Expected: PASS；真实引擎请求体包含 21 个工具名；prompt 长度不超过 3,705 字符（当前 3,222 字符 +15%）。如果超出，压缩现有规则，不提高上限。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/supervisor packages/core/src/supervisor/policy.ts apps/daemon/test packages/core/test
git commit -m "feat(daemon): 接线 21 个管家工具"
```

---

### Task C5: Web 计划卡

Blocking: Task C3
Slice type: tracer-bullet
Seam: component tests

**Files:**
- Create: `apps/web/src/features/supervisor/SupervisorPlanCard.tsx`
- Create: `apps/web/src/features/supervisor/SupervisorPlanCard.test.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorMessage.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorMessage.test.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/query.ts`

**Interfaces:**
- Consumes: C1 `PlanToolResult`；A5 `GET /api/supervisor/actions/:id` + WS decide。
- Produces: 计划卡应用/忽略/状态展示。

- [ ] **Step 1: Write failing tests**

```tsx
// SupervisorPlanCard.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandProvider } from '../../lib/command-context'
import { getSupervisorAction } from '../../lib/api'
import { useAppStore } from '../../stores/app'
import { SupervisorPlanCard } from './SupervisorPlanCard'

vi.mock('../../lib/api', () => ({ getSupervisorAction: vi.fn() }))

const plan = {
  triggerId: 'trigger-1',
  source: { nodeIds: ['n1'] },
  templateId: 'bugfix' as const,
  contextDigest: [],
  items: [
    {
      title: '修复登录',
      templateId: 'bugfix' as const,
      targetNodeId: null,
      agentTitle: 'Agent 1',
      contextNodeIds: ['n1'],
      engine: null,
      budgetUsd: null,
    },
  ],
}

function wrap(send = vi.fn().mockResolvedValue(undefined)) {
  useAppStore.setState({ activeWorkspaceId: 'w1' })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CommandProvider send={send}>
        <SupervisorPlanCard actionId="a1" plan={plan} initialStatus="proposed" />
      </CommandProvider>
    </QueryClientProvider>,
  )
  return send
}

describe('SupervisorPlanCard', () => {
  it('shows template, context count and acceptance seed, then applies through WS', async () => {
    vi.mocked(getSupervisorAction).mockResolvedValue({
      action: {
        id: 'a1',
        workspaceId: 'w1',
        threadId: 'th1',
        taskId: null,
        kind: 'triage_plan',
        status: 'applied',
        strength: 'inferred',
        mode: 'observe',
        reason: '计划',
        payload: plan,
        result: { createdTaskIds: ['t1'], failed: [] },
        policyVersion: 'p1',
        mandateVersion: null,
        dedupeKey: 'plan:1',
        createdAt: 1,
        updatedAt: 1,
        expiresAt: 100,
        appliedAt: 2,
        ignoredAt: null,
      },
    })
    const send = wrap()
    expect(screen.getByText('修复')).toBeVisible()
    expect(screen.getByText('上下文 1 个')).toBeVisible()
    expect(screen.getByText('复现步骤可执行')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '应用全部' }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: 'supervisor.action.decide',
        payload: { workspaceId: 'w1', actionId: 'a1', decision: 'apply' },
      }),
    )
  })

  it('shows a failed item and disables apply after expiry', async () => {
    vi.mocked(getSupervisorAction).mockResolvedValue({
      action: {
        // ...same action, status: 'expired', result: null
      },
    } as never)
    wrap()
    expect(await screen.findByText('计划已过期')).toBeVisible()
    expect(screen.queryByRole('button', { name: '应用全部' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @baton/web test -- SupervisorPlanCard SupervisorMessage`
Expected: FAIL because plan card does not exist.

- [ ] **Step 3: Implement plan card and wiring**

`lib/api.ts`：

```ts
export async function getSupervisorAction(actionId: string) {
  return SupervisorActionResponse.parse(
    await request(`/api/supervisor/actions/${encodeURIComponent(actionId)}`),
  )
}
```

`lib/query.ts` 加：

```ts
supervisorAction: (actionId: string) => ['supervisor', 'action', actionId] as const,
```

`SupervisorPlanCard.tsx`：

```tsx
import type { PlanPayload, SupervisorActionStatus } from '@baton/protocol'
import { templateById } from '@baton/core'
import { Button } from '@heroui/react/button'
import { Chip } from '@heroui/react/chip'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCommand } from '../../lib/command-context'
import { getSupervisorAction } from '../../lib/api'
import { queryKeys } from '../../lib/query'
import { useAppStore } from '../../stores/app'

export function SupervisorPlanCard({
  actionId,
  plan,
  initialStatus,
}: {
  actionId: string
  plan: PlanPayload
  initialStatus: SupervisorActionStatus
}) {
  const send = useCommand()
  const queryClient = useQueryClient()
  const action = useQuery({
    queryKey: queryKeys.supervisorAction(actionId),
    queryFn: () => getSupervisorAction(actionId),
    initialData: undefined,
  })
  const status = action.data?.action.status ?? initialStatus
  const result = action.data?.action.result as
    | { createdTaskIds: string[]; failed: Array<{ index: number; message: string }> }
    | null
    | undefined
  const template = templateById(plan.templateId)
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId)
  const decide = async (decision: 'apply' | 'ignore') => {
    if (!activeWorkspaceId) return
    await send({
      type: 'supervisor.action.decide',
      payload: { workspaceId: activeWorkspaceId, actionId, decision },
    })
    await queryClient.invalidateQueries({ queryKey: queryKeys.supervisorAction(actionId) })
  }
  if (status === 'expired') return <p className="text-xs text-danger">计划已过期</p>
  if (status === 'ignored') return <p className="text-xs text-muted">计划已忽略</p>
  if (status === 'failed') return <p className="text-xs text-danger">计划应用失败</p>
  return (
    <section aria-label="计划预览" className="flex flex-col gap-2 rounded-lg border border-separator bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">计划：{plan.items.length} 个任务</h3>
        {template ? <Chip size="sm" variant="soft" color="accent">{template.label}</Chip> : null}
      </div>
      <p className="text-xs text-muted">上下文摘要 {plan.contextDigest.length} 条</p>
      <ul className="flex flex-col gap-1">
        {plan.items.map((item) => (
          <li key={item.title} className="flex flex-col gap-0.5 rounded-md bg-default p-2">
            <span className="text-xs text-foreground">{item.title}</span>
            <span className="text-xs text-muted">
              上下文 {item.contextNodeIds.length} 个
            </span>
          </li>
        ))}
      </ul>
      {template ? (
        <div className="text-xs text-muted">
          <p>验收建议</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {template.acceptanceSeed.slice(0, 3).map((seed) => (
              <li key={seed}>- {seed}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result ? (
        <p className="text-xs text-muted">
          已创建 {result.createdTaskIds.length} 个；失败 {result.failed.length} 个
        </p>
      ) : null}
      {status === 'proposed' ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="primary" size="sm" onPress={() => void decide('apply')}>
            应用全部
          </Button>
          <Button variant="tertiary" size="sm" onPress={() => void decide('ignore')}>
            忽略
          </Button>
        </div>
      ) : null}
    </section>
  )
}
```

`SupervisorMessage.tsx` 解析：

```tsx
const planResults = message.toolCalls
  .filter((call) => call.name === 'plan_tasks' && call.ok)
  .map((call) => PlanToolResult.safeParse(call.result))
  .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
// 在 handoffEntries 之后渲染：
{planResults.map((result) => (
  <SupervisorPlanCard
    key={result.actionId}
    actionId={result.actionId}
    plan={result.plan}
    initialStatus={result.status}
  />
))}
```

`SupervisorMessage.test.tsx` 增加一条计划消息断言；测试需要 `CommandProvider` 与 `QueryClientProvider`，只包住计划用例。

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @baton/web test -- SupervisorPlanCard SupervisorMessage
pnpm --filter @baton/web typecheck
```

Expected: PASS；计划卡显示模板/上下文/seed；应用走 WS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/supervisor apps/web/src/lib
git commit -m "feat(web): 增加计划确认卡"
```

---

### Task C6: 集成与 Playwright 计划链路

Blocking: Task C1-C5
Slice type: verification
Seam: daemon integration + Playwright mock WS

**Files:**
- Create: `apps/web/e2e/supervisor-autonomy.spec.ts`
- Test: `apps/daemon/test/supervisor-plan-apply.test.ts`
- Test: `apps/daemon/test/supervisor-batch.test.ts`
- Test: 全量

- [ ] **Step 1: Add Playwright plan flow**

```ts
// apps/web/e2e/supervisor-autonomy.spec.ts
import { expect, test } from '@playwright/test'

test('plan card applies through WS and shows created count', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/workspaces') {
      return route.fulfill({
        json: { workspaces: [{ id: 'w1', name: 'demo', relPath: 'demo', trusted: true, projectHooks: 'off', trustedAt: 1, createdAt: 1 }] },
      })
    }
    if (path === '/api/canvas') {
      return route.fulfill({
        json: {
          canvas: { id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } },
          nodes: [],
          edges: [],
        },
      })
    }
    if (path === '/api/tasks') return route.fulfill({ json: { tasks: [] } })
    if (path === '/api/engines') return route.fulfill({ json: { engines: [] } })
    if (path === '/api/supervisor/status') return route.fulfill({ json: { configured: true, mode: 'explicit', policyVersion: 'p1' } })
    if (path === '/api/supervisor/messages') {
      return route.fulfill({
        json: {
          threadId: 'th1',
          messages: [
            {
              id: 'm1',
              threadId: 'th1',
              role: 'assistant',
              content: '这是计划，请确认。',
              toolCalls: [
                {
                  id: 'tc-plan',
                  name: 'plan_tasks',
                  args: {},
                  ok: true,
                  result: {
                    actionId: 'a1',
                    status: 'proposed',
                    plan: {
                      triggerId: 'trigger-1',
                      source: { nodeIds: ['n1'] },
                      templateId: 'bugfix',
                      contextDigest: [],
                      items: [
                        {
                          title: '修复登录',
                          templateId: 'bugfix',
                          targetNodeId: null,
                          agentTitle: 'Agent 1',
                          contextNodeIds: ['n1'],
                          engine: null,
                          budgetUsd: null,
                        },
                      ],
                    },
                  },
                },
              ],
              decision: null,
              meta: null,
              status: 'ok',
              error: null,
              createdAt: 2,
            },
          ],
        },
      })
    }
    if (path === '/api/supervisor/actions/a1') {
      return route.fulfill({
        json: {
          action: {
            id: 'a1',
            workspaceId: 'w1',
            threadId: 'th1',
            taskId: null,
            kind: 'triage_plan',
            status: 'applied',
            strength: 'inferred',
            mode: 'observe',
            reason: '计划',
            payload: { items: [] },
            result: { createdTaskIds: ['t1'], failed: [] },
            policyVersion: 'p1',
            mandateVersion: null,
            dedupeKey: 'plan:1',
            createdAt: 1,
            updatedAt: 2,
            expiresAt: 100,
            appliedAt: 2,
            ignoredAt: null,
          },
        },
      })
    }
    return route.fulfill({ status: 404, json: { code: 'not_found', message: 'not found' } })
  })

  await page.goto('/')
  await page.getByRole('button', { name: /demo/ }).click()
  await expect(page.getByText('计划：1 个任务')).toBeVisible()
  await page.getByRole('button', { name: '应用全部' }).click()
  await expect(page.getByText(/已创建 1 个/)).toBeVisible()
})
```

- [ ] **Step 2: Add daemon integration assertions**

在 `supervisor-plan-apply.test.ts` 增加：
- apply 幂等：第二次返回 `action_already_decided`，任务数不增加。
- 部分失败：`result.failed` 有 index，已创建任务仍是 todo。
- plan 目标失效：apply 返回 `action_not_applicable`，不创建任务。
- `decide_action` 传 apply：schema/execute 返回 `supervisor_action_forbidden`。

在 `supervisor-batch.test.ts` 增加：
- dryRun 默认 true，任务状态不变。
- `confirm=true` 才执行。
- cancel 排除 running，返回 `requiresConfirmation`。
- 部分失败逐条返回，不整体抛错。

- [ ] **Step 3: Run targeted tests**

```bash
pnpm --filter @evanfang0054/baton test -- supervisor-plan supervisor-batch
pnpm --filter @baton/web test -- SupervisorPlanCard
pnpm exec playwright test apps/web/e2e/supervisor-autonomy.spec.ts
```

Expected: PASS。

- [ ] **Step 4: Run full verify**

```bash
pnpm verify
```

Expected: 全绿。若 Playwright 因系统 Chrome 缺失失败，按 `PLAYWRIGHT_EXECUTABLE_PATH` 指定本机 Chrome，不下载 Chromium。

- [ ] **Step 5: Update plan status and commit**

把本文件 `status: planned` 改为 `status: completed`。

```bash
git add docs/plans/2026-11-22-m6-5-plan-templates-batch.md apps/web/e2e
git commit -m "docs(m6-5): 完成计划模板与批量计划"
```

---

## Plan C 完成标准

- 4 个模板字段完整，验收 seed 只出现在 verifier prompt 快照，不写进 task prompt。
- `plan_tasks` 只写 `proposed`，不建任务；1-6 条；返回模板/上下文/引擎/预算。
- 计划 apply 只由 human WS 触发；模型 `decide_action` 只能 ignore；重复 apply 幂等；部分失败 `applied + result.failed[]`。
- `create_tasks.dryRun` 与 `batch_tasks` 覆盖 enqueue/retry/cancel；cancel 排除 running。
- 建单上下文摘要最多 5 条，不含 transcript/文件正文。
- 工具面 21 个全部接线，prompt 长度不超过 3,705 字符。
- 计划卡可应用/忽略，过期/失败/部分失败有明确文案。
