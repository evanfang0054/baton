---
spec_ref: ../specs/2026-11-22-m6-5-supervisor-autonomy-design.md
spec_topic: m6-5-supervisor-autonomy
task_count: 7
estimated_phases: [tests, implementation, verification]
dod: "migration 0013、observe gate、supervisor_action 状态机、Mandate revalidate、human-only task.reauthorize、自动化设置与任务详情重新授权；pnpm verify 全绿"
status: completed
depends_on: []
---

# M6-5 Plan A：治理底座

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `agent-harness:subagent-driven-development`（推荐）或 `agent-harness:executing-plans`，按 task 逐条执行。步骤用 checkbox 跟踪。

**Goal:** 让总管的主动行为默认只落 `supervisor_action(proposed)`，任务恢复前按当前 policy 重新校验 Mandate，人可以在任务详情重新授权；本计划结束时 observe 无副作用、revalidate 可拒绝、human reauthorize 可用。

**Architecture:** 协议层先加 `autonomy`、TaskOrigin mandate 字段、`SupervisorAction` 与两个 WS 命令；core 提供 `effectiveAutonomy`、`buildMandate`、`validateMandate`、action 状态机；daemon 新增 action service 与 repository，runtime 接线 observe/revalidate/reauthorize/decide；web 只加设置与重新授权入口。Plan B/C 复用这里的 action ledger 与 Mandate。

**Tech Stack:** TypeScript ESM、zod 4、Drizzle/better-sqlite3、Fastify 5、React 19 + TanStack Query + HeroUI v3、vitest。

**Design sync:**
- 自动化设置新增“总管自治”区，沿用 `border-separator`、`bg-default`、`text-muted`、`text-warning`、`accent`；不新增颜色、字号、圆角。
- 状态不能只靠颜色：全局模式与两个能力开关都用可见文字 + 原生 select/checkbox，`aria-label` 与现有表单一致。
- 任务详情的“重新授权并继续”是 warning 语义按钮，落在 `TaskActions` 现有 warning section 内；Task A6 用组件测试验证文案与键盘可达。

**Contract mapping:**
- DoD 12/13/16/17/19：migration 0013、observe gate、模式矩阵、action 状态机、Mandate、reauthorize、human-only decide、audit。
- DoD 18：负空间检查（不新增外部 Source/DAG/自动验收/总管执行命令）。
- DoD 20：core 单测、daemon 集成、web 组件测试。

**Commit strategy:** 每个 task 末尾一次 commit，message 使用 `<type>(<scope>): <subject>`；本计划所有 commit 都在 `docs/m6-5-supervisor-autonomy` 派生的实现分支上。

**Spec interpretation（必须遵守）:** spec 4.3 的 `allowedActions` 列了 7 个动作，但 7.3 要求 revalidate 覆盖 `enqueue` 与 `apply_plan`。为了让这两个动作有可判定的授权位，`TaskAction` 增加 `enqueue`、`apply_plan`；这不是新增能力，只是把已有动作纳入同一授权快照。旧 origin 没有这些字段时按 `null` 兼容，不 backfill。

---

### Task A1: 协议加 autonomy、Mandate 字段、SupervisorAction 与 WS 命令

Blocking: none
Slice type: tracer-bullet
Seam: `TaskOrigin.safeParse` / `PolicySchema.parse` / `ClientMessage.parse`

**Files:**
- Modify: `packages/protocol/src/policy.ts`
- Modify: `packages/protocol/src/automation.ts`
- Modify: `packages/protocol/src/supervisor.ts`
- Create: `packages/protocol/src/supervisor-action.ts`
- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/policy-defaults.test.ts`
- Test: `packages/protocol/test/supervisor.test.ts`
- Test: `packages/protocol/test/commands.test.ts`
- Test: `packages/protocol/test/supervisor-action.test.ts`

**Interfaces:**
- Consumes: `Strength` from `supervisor.ts`; `Id`/`Timestamp` from `common.ts`; `Engine` from `enums.ts`.
- Produces: `AutonomyMode`、`AutonomyPolicy`、`TaskAction`、`SupervisorActionKind/Status`、`SupervisorAction`、`SupervisorActionDecideInput`、`TaskReauthorizeInput`。

- [ ] **Step 1: Write the failing tests**

```ts
// packages/protocol/test/policy-defaults.test.ts
import { describe, expect, it } from 'vitest'
import { PolicySchema } from '../src/policy.js'

describe('autonomy policy defaults', () => {
  it('defaults to observe / off / observe', () => {
    const policy = PolicySchema.parse({})
    expect(policy.autonomy).toEqual({
      mode: 'observe',
      autoRetry: 'off',
      attentionReminder: 'observe',
    })
  })

  it('rejects an unknown autonomy mode', () => {
    expect(PolicySchema.safeParse({ autonomy: { mode: 'always' } }).success).toBe(false)
  })
})
```

```ts
// packages/protocol/test/supervisor.test.ts（追加）
import { describe, expect, it } from 'vitest'
import { TaskOrigin } from '../src/supervisor.js'

const legacyOrigin = {
  source: 'supervisor-chat',
  triggerId: 'trigger-1',
  threadId: 'thread-1',
  actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
  workspaceId: 'workspace-1',
  targetNodeId: 'agent-1',
  contextNodeIds: [],
  policyVersion: 'policy-1',
  promptVersion: 'prompt-1',
  createdAt: 1,
}

describe('TaskOrigin mandate compatibility', () => {
  it('still parses an origin written before M6-5', () => {
    expect(TaskOrigin.safeParse(legacyOrigin).success).toBe(true)
  })

  it('parses mandate fields and rejects an unknown action', () => {
    const parsed = TaskOrigin.parse({
      ...legacyOrigin,
      scope: 'task',
      strength: 'explicit',
      allowedActions: ['retry', 'enqueue'],
      mandateVersion: 'm-1',
    })
    expect(parsed.allowedActions).toEqual(['retry', 'enqueue'])
    expect(
      TaskOrigin.safeParse({ ...legacyOrigin, allowedActions: ['delete_everything'] }).success,
    ).toBe(false)
  })
})
```

```ts
// packages/protocol/test/commands.test.ts（追加）
import { describe, expect, it } from 'vitest'
import { ClientMessage } from '../src/commands.js'

describe('M6-5 commands', () => {
  it('parses supervisor.action.decide and task.reauthorize', () => {
    const decide = ClientMessage.parse({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'supervisor.action.decide',
      payload: { workspaceId: 'w1', actionId: 'a1', decision: 'apply' },
    })
    expect(decide.type).toBe('supervisor.action.decide')

    const reauthorize = ClientMessage.parse({
      v: 1,
      id: 'c2',
      ts: 1,
      type: 'task.reauthorize',
      payload: { taskId: 't1' },
    })
    expect(reauthorize.type).toBe('task.reauthorize')
  })

  it('rejects an unknown decision', () => {
    expect(
      ClientMessage.safeParse({
        v: 1,
        id: 'c3',
        ts: 1,
        type: 'supervisor.action.decide',
        payload: { workspaceId: 'w1', actionId: 'a1', decision: 'execute' },
      }).success,
    ).toBe(false)
  })
})
```

```ts
// packages/protocol/test/supervisor-action.test.ts
import { describe, expect, it } from 'vitest'
import { SupervisorAction } from '../src/supervisor-action.js'

const action = {
  id: 'action-1',
  workspaceId: 'workspace-1',
  threadId: 'thread-1',
  taskId: 'task-1',
  kind: 'retry',
  status: 'proposed',
  strength: 'inferred',
  mode: 'observe',
  reason: '任务失败，建议重试',
  payload: { taskId: 'task-1' },
  result: null,
  policyVersion: 'policy-1',
  mandateVersion: 'mandate-1',
  dedupeKey: 'retry:task-1:1',
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 86_400_001,
  appliedAt: null,
  ignoredAt: null,
}

describe('SupervisorAction', () => {
  it('parses a proposed action', () => {
    expect(SupervisorAction.parse(action)).toMatchObject({ status: 'proposed' })
  })

  it('rejects a terminal status without reason drift', () => {
    expect(SupervisorAction.safeParse({ ...action, status: 'done' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @baton/protocol test`
Expected: FAIL because `AutonomyPolicy`、`TaskAction`、`SupervisorAction`、new commands do not exist.

- [ ] **Step 3: Implement protocol changes**

`packages/protocol/src/policy.ts`：

```ts
export const AutonomyMode = z.enum(['off', 'observe', 'auto'])
export type AutonomyMode = z.infer<typeof AutonomyMode>

export const AutonomyPolicy = z.object({
  mode: AutonomyMode.default('observe'),
  autoRetry: AutonomyMode.default('off'),
  attentionReminder: AutonomyMode.default('observe'),
})
export type AutonomyPolicy = z.infer<typeof AutonomyPolicy>

export const PolicySchema = z.object({
  verify: VerifyPolicy.default(() => VerifyPolicy.parse({})),
  approval: ApprovalPolicy.default(() => ApprovalPolicy.parse({})),
  autopilot: AutopilotPolicy.default(() => AutopilotPolicy.parse({})),
  autonomy: AutonomyPolicy.default(() => AutonomyPolicy.parse({})),
})
```

`packages/protocol/src/automation.ts` 的 `AutomationPolicyPatch` 增加：

```ts
autonomy: z
  .object({
    mode: AutonomyMode.optional(),
    autoRetry: AutonomyMode.optional(),
    attentionReminder: AutonomyMode.optional(),
  })
  .strict()
  .optional(),
```

`packages/protocol/src/supervisor.ts` 增加 `TaskAction`，并给 `TaskOrigin` 加可选字段（保持 `.strict()`）：

```ts
export const TaskAction = z.enum([
  'retry',
  'reopen',
  'cancel',
  'reply',
  'inject_context',
  'handoff',
  'update_canvas',
  'enqueue',
  'apply_plan',
])
export type TaskAction = z.infer<typeof TaskAction>

export const TaskOrigin = z
  .object({
    // ...existing fields...
    scope: z.literal('task').optional(),
    strength: Strength.optional(),
    allowedActions: z.array(TaskAction).max(16).optional(),
    mandateVersion: z.string().min(1).optional(),
  })
  .strict()
```

创建 `packages/protocol/src/supervisor-action.ts`，完整内容：

```ts
import { z } from 'zod'
import { Id, Timestamp } from './common.js'
import { Engine } from './enums.js'
import { Strength } from './supervisor.js'

export const SupervisorActionKind = z.enum([
  'triage_plan',
  'retry',
  'reopen',
  'attention_reminder',
  'batch_enqueue',
  'batch_retry',
  'batch_cancel',
])
export type SupervisorActionKind = z.infer<typeof SupervisorActionKind>

export const SupervisorActionStatus = z.enum([
  'proposed',
  'applied',
  'ignored',
  'failed',
  'expired',
])
export type SupervisorActionStatus = z.infer<typeof SupervisorActionStatus>

export const TaskTemplateId = z.enum(['bugfix', 'feature', 'review', 'handoff'])
export type TaskTemplateId = z.infer<typeof TaskTemplateId>

export const PlanItem = z
  .object({
    title: z.string().min(1).max(80),
    templateId: TaskTemplateId.nullable().default(null),
    targetNodeId: Id.nullable().default(null),
    agentTitle: z.string().min(1).max(80).nullable().default(null),
    contextNodeIds: z.array(Id).max(40).default([]),
    engine: Engine.nullable().default(null),
    budgetUsd: z.number().finite().nonnegative().nullable().default(null),
  })
  .strict()
export type PlanItem = z.infer<typeof PlanItem>

export const PlanContextItem = z
  .object({
    taskId: Id,
    title: z.string().min(1).max(200),
    status: z.string().min(1),
    source: z.enum(['same_agent', 'handoff', 'context_node', 'recent_failure', 'title']),
    failure: z.string().max(200).nullable().default(null),
  })
  .strict()
export type PlanContextItem = z.infer<typeof PlanContextItem>

export const PlanPayload = z
  .object({
    items: z.array(PlanItem).min(1).max(6),
    templateId: TaskTemplateId.nullable().default(null),
    contextDigest: z.array(PlanContextItem).max(5).default([]),
    source: z
      .object({
        nodeIds: z.array(Id).max(40).default([]),
      })
      .strict(),
    triggerId: Id,
  })
  .strict()
export type PlanPayload = z.infer<typeof PlanPayload>

export const PlanApplyResult = z
  .object({
    createdTaskIds: z.array(Id).default([]),
    failed: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            code: z.string().min(1),
            message: z.string().min(1),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
export type PlanApplyResult = z.infer<typeof PlanApplyResult>

export const SupervisorAction = z
  .object({
    id: Id,
    workspaceId: Id,
    threadId: Id.nullable(),
    taskId: Id.nullable(),
    kind: SupervisorActionKind,
    status: SupervisorActionStatus,
    strength: Strength,
    mode: z.enum(['observe', 'auto']),
    reason: z.string().min(1).max(2000),
    payload: z.unknown(),
    result: z.unknown().nullable(),
    policyVersion: z.string().min(1),
    mandateVersion: z.string().min(1).nullable(),
    dedupeKey: z.string().min(1).max(300),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    expiresAt: Timestamp,
    appliedAt: Timestamp.nullable(),
    ignoredAt: Timestamp.nullable(),
  })
  .strict()
export type SupervisorAction = z.infer<typeof SupervisorAction>

export const SupervisorActionListQuery = z.object({
  workspaceId: Id,
  status: SupervisorActionStatus.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})
export type SupervisorActionListQuery = z.infer<typeof SupervisorActionListQuery>

export const SupervisorActionListResponse = z.object({
  actions: z.array(SupervisorAction),
})
export type SupervisorActionListResponse = z.infer<typeof SupervisorActionListResponse>

export const SupervisorActionResponse = z.object({
  action: SupervisorAction,
})
export type SupervisorActionResponse = z.infer<typeof SupervisorActionResponse>

export const SupervisorActionDecideInput = z
  .object({
    workspaceId: Id,
    actionId: Id,
    decision: z.enum(['apply', 'ignore']),
  })
  .strict()
export type SupervisorActionDecideInput = z.infer<typeof SupervisorActionDecideInput>

export const TaskReauthorizeInput = z.object({ taskId: Id }).strict()
export type TaskReauthorizeInput = z.infer<typeof TaskReauthorizeInput>
```

`packages/protocol/src/commands.ts` 引入两个新 input 并加入 union：

```ts
import { SupervisorActionDecideInput, TaskReauthorizeInput } from './supervisor-action.js'

export const ClientMessage = z.discriminatedUnion('type', [
  // ...existing commands...
  CommandBase.extend({ type: z.literal('supervisor.action.decide'), payload: SupervisorActionDecideInput }),
  CommandBase.extend({ type: z.literal('task.reauthorize'), payload: TaskReauthorizeInput }),
])
```

`packages/protocol/src/index.ts` 增加 `export * from './supervisor-action.js'`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @baton/protocol test`
Expected: PASS；旧 fixture 没有 autonomy 时解析出默认值。

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src packages/protocol/test
git commit -m "feat(protocol): 增加 M6-5 自治与授权协议"
```

---

### Task A2: migration 0013 与两张表

Blocking: Task A1
Slice type: tracer-bullet
Seam: `migrateDb` on a 0012 fixture DB

**Files:**
- Modify: `apps/daemon/src/db/schema.ts`
- Create: `apps/daemon/migrations/0013_m6_5_supervisor_autonomy.sql`
- Modify: `apps/daemon/migrations/meta/_journal.json`
- Create: `apps/daemon/migrations/meta/0013_snapshot.json`（由 drizzle-kit 生成）
- Modify: `apps/daemon/test/migrate.test.ts`
- Create: `apps/daemon/test/migration-0013.test.ts`

**Interfaces:**
- Consumes: A1 的 `supervisor_action` / `task_failure` 字段语义。
- Produces: `supervisorAction`、`taskFailure` drizzle tables；可升级的 0013。

- [ ] **Step 1: Write the failing migration test**

```ts
// apps/daemon/test/migration-0013.test.ts
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
  const dir = mkdtempSync(join(tmpdir(), 'baton-m13-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'meta'), { recursive: true })
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> }
  const entries = journal.entries.filter((entry) => entry.idx <= maxIdx)
  for (const entry of entries) {
    copyFileSync(join(migrationsDir, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`))
  }
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  return dir
}

describe('migration 0013', () => {
  it('adds the supervisor action and task failure ledgers', () => {
    const oldDir = copyThrough(12)
    const raw = openDb(':memory:')
    process.env.BATON_MIGRATIONS_DIR = oldDir
    migrateDb(raw)
    raw
      .prepare('insert into workspace (id, name, rel_path, created_at) values (?, ?, ?, ?)')
      .run('w1', 'demo', 'demo', 1)
    raw
      .prepare(
        "insert into task (id, workspace_id, title, prompt, status, engine, retry_count, dangerously_skip_permissions, created_at, updated_at) values ('t1','w1','t','p','failed','fake',0,0,1,1)",
      )
      .run()
    raw
      .prepare('update task set origin_json = ? where id = ?')
      .run(JSON.stringify({ source: 'canvas', policyVersion: 'p1' }), 't1')

    process.env.BATON_MIGRATIONS_DIR = migrationsDir
    migrateDb(raw)

    const tables = raw
      .prepare(
        "select name from sqlite_master where type='table' and name in ('supervisor_action','task_failure') order by name",
      )
      .all()
    expect(tables).toEqual([{ name: 'supervisor_action' }, { name: 'task_failure' }])
    const indexes = raw
      .prepare(
        "select name from sqlite_master where type='index' and name in ('supervisor_action_dedupe_idx','supervisor_action_status_idx','task_failure_task_idx') order by name",
      )
      .all()
    expect(indexes).toEqual([
      { name: 'supervisor_action_dedupe_idx' },
      { name: 'supervisor_action_status_idx' },
      { name: 'task_failure_task_idx' },
    ])
    expect(raw.prepare("select origin_json from task where id='t1'").get()).toEqual({
      origin_json: JSON.stringify({ source: 'canvas', policyVersion: 'p1' }),
    })
    raw.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evanfang0054/baton test -- migration-0013`
Expected: FAIL because migration 0013/tables do not exist.

- [ ] **Step 3: Add drizzle tables and generate migration**

在 `apps/daemon/src/db/schema.ts` 末尾追加：

```ts
export const supervisorAction = sqliteTable(
  'supervisor_action',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    threadId: text('thread_id'),
    taskId: text('task_id'),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    strength: text('strength').notNull(),
    mode: text('mode').notNull(),
    reason: text('reason').notNull(),
    payloadJson: text('payload_json').notNull(),
    resultJson: text('result_json'),
    policyVersion: text('policy_version').notNull(),
    mandateVersion: text('mandate_version'),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    appliedAt: integer('applied_at'),
    ignoredAt: integer('ignored_at'),
  },
  (t) => [
    uniqueIndex('supervisor_action_dedupe_idx').on(t.dedupeKey),
    index('supervisor_action_status_idx').on(t.workspaceId, t.status, t.createdAt),
  ],
)

export const taskFailure = sqliteTable(
  'task_failure',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspace.id),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id),
    sessionId: text('session_id'),
    attempt: integer('attempt').notNull(),
    stage: text('stage').notNull(),
    lastError: text('last_error').notNull(),
    retryable: integer('retryable', { mode: 'boolean' }).notNull(),
    affectedPathsJson: text('affected_paths_json'),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('task_failure_task_idx').on(t.taskId, t.createdAt)],
)
```

Run:

```bash
pnpm --filter @evanfang0054/baton exec drizzle-kit generate --name m6_5_supervisor_autonomy
```

确认生成 `apps/daemon/migrations/0013_m6_5_supervisor_autonomy.sql`、`meta/0013_snapshot.json`，并在 `meta/_journal.json` 追加 `idx: 13`。SQL 必须包含两张表与三个索引。

更新 `apps/daemon/test/migrate.test.ts`：

```ts
expect(before.filter((row) => row.type === 'table')).toHaveLength(21)
// 在索引数组中加入：
'supervisor_action_dedupe_idx',
'supervisor_action_status_idx',
'task_failure_task_idx',
```

- [ ] **Step 4: Run migration tests**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- migrate migration-0013
```

Expected: PASS；0012 数据库插入旧 `origin_json` 后升级不丢数据。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/db/schema.ts apps/daemon/migrations apps/daemon/test/migrate.test.ts apps/daemon/test/migration-0013.test.ts
git commit -m "feat(daemon): 增加 M6-5 账本迁移 0013"
```

---

### Task A3: core 自治、Mandate 与 action 状态机

Blocking: Task A1
Slice type: tracer-bullet
Seam: 纯函数单测

**Files:**
- Create: `packages/core/src/supervisor/autonomy.ts`
- Create: `packages/core/src/supervisor/mandate.ts`
- Create: `packages/core/src/supervisor/action.ts`
- Modify: `packages/core/src/supervisor/policy.ts`
- Modify: `packages/core/src/supervisor/index.ts`
- Test: `packages/core/test/supervisor-autonomy.test.ts`
- Test: `packages/core/test/supervisor-mandate.test.ts`
- Test: `packages/core/test/supervisor-action.test.ts`

**Interfaces:**
- Consumes: A1 的 `AutonomyMode`、`TaskAction`、`TaskOrigin`、`Policy`。
- Produces: `effectiveAutonomy`、`capabilityAutonomy`、`buildMandate`、`validateMandate`、`canTransitionAction`、`isActionExpired`、`ACTION_TTL_MS`、`ACTION_DEDUPE_WINDOW_MS`。

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/test/supervisor-autonomy.test.ts
import { describe, expect, it } from 'vitest'
import { PolicySchema } from '@baton/protocol'
import { capabilityAutonomy, effectiveAutonomy } from '../src/supervisor/autonomy.js'

describe('effectiveAutonomy', () => {
  it('never exceeds the global mode', () => {
    expect(effectiveAutonomy('observe', 'auto')).toBe('observe')
    expect(effectiveAutonomy('off', 'observe')).toBe('off')
    expect(effectiveAutonomy('auto', 'observe')).toBe('observe')
  })

  it('turns auto into observe under kill switch, but keeps observe', () => {
    const policy = PolicySchema.parse({
      autonomy: { mode: 'auto', autoRetry: 'auto', attentionReminder: 'observe' },
    })
    expect(capabilityAutonomy(policy, 'autoRetry', { killSwitch: true })).toBe('observe')
    expect(capabilityAutonomy(policy, 'autoRetry', { killSwitch: false })).toBe('auto')
    expect(capabilityAutonomy(policy, 'attentionReminder', { killSwitch: true })).toBe('observe')
  })
})
```

```ts
// packages/core/test/supervisor-mandate.test.ts
import { describe, expect, it } from 'vitest'
import { PolicySchema, type TaskOrigin } from '@baton/protocol'
import { buildMandate, DEFAULT_TASK_ACTIONS, validateMandate } from '../src/supervisor/mandate.js'

function origin(overrides: Partial<TaskOrigin> = {}): TaskOrigin {
  const mandate = buildMandate({
    strength: 'explicit',
    allowedActions: ['retry', 'reopen'],
    policyVersion: 'policy-1',
    promptVersion: 'prompt-1',
  })
  return {
    source: 'supervisor-chat',
    triggerId: 'trigger-1',
    threadId: 'thread-1',
    actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
    workspaceId: 'w1',
    targetNodeId: 'a1',
    contextNodeIds: [],
    policyVersion: 'policy-1',
    promptVersion: 'prompt-1',
    createdAt: 1,
    ...mandate,
    ...overrides,
  }
}

const policy = PolicySchema.parse({})
const gate = {
  workspaceTrusted: true,
  killSwitch: false,
  autonomy: 'auto' as const,
  capability: 'auto' as const,
}

describe('validateMandate', () => {
  it('allows an explicit action listed in allowedActions', () => {
    expect(
      validateMandate({
        origin: origin(),
        requestedAction: 'retry',
        requestedStrength: 'explicit',
        currentPolicyVersion: 'policy-1',
        gate,
      }),
    ).toEqual({ ok: true })
  })

  it('rejects an action not in allowedActions without touching the task', () => {
    const result = validateMandate({
      origin: origin(),
      requestedAction: 'cancel',
      requestedStrength: 'explicit',
      currentPolicyVersion: 'policy-1',
      gate,
    })
    expect(result).toMatchObject({ ok: false, code: 'mandate_revoked', detail: { reason: 'action_not_allowed' } })
  })

  it('rejects inferred actions when policy changed or autonomy is not auto', () => {
    expect(
      validateMandate({
        origin: origin(),
        requestedAction: 'retry',
        requestedStrength: 'inferred',
        currentPolicyVersion: 'policy-2',
        gate,
      }),
    ).toMatchObject({ ok: false, detail: { reason: 'policy_changed' } })

    expect(
      validateMandate({
        origin: origin(),
        requestedAction: 'retry',
        requestedStrength: 'inferred',
        currentPolicyVersion: 'policy-1',
        gate: { ...gate, capability: 'observe' },
      }),
    ).toMatchObject({ ok: false, detail: { reason: 'autonomy_not_auto' } })
  })

  it('requires a mandate for inferred actions and tolerates legacy origin for explicit ones', () => {
    expect(
      validateMandate({
        origin: null,
        requestedAction: 'retry',
        requestedStrength: 'inferred',
        currentPolicyVersion: 'policy-1',
        gate,
      }),
    ).toMatchObject({ ok: false, detail: { reason: 'missing_mandate' } })

    expect(
      validateMandate({
        origin: null,
        requestedAction: 'retry',
        requestedStrength: 'explicit',
        currentPolicyVersion: 'policy-1',
        gate,
      }),
    ).toEqual({ ok: true })
  })

  it('accepts the default action set', () => {
    expect(DEFAULT_TASK_ACTIONS).toContain('enqueue')
    expect(DEFAULT_TASK_ACTIONS).toContain('apply_plan')
  })
})
```

```ts
// packages/core/test/supervisor-action.test.ts
import { describe, expect, it } from 'vitest'
import { canTransitionAction, isActionExpired } from '../src/supervisor/action.js'

describe('supervisor action state machine', () => {
  it('only allows proposed to terminal states', () => {
    expect(canTransitionAction('proposed', 'applied')).toBe(true)
    expect(canTransitionAction('proposed', 'ignored')).toBe(true)
    expect(canTransitionAction('applied', 'ignored')).toBe(false)
    expect(canTransitionAction('expired', 'applied')).toBe(false)
  })

  it('expires at the boundary', () => {
    expect(isActionExpired({ expiresAt: 100 }, 100)).toBe(true)
    expect(isActionExpired({ expiresAt: 100 }, 99)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @baton/core test -- supervisor-autonomy supervisor-mandate supervisor-action`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement core functions**

`packages/core/src/supervisor/policy.ts` 把 `shortHash` 改为导出：

```ts
export function supervisorShortHash(input: string): string {
  // existing body
}
export function supervisorPolicyVersion(policy: SupervisorPolicy, promptVersion: string): string {
  return supervisorShortHash(JSON.stringify({ ...policy, promptVersion })).slice(0, 12)
}
```

`packages/core/src/supervisor/autonomy.ts`：

```ts
import type { AutonomyMode, Policy } from '@baton/protocol'

const RANK: Record<AutonomyMode, number> = { off: 0, observe: 1, auto: 2 }

export function effectiveAutonomy(global: AutonomyMode, capability: AutonomyMode): AutonomyMode {
  return RANK[capability] <= RANK[global] ? capability : global
}

export function capabilityAutonomy(
  policy: Policy,
  capability: 'autoRetry' | 'attentionReminder',
  gate: { killSwitch: boolean },
): AutonomyMode {
  const mode = effectiveAutonomy(policy.autonomy.mode, policy.autonomy[capability])
  return gate.killSwitch && mode === 'auto' ? 'observe' : mode
}
```

`packages/core/src/supervisor/mandate.ts`：

```ts
import type { AutonomyMode, Policy, Strength, TaskAction, TaskOrigin } from '@baton/protocol'
import { effectiveAutonomy } from './autonomy.js'
import { supervisorShortHash } from './policy.js'

export const DEFAULT_TASK_ACTIONS: TaskAction[] = [
  'retry',
  'reopen',
  'cancel',
  'reply',
  'inject_context',
  'handoff',
  'update_canvas',
  'enqueue',
  'apply_plan',
]

export interface TaskMandate {
  scope: 'task'
  strength: Strength
  allowedActions: TaskAction[]
  policyVersion: string
  promptVersion: string
  mandateVersion: string
}

export function buildMandate(input: {
  strength: Strength
  allowedActions: TaskAction[]
  policyVersion: string
  promptVersion: string
}): TaskMandate {
  const allowedActions = [...new Set(input.allowedActions)].sort()
  return {
    scope: 'task',
    strength: input.strength,
    allowedActions,
    policyVersion: input.policyVersion,
    promptVersion: input.promptVersion,
    mandateVersion: supervisorShortHash(
      JSON.stringify({
        scope: 'task',
        allowedActions,
        policyVersion: input.policyVersion,
      }),
    ).slice(0, 12),
  }
}

export interface MandateGate {
  workspaceTrusted: boolean
  killSwitch: boolean
  autonomy: AutonomyMode
  capability: AutonomyMode
}

export type MandateValidation =
  | { ok: true }
  | {
      ok: false
      code: 'mandate_revoked'
      reason: string
      detail: {
        requestedAction: TaskAction
        originPolicyVersion: string | null
        currentPolicyVersion: string
        reason: string
      }
    }

export function validateMandate(input: {
  origin: TaskOrigin | null
  requestedAction: TaskAction
  requestedStrength: Strength
  currentPolicyVersion: string
  gate: MandateGate
}): MandateValidation {
  const inferred = input.requestedStrength === 'inferred'
  const revoked = (reason: string): MandateValidation => ({
    ok: false,
    code: 'mandate_revoked',
    reason,
    detail: {
      requestedAction: input.requestedAction,
      originPolicyVersion: input.origin?.policyVersion ?? null,
      currentPolicyVersion: input.currentPolicyVersion,
      reason,
    },
  })

  if (inferred) {
    if (!input.gate.workspaceTrusted) return revoked('workspace_untrusted')
    if (input.gate.killSwitch) return revoked('kill_switch_on')
    const effective = effectiveAutonomy(input.gate.autonomy, input.gate.capability)
    if (effective !== 'auto') return revoked('autonomy_not_auto')
  }
  if (!input.origin) return inferred ? revoked('missing_mandate') : { ok: true }

  const origin = input.origin
  if (!origin.allowedActions || !origin.mandateVersion || !origin.strength) {
    return revoked('legacy_origin')
  }
  if (!origin.allowedActions.includes(input.requestedAction)) return revoked('action_not_allowed')
  const expected = buildMandate({
    strength: origin.strength,
    allowedActions: origin.allowedActions,
    policyVersion: origin.policyVersion,
    promptVersion: origin.promptVersion,
  }).mandateVersion
  if (origin.mandateVersion !== expected) return revoked('mandate_version_mismatch')
  if (inferred && origin.policyVersion !== input.currentPolicyVersion) return revoked('policy_changed')
  return { ok: true }
}
```

`packages/core/src/supervisor/action.ts`：

```ts
import type { SupervisorActionStatus } from '@baton/protocol'

export const ACTION_TTL_MS = 24 * 60 * 60 * 1000
export const ACTION_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000
export const PROPOSED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const TRANSITIONS: Record<SupervisorActionStatus, SupervisorActionStatus[]> = {
  proposed: ['applied', 'ignored', 'failed', 'expired'],
  applied: [],
  ignored: [],
  failed: [],
  expired: [],
}

export function canTransitionAction(
  from: SupervisorActionStatus,
  to: SupervisorActionStatus,
): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isActionExpired(action: { expiresAt: number }, now: number): boolean {
  return action.expiresAt <= now
}
```

`packages/core/src/supervisor/index.ts` 导出 `autonomy.js`、`mandate.js`、`action.js`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @baton/core test -- supervisor-autonomy supervisor-mandate supervisor-action`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/supervisor packages/core/test
git commit -m "feat(core): 增加管家自治与 Mandate 纯函数"
```

---

### Task A4: daemon action ledger 与状态机

Blocking: Task A2, Task A3
Slice type: tracer-bullet
Seam: `createSupervisorActionService` against a temp SQLite DB

**Files:**
- Create: `apps/daemon/src/db/supervisor-action-repository.ts`
- Create: `apps/daemon/src/supervisor/actions.ts`
- Test: `apps/daemon/test/supervisor-actions.test.ts`

**Interfaces:**
- Consumes: A2 tables、A3 `canTransitionAction`/`isActionExpired`/`ACTION_TTL_MS`。
- Produces: `createSupervisorActionService(deps)`，方法 `propose`、`decide`、`expire`、`listProposed`、`get`。

- [ ] **Step 1: Write failing tests**

```ts
// apps/daemon/test/supervisor-actions.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { createSupervisorActionService } from '../src/supervisor/actions.js'
import { createTestDb, seedTask, type TestDb } from './helpers/db.js'

const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((entry) => entry.raw.close()))

function setup() {
  const database = createTestDb()
  dbs.push(database)
  const seeded = seedTask(database.raw, { taskStatus: 'failed' })
  let now = 1_000
  const transitions: string[] = []
  const service = createSupervisorActionService({
    db: database.db,
    now: () => now,
    newId: () => `action-${now++}`,
    policyVersion: () => 'policy-1',
    requireMandate: () => null,
    applyTransition: (taskId, event) => {
      transitions.push(`${taskId}:${event.type}`)
      return {
        ok: true,
        taskId,
        status: 'queued',
        previousStatus: 'failed',
        retryCount: 1,
        waitingReason: null,
        events: [],
      }
    },
    enqueueTask: (taskId) => ({ ok: true, status: 'queued' }),
  })
  return { database, seeded, service, transitions, setNow: (value: number) => (now = value) }
}

const base = (taskId: string) => ({
  workspaceId: 'ignored',
  threadId: 'thread-1',
  taskId,
  kind: 'retry' as const,
  strength: 'inferred' as const,
  mode: 'observe' as const,
  reason: '任务失败，建议重试',
  payload: { taskId },
  policyVersion: 'policy-1',
  mandateVersion: 'mandate-1',
  dedupeKey: `retry:${taskId}:1`,
})

describe('supervisor action service', () => {
  it('proposing observe does not touch task state and dedupes', () => {
    const { seeded, service, transitions } = setup()
    const first = service.propose({ ...base(seeded.taskId), workspaceId: seeded.workspaceId })
    const second = service.propose({ ...base(seeded.taskId), workspaceId: seeded.workspaceId })
    expect(first.ok).toBe(true)
    expect(second.ok && second.duplicate).toBe(true)
    expect(transitions).toEqual([])
    expect(service.listProposed(seeded.workspaceId)).toHaveLength(1)
  })

  it('applies only as human, and writes applied', () => {
    const { seeded, service, transitions } = setup()
    const proposed = service.propose({ ...base(seeded.taskId), workspaceId: seeded.workspaceId })
    if (!proposed.ok) throw new Error(proposed.error.message)
    const forbidden = service.decide({
      workspaceId: seeded.workspaceId,
      actionId: proposed.action.id,
      actor: 'supervisor',
      decision: 'apply',
    })
    expect(forbidden).toMatchObject({ ok: false, error: { code: 'supervisor_action_forbidden' } })
    const applied = service.decide({
      workspaceId: seeded.workspaceId,
      actionId: proposed.action.id,
      actor: 'human',
      decision: 'apply',
    })
    expect(applied.ok).toBe(true)
    expect(transitions).toEqual([`${seeded.taskId}:retry`])
    expect(service.get(proposed.action.id)?.status).toBe('applied')
  })

  it('expires proposed actions and refuses reuse', () => {
    const { seeded, service, setNow } = setup()
    const proposed = service.propose({ ...base(seeded.taskId), workspaceId: seeded.workspaceId })
    if (!proposed.ok) throw new Error(proposed.error.message)
    setNow(proposed.action.expiresAt)
    expect(service.expire()).toBe(1)
    const applied = service.decide({
      workspaceId: seeded.workspaceId,
      actionId: proposed.action.id,
      actor: 'human',
      decision: 'apply',
    })
    expect(applied).toMatchObject({ ok: false, error: { code: 'action_expired' } })
  })

  it('cleans proposed after 7 days and terminal after 30 days', () => {
    const first = setup()
    const proposed = first.service.propose({
      ...base(first.seeded.taskId),
      workspaceId: first.seeded.workspaceId,
    })
    if (!proposed.ok) throw new Error(proposed.error.message)
    first.setNow(proposed.action.createdAt + 7 * 24 * 60 * 60 * 1000 + 1)
    expect(first.service.cleanup()).toBe(1)

    const second = setup()
    const ignored = second.service.propose({
      ...base(second.seeded.taskId),
      workspaceId: second.seeded.workspaceId,
    })
    if (!ignored.ok) throw new Error(ignored.error.message)
    second.service.decide({
      workspaceId: second.seeded.workspaceId,
      actionId: ignored.action.id,
      actor: 'human',
      decision: 'ignore',
    })
    second.setNow(ignored.action.createdAt + 30 * 24 * 60 * 60 * 1000 + 1)
    expect(second.service.cleanup()).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-actions`
Expected: FAIL because service/repository do not exist.

- [ ] **Step 3: Implement repository and service**

`apps/daemon/src/db/supervisor-action-repository.ts`：

```ts
import { and, desc, eq, lt, lte, ne, or } from 'drizzle-orm'
import { SupervisorAction } from '@baton/protocol'
import { supervisorAction } from './schema.js'
import type { Db, Tx } from './types.js'

function toAction(row: typeof supervisorAction.$inferSelect): SupervisorAction {
  return SupervisorAction.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    threadId: row.threadId,
    taskId: row.taskId,
    kind: row.kind,
    status: row.status,
    strength: row.strength,
    mode: row.mode,
    reason: row.reason,
    payload: JSON.parse(row.payloadJson) as unknown,
    result: row.resultJson ? (JSON.parse(row.resultJson) as unknown) : null,
    policyVersion: row.policyVersion,
    mandateVersion: row.mandateVersion,
    dedupeKey: row.dedupeKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    appliedAt: row.appliedAt,
    ignoredAt: row.ignoredAt,
  })
}

export function insertAction(tx: Tx, action: SupervisorAction): void {
  tx.insert(supervisorAction)
    .values({
      id: action.id,
      workspaceId: action.workspaceId,
      threadId: action.threadId,
      taskId: action.taskId,
      kind: action.kind,
      status: action.status,
      strength: action.strength,
      mode: action.mode,
      reason: action.reason,
      payloadJson: JSON.stringify(action.payload),
      resultJson: action.result === null ? null : JSON.stringify(action.result),
      policyVersion: action.policyVersion,
      mandateVersion: action.mandateVersion,
      dedupeKey: action.dedupeKey,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      expiresAt: action.expiresAt,
      appliedAt: action.appliedAt,
      ignoredAt: action.ignoredAt,
    })
    .run()
}

export function getActionRow(db: Db, id: string): SupervisorAction | null {
  const row = db.select().from(supervisorAction).where(eq(supervisorAction.id, id)).get()
  return row ? toAction(row) : null
}

export function findActionByDedupeKey(db: Db, key: string): SupervisorAction | null {
  const row = db.select().from(supervisorAction).where(eq(supervisorAction.dedupeKey, key)).get()
  return row ? toAction(row) : null
}

export function listActionRows(
  db: Db,
  input: { workspaceId: string; status?: string; limit?: number },
): SupervisorAction[] {
  const where = input.status
    ? and(eq(supervisorAction.workspaceId, input.workspaceId), eq(supervisorAction.status, input.status))
    : eq(supervisorAction.workspaceId, input.workspaceId)
  return db
    .select()
    .from(supervisorAction)
    .where(where)
    .orderBy(desc(supervisorAction.createdAt))
    .limit(input.limit ?? 20)
    .all()
    .map(toAction)
}

export function listExpiredProposed(db: Db, now: number): SupervisorAction[] {
  return db
    .select()
    .from(supervisorAction)
    .where(and(eq(supervisorAction.status, 'proposed'), lte(supervisorAction.expiresAt, now)))
    .all()
    .map(toAction)
}

export function deleteActionsBefore(
  db: Db,
  proposedBefore: number,
  terminalBefore: number,
): number {
  return db
    .delete(supervisorAction)
    .where(
      or(
        and(eq(supervisorAction.status, 'proposed'), lt(supervisorAction.createdAt, proposedBefore)),
        and(ne(supervisorAction.status, 'proposed'), lt(supervisorAction.updatedAt, terminalBefore)),
      ),
    )
    .run().changes
}
```

`apps/daemon/src/supervisor/actions.ts`：

```ts
import {
  ACTION_TTL_MS,
  PROPOSED_RETENTION_MS,
  TERMINAL_RETENTION_MS,
  canTransitionAction,
  isActionExpired,
} from '@baton/core'
import { SupervisorAction, type SupervisorActionKind, type Strength, type TaskAction } from '@baton/protocol'
import { eq } from 'drizzle-orm'
import { insertAudit } from '../db/repositories.js'
import { supervisorAction } from '../db/schema.js'
import {
  deleteActionsBefore,
  findActionByDedupeKey,
  getActionRow,
  insertAction,
  listActionRows,
  listExpiredProposed,
} from '../db/supervisor-action-repository.js'
import type { Db } from '../db/types.js'
import { appError, type AppError } from '../errors.js'
import type { EnqueueTaskResult } from './tools.js'
import type { TransitionOutcome } from '../runtime/types.js'

export interface SupervisorActionServiceDeps {
  db: Db
  now: () => number
  newId: () => string
  policyVersion: (workspaceId: string) => string
  requireMandate: (taskId: string, action: TaskAction, strength: Strength) => AppError | null
  applyTransition: (taskId: string, event: { type: 'retry' | 'reopen'; note?: string }) => TransitionOutcome
  enqueueTask: (taskId: string) => EnqueueTaskResult
}

export type ActionServiceResult<T> = { ok: true } & T | { ok: false; error: AppError }

export function createSupervisorActionService(deps: SupervisorActionServiceDeps) {
  function propose(input: {
    workspaceId: string
    threadId?: string | null
    taskId?: string | null
    kind: SupervisorActionKind
    strength: Strength
    mode: 'observe' | 'auto'
    reason: string
    payload: unknown
    policyVersion: string
    mandateVersion?: string | null
    dedupeKey: string
    expiresAt?: number
  }): ActionServiceResult<{ action: SupervisorAction; duplicate: boolean }> {
    const existing = findActionByDedupeKey(deps.db, input.dedupeKey)
    if (existing) return { ok: true, action: existing, duplicate: true }
    const now = deps.now()
    const action = SupervisorAction.parse({
      id: deps.newId(),
      workspaceId: input.workspaceId,
      threadId: input.threadId ?? null,
      taskId: input.taskId ?? null,
      kind: input.kind,
      status: 'proposed',
      strength: input.strength,
      mode: input.mode,
      reason: input.reason,
      payload: input.payload,
      result: null,
      policyVersion: input.policyVersion,
      mandateVersion: input.mandateVersion ?? null,
      dedupeKey: input.dedupeKey,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt ?? now + ACTION_TTL_MS,
      appliedAt: null,
      ignoredAt: null,
    })
    try {
      deps.db.transaction((tx) => {
        insertAction(tx, action)
        insertAudit(tx, {
          id: deps.newId(),
          ts: now,
          actor: input.strength === 'inferred' ? 'supervisor' : 'human',
          action: 'supervisor.action.propose',
          detail: {
            actionId: action.id,
            workspaceId: action.workspaceId,
            taskId: action.taskId,
            kind: action.kind,
            mode: action.mode,
          },
        })
      })
    } catch {
      const raced = findActionByDedupeKey(deps.db, input.dedupeKey)
      if (raced) return { ok: true, action: raced, duplicate: true }
      return { ok: false, error: appError('action_write_failed', 'cannot write action') }
    }
    return { ok: true, action, duplicate: false }
  }

  function decide(input: {
    workspaceId: string
    actionId: string
    actor: 'human' | 'supervisor' | 'system'
    decision: 'apply' | 'ignore'
  }): ActionServiceResult<{ action: SupervisorAction }> {
    const action = getActionRow(deps.db, input.actionId)
    if (!action || action.workspaceId !== input.workspaceId) {
      return { ok: false, error: appError('action_not_found', 'action not found', { actionId: input.actionId }) }
    }
    if (action.status !== 'proposed') {
      return { ok: false, error: appError('action_already_decided', 'action already decided', { status: action.status }) }
    }
    const now = deps.now()
    if (isActionExpired(action, now)) {
      updateStatus(action, 'expired', now)
      return { ok: false, error: appError('action_expired', 'action expired', { actionId: action.id }) }
    }
    if (input.decision === 'apply' && input.actor === 'supervisor') {
      return { ok: false, error: appError('supervisor_action_forbidden', 'supervisor cannot apply actions') }
    }
    if (input.decision === 'ignore') {
      const updated = updateStatus(action, 'ignored', now)
      return { ok: true, action: updated }
    }
    if (action.policyVersion !== deps.policyVersion(action.workspaceId)) {
      return { ok: false, error: appError('action_not_applicable', 'policy changed since proposal') }
    }
    const applied = applyAction(action, input.actor)
    if (!applied.ok) {
      updateStatus(action, 'failed', now)
      return { ok: false, error: applied.error }
    }
    return { ok: true, action: updateStatus(action, 'applied', now, applied.result) }
  }

  function applyAction(
    action: SupervisorAction,
    actor: 'human' | 'system',
  ): { ok: true; result: unknown } | { ok: false; error: AppError } {
    const payload = action.payload as { taskId?: string; note?: string }
    if (action.kind !== 'retry' && action.kind !== 'reopen') {
      return { ok: false, error: appError('action_not_applicable', 'action kind is not implemented in Plan A') }
    }
    if (!payload.taskId) {
      return { ok: false, error: appError('action_not_applicable', 'action has no taskId') }
    }
    const mandate = deps.requireMandate(
      payload.taskId,
      action.kind,
      actor === 'system' ? action.strength : 'explicit',
    )
    if (mandate) return { ok: false, error: mandate }
    const outcome = deps.applyTransition(payload.taskId, {
      type: action.kind,
      ...(payload.note ? { note: payload.note } : {}),
    })
    if (!outcome.ok) return { ok: false, error: outcome.error }
    return { ok: true, result: { taskId: outcome.taskId, status: outcome.status } }
  }

  function updateStatus(
    action: SupervisorAction,
    status: 'applied' | 'ignored' | 'failed' | 'expired',
    now: number,
    result?: unknown,
  ): SupervisorAction {
    if (!canTransitionAction(action.status, status)) {
      throw appError('action_already_decided', 'illegal action transition', { status: action.status })
    }
    deps.db.transaction((tx) => {
      tx.update(supervisorAction)
        .set({
          status,
          updatedAt: now,
          appliedAt: status === 'applied' ? now : action.appliedAt,
          ignoredAt: status === 'ignored' ? now : action.ignoredAt,
          ...(result === undefined ? {} : { resultJson: JSON.stringify(result) }),
        })
        .where(eq(supervisorAction.id, action.id))
        .run()
      insertAudit(tx, {
        id: deps.newId(),
        ts: now,
        actor: status === 'applied' ? 'human' : 'system',
        action: `supervisor.action.${status}`,
        detail: { actionId: action.id, workspaceId: action.workspaceId, kind: action.kind },
      })
    })
    return { ...action, status, updatedAt: now, result: result ?? action.result }
  }

  function expire(): number {
    const now = deps.now()
    const rows = listExpiredProposed(deps.db, now)
    for (const action of rows) updateStatus(action, 'expired', now)
    return rows.length
  }

  function cleanup(): number {
    const now = deps.now()
    return deleteActionsBefore(
      deps.db,
      now - PROPOSED_RETENTION_MS,
      now - TERMINAL_RETENTION_MS,
    )
  }

  return {
    propose,
    decide,
    expire,
    cleanup,
    get: (id: string) => getActionRow(deps.db, id),
    list: (workspaceId: string, status?: string, limit?: number) =>
      listActionRows(deps.db, { workspaceId, ...(status ? { status } : {}), limit }),
    listProposed: (workspaceId: string) => listActionRows(deps.db, { workspaceId, status: 'proposed' }),
  }
}
```

导入 `eq`、`supervisorAction` 到 service；如 `updateStatus` 的 `actor` 需要区分 ignore 是 human/supervisor，保留调用方传入的 actor，不要硬编码。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @evanfang0054/baton test -- supervisor-actions`
Expected: PASS；propose 后 `transitions` 为空，human apply 只调用一次。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/db/supervisor-action-repository.ts apps/daemon/src/supervisor/actions.ts apps/daemon/test/supervisor-actions.test.ts
git commit -m "feat(daemon): 增加管家动作账本"
```

---

### Task A5: runtime 接 observe、revalidate、reauthorize 与 decide

Blocking: Task A4
Slice type: tracer-bullet
Seam: `runtime.handleCommand` + `runtime.supervisor.observeTask`

**Files:**
- Create: `apps/daemon/src/supervisor/autonomy.ts`
- Modify: `packages/core/src/supervisor/origin.ts`
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Modify: `apps/daemon/src/supervisor/service.ts`
- Modify: `apps/daemon/src/db/repositories.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/src/http/supervisor.ts`
- Modify: `apps/daemon/src/app.ts`
- Test: `apps/daemon/test/supervisor-governance.test.ts`
- Test: `apps/daemon/test/task-origin.test.ts`

**Interfaces:**
- Consumes: A4 `createSupervisorActionService`；A3 `validateMandate`/`capabilityAutonomy`。
- Produces: `updateTaskOrigin`、`requireMandate`、`task.reauthorize` WS、`supervisor.action.decide` WS、`GET /api/supervisor/actions`。

- [ ] **Step 1: Write failing integration tests**

```ts
// apps/daemon/test/supervisor-governance.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { buildMandate } from '@baton/core'
import type { TaskOrigin } from '@baton/protocol'
import { createTestRuntime, type TestRuntimeHandle } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

function origin(exclude: 'retry' | null = null): TaskOrigin {
  const mandate = buildMandate({
    strength: 'explicit',
    allowedActions: ['retry', 'reopen', 'enqueue'].filter((action) => action !== exclude) as never,
    policyVersion: 'policy-1',
    promptVersion: 'prompt-1',
  })
  return {
    source: 'supervisor-chat',
    triggerId: 'trigger-1',
    threadId: 'thread-1',
    actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
    workspaceId: 'seed',
    targetNodeId: 'seed',
    contextNodeIds: [],
    policyVersion: 'policy-1',
    promptVersion: 'prompt-1',
    createdAt: 1,
    ...mandate,
  }
}

function setup(status: 'failed' | 'done' = 'failed') {
  const handle = createTestRuntime()
  handles.push(handle)
  const taskId = handle.createTask()
  handle.database.raw.prepare('update task set status = ? where id = ?').run(status, taskId)
  return { handle, taskId }
}

describe('M6-5 governance', () => {
  it('rejects retry after the mandate no longer allows it, then succeeds after reauthorize', () => {
    const { handle, taskId } = setup()
    handle.database.raw
      .prepare('update task set origin_json = ? where id = ?')
      .run(JSON.stringify({ ...origin('retry'), workspaceId: handle.seeded.workspaceId, targetNodeId: handle.seeded.nodeId }), taskId)

    const revoked = handle.runtime.handleCommand({
      v: 1,
      id: 'c1',
      ts: 1,
      type: 'task.retry',
      payload: { taskId },
    })
    expect(revoked).toMatchObject({ ok: false, error: { code: 'mandate_revoked' } })
    expect(handle.runtime.getTask(taskId)?.status).toBe('failed')

    const reauthorized = handle.runtime.handleCommand({
      v: 1,
      id: 'c2',
      ts: 1,
      type: 'task.reauthorize',
      payload: { taskId },
    })
    expect(reauthorized.ok).toBe(true)

    const retried = handle.runtime.handleCommand({
      v: 1,
      id: 'c3',
      ts: 1,
      type: 'task.retry',
      payload: { taskId },
    })
    expect(retried.ok).toBe(true)
    expect(handle.runtime.getTask(taskId)?.status).not.toBe('failed')
  })

  it('observe writes a proposed retry without changing task state', () => {
    const { handle, taskId } = setup()
    handle.database.raw
      .prepare('update task set origin_json = ? where id = ?')
      .run(JSON.stringify({ ...origin(), workspaceId: handle.seeded.workspaceId }), taskId)
    mkdirSync(join(handle.root, handle.seeded.relPath, '.baton'), { recursive: true })
    writeFileSync(
      join(handle.root, handle.seeded.relPath, '.baton', 'policy.json'),
      JSON.stringify({
        autonomy: { mode: 'observe', autoRetry: 'observe', attentionReminder: 'observe' },
      }),
    )
    handle.runtime.supervisor.observeTask({ taskId, status: 'failed', waitingReason: null })
    expect(handle.runtime.getTask(taskId)?.status).toBe('failed')
    expect(handle.runtime.actions.listProposed(handle.seeded.workspaceId)).toHaveLength(1)
  })
})
```

Test 文件顶部补：

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
```

Task origin 单测在 `apps/daemon/test/task-origin.test.ts` 追加：

```ts
it('builds a mandate snapshot for new tasks', () => {
  const origin = buildTaskOrigin({
    source: 'supervisor-chat',
    triggerId: 't1',
    threadId: 'th1',
    workspaceId: 'w1',
    targetNodeId: 'a1',
    contextNodeIds: [],
    policyVersion: 'p1',
    promptVersion: 'v1',
    createdAt: 1,
  })
  expect(origin.scope).toBe('task')
  expect(origin.allowedActions).toContain('retry')
  expect(origin.mandateVersion).toMatch(/^[0-9a-f]{12}$/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- supervisor-governance task-origin
```

Expected: FAIL because `task.reauthorize` is unknown and origin has no mandate.

- [ ] **Step 3: Implement runtime wiring**

`packages/core/src/supervisor/origin.ts`：

```ts
import type { Actor, Strength, TaskAction, TaskOrigin } from '@baton/protocol'
import { buildMandate, DEFAULT_TASK_ACTIONS } from './mandate.js'

export interface BuildTaskOriginInput {
  // ...existing fields...
  strength?: Strength
  allowedActions?: TaskAction[]
}

export function buildTaskOrigin(input: BuildTaskOriginInput): TaskOrigin {
  const { actorKind = 'human', reviewOfTaskId, reviewOfReviewId, strength = 'explicit', allowedActions = DEFAULT_TASK_ACTIONS, ...origin } = input
  const mandate = buildMandate({
    strength,
    allowedActions,
    policyVersion: input.policyVersion,
    promptVersion: input.promptVersion,
  })
  return {
    ...origin,
    ...mandate,
    actor: { id: 'local-user', kind: actorKind, source: input.source },
    ...(reviewOfTaskId ? { reviewOfTaskId } : {}),
    ...(reviewOfReviewId ? { reviewOfReviewId } : {}),
  }
}
```

`apps/daemon/src/db/repositories.ts` 增加：

```ts
export function updateTaskOrigin(tx: Tx, id: string, originJson: string, updatedAt: number): void {
  tx.update(task).set({ originJson, updatedAt }).where(eq(task.id, id)).run()
}
```

`apps/daemon/src/supervisor/autonomy.ts`：

```ts
import type { AutonomyMode } from '@baton/protocol'
import { capabilityAutonomy } from '@baton/core'
import { getWorkspace } from '../db/repositories.js'
import type { Db } from '../db/types.js'
import type { Config } from '../config.js'
import { hashPolicy } from '../automation/version.js'
import { loadPolicy } from '../workspace/policy.js'
import { resolveWorkspaceDir } from '../workspace/resolver.js'

export function loadWorkspacePolicy(db: Db, config: Config, workspaceId: string) {
  const workspace = getWorkspace(db, workspaceId)
  if (!workspace) return null
  const policy = loadPolicy(resolveWorkspaceDir(config.workspacesRoot, workspace.relPath))
  return {
    policy,
    policyVersion: hashPolicy(policy),
    trusted: workspace.trusted,
    autoRetry: (killSwitch: boolean): AutonomyMode => capabilityAutonomy(policy, 'autoRetry', { killSwitch }),
    attentionReminder: (killSwitch: boolean): AutonomyMode =>
      capabilityAutonomy(policy, 'attentionReminder', { killSwitch }),
  }
}
```

`apps/daemon/src/supervisor/tools.ts`：

- `SupervisorToolsDeps` 增加 `requireMandate?: (taskId: string, action: TaskAction, strength: Strength) => AppError | null`。
- 在 `enqueue_task`、`retry_task`、`reopen_task` 执行 transition 前调用：

```ts
const mandate = deps.requireMandate?.(detail.task.id, 'enqueue', 'explicit')
if (mandate) throw mandate
```

`apps/daemon/src/supervisor/service.ts`：

- deps 增加 `actions?: ReturnType<typeof createSupervisorActionService>`、`loadPolicy?: (workspaceId: string) => ReturnType<typeof loadWorkspacePolicy>`、`killSwitch` 已有。
- `observeTask` 的 failed 分支，在现有 notify 后加：

```ts
const info = deps.loadPolicy?.(task.workspaceId)
if (!info) return
const mode = info.autoRetry(deps.killSwitch())
if (mode === 'off') return
const proposed = deps.actions?.propose({
  workspaceId: task.workspaceId,
  threadId: origin.threadId,
  taskId: task.id,
  kind: 'retry',
  strength: 'inferred',
  mode: mode === 'auto' ? 'auto' : 'observe',
  reason: `任务「${task.title}」执行失败，建议重试。`,
  payload: { taskId: task.id },
  policyVersion: info.policyVersion,
  mandateVersion: origin.mandateVersion ?? null,
  dedupeKey: `retry:${task.id}:${task.retryCount}:${Math.floor(deps.now() / 86_400_000)}`,
})
if (mode === 'auto' && proposed?.ok) {
  deps.actions?.decide({
    workspaceId: task.workspaceId,
    actionId: proposed.action.id,
    actor: 'system',
    decision: 'apply',
  })
}
```

`apps/daemon/src/runtime/index.ts`：

1. 创建 `actions`（在 digest 之后、supervisor 之前）：

```ts
const actions = createSupervisorActionService({
  db: deps.db,
  now,
  newId,
  policyVersion: (workspaceId) => {
    const info = loadWorkspacePolicy(deps.db, deps.config, workspaceId)
    return info?.policyVersion ?? ''
  },
  requireMandate: (taskId, action, strength) => requireMandate(taskId, action, strength),
  applyTransition: (taskId, event) =>
    transitionRunnerHolder.value
      ? transitionRunnerHolder.value.applyTransition(taskId, event)
      : { ok: false, error: appError('runtime_not_ready', 'transition runner is not ready') },
  enqueueTask: (taskId) => {
    const outcome = enqueue(taskId)
    return outcome.ok ? { ok: true, status: outcome.status } : { ok: false, error: outcome.error }
  },
})
```

2. 增加 `requireMandate`：

```ts
function requireMandate(taskId: string, action: TaskAction, strength: Strength): AppError | null {
  const detail = getTaskDetail(deps.db, taskId)
  if (!detail) return appError('task_not_found', 'task not found', { taskId })
  const origin = detail.task.origin
  if (!origin && strength === 'inferred') {
    return appError('mandate_revoked', 'task has no mandate', { reason: 'missing_mandate' })
  }
  if (!origin) return null
  const info = loadWorkspacePolicy(deps.db, deps.config, detail.task.workspaceId)
  if (!info) return appError('workspace_not_found', 'workspace not found')
  const result = validateMandate({
    origin,
    requestedAction: action,
    requestedStrength: strength,
    currentPolicyVersion: info.policyVersion,
    gate: {
      workspaceTrusted: info.trusted,
      killSwitch: automationState.isKillSwitchOn(),
      autonomy: info.policy.autonomy.mode,
      capability:
        action === 'retry' || action === 'reopen' || action === 'enqueue' || action === 'apply_plan'
          ? info.policy.autonomy.autoRetry
          : info.policy.autonomy.attentionReminder,
    },
  })
  return result.ok ? null : appError('mandate_revoked', 'task mandate revoked', result.detail)
}
```

3. `createSupervisorService` 传入 `actions` 与 `loadPolicy`：

```ts
actions,
loadPolicy: (workspaceId) => loadWorkspacePolicy(deps.db, deps.config, workspaceId),
```

4. `handleCommand` 的 `task.enqueue`/`task.retry`/`task.reopen` 前调用 `requireMandate`；新增：

```ts
case 'task.reauthorize': {
  const detail = getTaskDetail(deps.db, message.payload.taskId)
  if (!detail) return { ok: false, error: appError('task_not_found', 'task not found') }
  const task = detail.task
  if (!task.nodeId) return { ok: false, error: appError('task_not_applicable', 'task has no node') }
  const info = loadWorkspacePolicy(deps.db, deps.config, task.workspaceId)
  if (!info) return { ok: false, error: appError('workspace_not_found', 'workspace not found') }
  const mandate = buildMandate({
    strength: 'explicit',
    allowedActions: DEFAULT_TASK_ACTIONS,
    policyVersion: info.policyVersion,
    promptVersion: PROMPT_VERSION,
  })
  const nextOrigin = TaskOrigin.parse({
    ...(task.origin ?? buildTaskOrigin({
      source: 'canvas',
      triggerId: `reauthorize:${task.id}`,
      threadId: `reauthorize:${task.id}`,
      workspaceId: task.workspaceId,
      targetNodeId: task.nodeId,
      contextNodeIds: task.context?.included.map((item) => item.id) ?? [],
      policyVersion: info.policyVersion,
      promptVersion: PROMPT_VERSION,
      createdAt: now(),
    })),
    ...mandate,
  })
  deps.db.transaction((tx) => {
    updateTaskOrigin(tx, task.id, JSON.stringify(nextOrigin), now())
    insertAudit(tx, {
      id: newId(),
      ts: now(),
      actor: 'human',
      action: 'supervisor.mandate.reauthorize',
      detail: { taskId: task.id, workspaceId: task.workspaceId, mandateVersion: mandate.mandateVersion },
    })
  })
  return { ok: true, ack: { taskId: task.id, mandateVersion: mandate.mandateVersion } }
}
case 'supervisor.action.decide': {
  const result = actions.decide({
    workspaceId: message.payload.workspaceId,
    actionId: message.payload.actionId,
    actor: 'human',
    decision: message.payload.decision,
  })
  return result.ok
    ? { ok: true, ack: { actionId: result.action.id, status: result.action.status, result: result.action.result } }
    : { ok: false, error: result.error }
}
```

5. runtime 返回 `actions`；`app.ts` 把 `runtime.actions` 传给 `registerSupervisorRoutes`；`http/supervisor.ts` 增加：

```ts
app.get('/api/supervisor/actions', async (req) => {
  const parsed = SupervisorActionListQuery.safeParse(req.query)
  if (!parsed.success) throw appError('invalid_payload', 'invalid action query', parsed.error.issues)
  return SupervisorActionListResponse.parse({
    actions: deps.actions.list(parsed.data.workspaceId, parsed.data.status, parsed.data.limit),
  })
})
app.get('/api/supervisor/actions/:id', async (req) => {
  const { id } = req.params as { id?: string }
  if (!id) throw appError('invalid_payload', 'action id is required')
  const action = deps.actions.get(id)
  if (!action) throw appError('action_not_found', 'action not found', { actionId: id })
  return { action }
})
```

Action service 需要暴露 `list(workspaceId, status?, limit?)`，直接调用 `listActionRows`。

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- supervisor-governance task-origin supervisor-actions
pnpm --filter @baton/core test
```

Expected: PASS。revalidate 失败时任务状态保持 `failed`；reauthorize 后 retry 成功。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/supervisor/origin.ts apps/daemon/src/supervisor apps/daemon/src/runtime/index.ts apps/daemon/src/db/repositories.ts apps/daemon/src/http/supervisor.ts apps/daemon/src/app.ts apps/daemon/test
git commit -m "feat(daemon): 接线管家 observe 与授权重校验"
```

---

### Task A6: Web 自动化自治设置与重新授权

Blocking: Task A5
Slice type: tracer-bullet
Seam: component tests

**Files:**
- Modify: `apps/web/src/features/automation/AutomationSettingsDialog.tsx`
- Modify: `apps/web/src/features/automation/AutomationSettingsDialog.test.tsx`
- Modify: `apps/web/src/features/tasks/TaskOriginCard.tsx`
- Modify: `apps/web/src/features/tasks/TaskActions.tsx`
- Modify: `apps/web/src/features/tasks/TaskActions.test.tsx`
- Modify: `apps/web/src/features/tasks/useCommandAction.ts`
- Test: `apps/web/src/features/tasks/TaskOriginCard.test.tsx`（新建）

**Interfaces:**
- Consumes: A5 WS `task.reauthorize`；A1 `Policy.autonomy`。
- Produces: 设置区三个控件；task detail 的授权摘要与重新授权按钮。

- [ ] **Step 1: Write failing tests**

```tsx
// apps/web/src/features/automation/AutomationSettingsDialog.test.tsx（追加）
it('saves the global autonomy mode and two capability switches', async () => {
  vi.mocked(getAutomation).mockResolvedValue(summary())
  vi.mocked(listAudit).mockResolvedValue([])
  vi.mocked(updateAutomationPolicy).mockResolvedValue(summary())
  wrap()

  await userEvent.selectOptions(await screen.findByLabelText('总管全局模式'), 'auto')
  await userEvent.selectOptions(screen.getByLabelText('失败自动重试'), 'observe')
  await userEvent.selectOptions(screen.getByLabelText('注意力提醒'), 'auto')
  await userEvent.click(screen.getByRole('button', { name: '保存' }))

  await waitFor(() =>
    expect(updateAutomationPolicy).toHaveBeenCalledWith('w1', {
      autonomy: { mode: 'auto', autoRetry: 'observe', attentionReminder: 'auto' },
    }),
  )
})
```

`summary()` fixture 的 policy 增加：

```ts
autonomy: { mode: 'observe', autoRetry: 'off', attentionReminder: 'observe' },
```

```tsx
// apps/web/src/features/tasks/TaskActions.test.tsx（追加）
it('offers reauthorize after mandate_revoked and then lets the user retry again', async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(new Error('授权已失效'), { code: 'mandate_revoked' }))
    .mockResolvedValue(undefined)
  renderActions('failed', send)
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  fireEvent.click(await screen.findByRole('button', { name: '确认重试' }))
  const reauthorize = await screen.findByRole('button', { name: '重新授权并继续' })
  fireEvent.click(reauthorize)
  await waitFor(() =>
    expect(send).toHaveBeenLastCalledWith({ type: 'task.reauthorize', payload: { taskId: 't1' } }),
  )
})
```

```tsx
// apps/web/src/features/tasks/TaskOriginCard.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TaskOriginCard } from './TaskOriginCard'

describe('TaskOriginCard', () => {
  it('shows mandate strength, allowed actions and version', () => {
    render(
      <TaskOriginCard
        invalid={false}
        origin={{
          source: 'supervisor-chat',
          triggerId: 't1',
          threadId: 'th1',
          actor: { id: 'local-user', kind: 'human', source: 'supervisor-chat' },
          workspaceId: 'w1',
          targetNodeId: 'a1',
          contextNodeIds: [],
          policyVersion: 'p1',
          promptVersion: 'v1',
          createdAt: 1,
          scope: 'task',
          strength: 'explicit',
          allowedActions: ['retry', 'enqueue'],
          mandateVersion: 'm12345678901',
        }}
      />,
    )
    expect(screen.getByText('明确授权')).toBeVisible()
    expect(screen.getByText('retry、enqueue')).toBeVisible()
    expect(screen.getByText('m12345678901')).toBeVisible()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @baton/web test -- AutomationSettingsDialog TaskActions TaskOriginCard
```

Expected: FAIL because controls/fields do not exist.

- [ ] **Step 3: Implement web changes**

`AutomationSettingsDialog.tsx`：

- 增加 state：

```tsx
const [autonomyMode, setAutonomyMode] = useState<'off' | 'observe' | 'auto'>('observe')
const [autoRetry, setAutoRetry] = useState<'off' | 'observe' | 'auto'>('off')
const [attentionReminder, setAttentionReminder] = useState<'off' | 'observe' | 'auto'>('observe')
```

- `useEffect` 同步 `summary.data.policy.autonomy`。
- patch diff：

```tsx
const autonomy: {
  mode?: 'off' | 'observe' | 'auto'
  autoRetry?: 'off' | 'observe' | 'auto'
  attentionReminder?: 'off' | 'observe' | 'auto'
} = {}
if (autonomyMode !== current.policy.autonomy.mode) autonomy.mode = autonomyMode
if (autoRetry !== current.policy.autonomy.autoRetry) autonomy.autoRetry = autoRetry
if (attentionReminder !== current.policy.autonomy.attentionReminder) {
  autonomy.attentionReminder = attentionReminder
}
if (Object.keys(autonomy).length > 0) patch.autonomy = autonomy
```

- 渲染在“总管全权”说明之后：

```tsx
<section className="flex flex-col gap-2 rounded-md border border-separator p-2">
  <h3 className="text-sm font-medium text-foreground">总管自治</h3>
  <label className="flex items-center justify-between gap-2 text-sm">
    <span>全局模式</span>
    <select
      aria-label="总管全局模式"
      value={autonomyMode}
      onChange={(event) => setAutonomyMode(event.target.value as typeof autonomyMode)}
      className="h-9 rounded-lg border border-separator bg-surface px-2 text-sm"
    >
      <option value="off">off</option>
      <option value="observe">observe</option>
      <option value="auto">auto</option>
    </select>
  </label>
  <label className="flex items-center justify-between gap-2 text-sm">
    <span>失败自动重试</span>
    <select
      aria-label="失败自动重试"
      value={autoRetry}
      onChange={(event) => setAutoRetry(event.target.value as typeof autoRetry)}
      className="h-9 rounded-lg border border-separator bg-surface px-2 text-sm"
    >
      <option value="off">off</option>
      <option value="observe">observe</option>
      <option value="auto">auto</option>
    </select>
  </label>
  <label className="flex items-center justify-between gap-2 text-sm">
    <span>注意力提醒</span>
    <select
      aria-label="注意力提醒"
      value={attentionReminder}
      onChange={(event) => setAttentionReminder(event.target.value as typeof attentionReminder)}
      className="h-9 rounded-lg border border-separator bg-surface px-2 text-sm"
    >
      <option value="off">off</option>
      <option value="observe">observe</option>
      <option value="auto">auto</option>
    </select>
  </label>
  <p className="text-xs text-muted">
    修改只影响新提议；已提议的动作仍可应用或忽略。kill switch 下 auto 停止，observe 仍记录。
  </p>
</section>
```

`TaskOriginCard.tsx` 在策略版本后追加：

```tsx
{origin.strength ? (
  <>
    <dt className="text-muted">授权强度</dt>
    <dd className="text-foreground">{origin.strength === 'explicit' ? '明确授权' : '推断授权'}</dd>
  </>
) : null}
{origin.allowedActions?.length ? (
  <>
    <dt className="text-muted">允许动作</dt>
    <dd className="text-foreground">{origin.allowedActions.join('、')}</dd>
  </>
) : null}
{origin.mandateVersion ? (
  <>
    <dt className="text-muted">授权版本</dt>
    <dd className="break-all font-mono text-muted" title={origin.mandateVersion}>
      {origin.mandateVersion}
    </dd>
  </>
) : null}
```

`useCommandAction.ts`：

```ts
const [errorCode, setErrorCode] = useState<string | null>(null)
// run 内 catch：
const code = (cause as { code?: unknown } | null)?.code
setErrorCode(typeof code === 'string' ? code : null)
// 每次 run 开始 setErrorCode(null)
return { run, pending, error, errorCode, clearError: () => { setError(null); setErrorCode(null) } }
```

`TaskActions.tsx`：

```tsx
const reauthorize = async () => {
  await action.run({ type: 'task.reauthorize', payload: { taskId } })
}
// 在两个 error 展示块中，errorCode === 'mandate_revoked' 时追加：
{action.errorCode === 'mandate_revoked' ? (
  <Button variant="secondary" size="sm" className="mt-2" onPress={() => void reauthorize()}>
    重新授权并继续
  </Button>
) : null}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @baton/web test -- AutomationSettingsDialog TaskActions TaskOriginCard
pnpm --filter @baton/web typecheck
```

Expected: PASS；旧 `AutomationSummary` fixture 全部补 `autonomy`，类型检查通过。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/automation apps/web/src/features/tasks
git commit -m "feat(web): 增加管家自治设置与重新授权入口"
```

---

### Task A7: 全量验证与负空间检查

Blocking: Task A1-A6
Slice type: verification
Seam: `pnpm verify` + grep

**Files:**
- No production files；只允许修复本计划引入的失败。
- Test: 全量

- [ ] **Step 1: Run full verify**

```bash
pnpm verify
```

Expected: typecheck / lint / format / boundaries / protocol / tests / build 全绿。若失败，按错误码修复，不跳过。

- [ ] **Step 2: Check negative space**

```bash
grep -RIn "sourceTable\|github_source\|feishu_source\|dag_edge\|auto_accept\|auto_merge" packages/protocol/src packages/core/src apps/daemon/src apps/web/src || true
grep -RIn "TODO\|FIXME" packages/protocol/src packages/core/src apps/daemon/src apps/web/src || true
```

Expected: 第一条无新增外部 Source/DAG/自动验收/自动合并；第二条输出为空（本计划新增代码范围内）。

- [ ] **Step 3: Confirm human-only boundaries**

```bash
grep -RIn "supervisor_action_forbidden" apps/daemon/src | cat
grep -RIn "task.reauthorize" apps/daemon/src/supervisor/tools.ts && exit 1 || true
```

Expected: `decide(actor='supervisor', decision='apply')` 返回 `supervisor_action_forbidden`；总管 toolset 中没有 `reauthorize`。

- [ ] **Step 4: Update plan status and commit**

把本文件 frontmatter 的 `status: planned` 改为 `status: completed`，并记录实际 commit。

```bash
git add docs/plans/2026-11-22-m6-5-governance.md
git commit -m "docs(m6-5): 完成治理底座计划"
```

---

## Plan A 完成标准

- `pnpm verify` 全绿。
- 空库与 0012 fixture DB 都能升级到 0013；旧 `origin_json` 不被改写。
- observe 只写 `proposed`，不调用 `applyTransition`；human apply 才执行。
- `validateMandate` 覆盖 policy 变更、untrusted、kill switch、allowedActions、旧 origin。
- `task.reauthorize` 只存在于 WS 命令，总管 toolset 没有该工具。
- web 设置能保存 `autonomy`；`mandate_revoked` 后出现“重新授权并继续”。

## 实施记录（2026-11-22）

- A1：`078ccc2 feat(protocol): 增加 M6-5 自治与授权协议`
- A2：`d490994 feat(daemon): 增加 M6-5 账本迁移 0013`
- A3：`8833088 feat(core): 增加管家自治与 Mandate 纯函数`
- A4：`204615f feat(daemon): 增加管家动作账本`
- A5：`cbce368 feat(daemon): 接线管家 observe 与授权重校验`
- A6：`8a1a250 feat(web): 增加管家自治设置与重新授权入口`
- A7：`pnpm verify` 全绿；负空间与 human-only grep 通过。

