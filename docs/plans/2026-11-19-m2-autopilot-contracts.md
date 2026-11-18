---
spec_ref: ../specs/2026-11-19-m2-autopilot-design.md
spec_topic: m2-autopilot-v0
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: "protocol automation/NoticeEvent/API schema、effective autopilot、digest 纯函数、migration 0007 与 setting/notice 仓储完成；pnpm verify 全绿"
depends_on: []
status: active
---

# M2-2a 无人值守与汇报：契约层实施计划（Plan 1/4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 逐任务执行。步骤用 `- [ ]` 勾选。

**Goal:** 先把协议、core 安全规则、digest 纯函数、migration 0007 与 setting/notice 仓储落定，让 daemon/web 后续只消费稳定类型。

**Architecture:** `packages/protocol` 定义 automation/notice 的公开 schema；`packages/core` 用纯函数承载 effective autopilot 与 digest；`apps/daemon` 只加 migration 与最小仓储，不实现调度或 HTTP。

**Tech Stack:** TypeScript ESM、zod 4、Drizzle ORM、better-sqlite3、vitest。

---

## 计划地图

| Plan | 范围 | 状态 |
|---|---|---|
| **1. 契约层（本计划）** | protocol / core / migration / setting/notice 仓储 | 实施中 |
| 2. daemon | policy 写入 / kill switch / digest / notice & audit REST / runtime | 依赖 1 |
| 3. web | 设置弹窗 / 顶栏状态 / digest 卡 / 任务自动化卡 / 批量开工 | 依赖 2 |
| 4. 验收 | Playwright / ego-lite / 证据 / 全量验证 | 依赖 3 |

**GDD:** 按仓库先例显式跳过；测试设计由 contract 14 条 DoD 与任务内测试承担。

**Commit strategy:** 每个 Task 结束提交一次；Task 5 跑 `pnpm verify`。

---

## Task 1: Protocol automation 词汇、NoticeEvent 与 API schema

Blocking: none
Slice type: tracer-bullet
Seam: `packages/protocol/src/index.ts` 导出 `AutomationPolicyPatch` 与 `NoticeEvent`

**Files：**

- Create: `packages/protocol/src/automation.ts`
- Create: `packages/protocol/test/automation.test.ts`
- Modify: `packages/protocol/src/entities/notice.ts`
- Modify: `packages/protocol/src/events.ts`
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/test/exports.test.ts`

**Interfaces：**

- Produces: `AutomationPolicyPatch`、`AutomationSummary`、`DigestTaskRef`、`DigestReport`、`TaskAutomationDecision`、`TaskAutomationSummary`；`Notice.workspaceId`；`NoticeEvent`；`KillSwitchInput/Response`、`NoticeListQuery/Response`、`DigestGenerateResponse`、`AuditListQuery/Response`。
- Consumes: `PolicySchema`（`./policy.js`）、`Id/Timestamp`（`./common.js`）、`TaskStatus/Attention/ApprovalDecision/RiskLevel`（`./enums.js`）、`Audit`（`./entities/index.js`）。

- [ ] **Step 1: 写失败测试**

`packages/protocol/test/automation.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  AutomationPolicyPatch,
  DigestReport,
  Notice,
  NoticeEvent,
  ServerMessage,
} from '../src/index.js'

describe('automation protocol', () => {
  it('parses notice with nullable workspaceId', () => {
    const notice = Notice.parse({ id: 'n1', ts: 1, kind: 'digest', payload: {}, readAt: null })
    expect(notice.workspaceId).toBeNull()
  })

  it('accepts only the three editable policy fields', () => {
    expect(
      AutomationPolicyPatch.safeParse({
        autopilot: { enabled: true, retryMax: 3 },
        approval: { autoApproveMaxRisk: 'low' },
      }).success,
    ).toBe(true)
    expect(
      AutomationPolicyPatch.safeParse({ autopilot: { enabled: true, extra: 1 } }).success,
    ).toBe(false)
    expect(
      AutomationPolicyPatch.safeParse({ approval: { autoApproveMaxRisk: 'high' } }).success,
    ).toBe(false)
  })

  it('parses notice event through ServerMessage', () => {
    const event = ServerMessage.parse({
      v: 1,
      ts: 1,
      seq: 1,
      type: 'notice',
      payload: {
        id: 'n1',
        workspaceId: 'w1',
        ts: 1,
        kind: 'digest',
        payload: { ready: 1 },
        readAt: null,
      },
    })
    expect(event.type).toBe('notice')
    expect(NoticeEvent.safeParse(event).success).toBe(true)
  })

  it('requires digest snapshot fields', () => {
    const parsed = DigestReport.safeParse({
      workspaceId: 'w1',
      windowStart: 0,
      windowEnd: 1,
      generatedAt: 1,
      policyVersion: 'abc123abc123',
      snapshot: {
        total: 0,
        unplanned: 0,
        todo: 0,
        running: 0,
        waiting: 0,
        review: 0,
        done: 0,
        closed: 0,
        attention: { needsApproval: 0, needsReply: 0, needsAttention: 0, needsReview: 0 },
      },
      ready: [],
      blocked: [],
      dropped: [],
      changes: {
        created: 0,
        updated: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        retried: 0,
        autoAllowed: 0,
        autoDenied: 0,
      },
      oldestWaiting: null,
    })
    expect(parsed.success).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/protocol exec vitest run test/automation.test.ts`
Expected: FAIL，提示 `AutomationPolicyPatch`/`NoticeEvent` 未导出或 `workspaceId` 缺失。

- [ ] **Step 3: 最小实现**

`packages/protocol/src/entities/notice.ts` 增加字段：

```ts
export const Notice = z.object({
  id: Id,
  workspaceId: Id.nullable().default(null),
  ts: Timestamp,
  kind: z.string().min(1),
  payload: z.unknown(),
  readAt: Timestamp.nullable(),
})
```

`packages/protocol/src/automation.ts` 按 spec §5.2 落全部 schema，关键片段：

```ts
export const AutomationPolicyPatch = z
  .object({
    autopilot: z
      .object({
        enabled: z.boolean().optional(),
        retryMax: z.number().int().min(0).max(10).optional(),
      })
      .strict()
      .optional(),
    approval: z
      .object({ autoApproveMaxRisk: z.enum(['low', 'medium']).optional() })
      .strict()
      .optional(),
  })
  .strict()

export const AutomationSummary = z.object({
  workspaceId: Id,
  trusted: z.boolean(),
  policy: PolicySchema,
  policyVersion: z.string().min(1),
  killSwitch: z.boolean(),
  killSwitchForced: z.boolean(),
  digestCronUnsupported: z.boolean().default(false),
})
```

`DigestTaskRef`、`DigestReport`、`TaskAutomationDecision`、`TaskAutomationSummary` 按 spec §5.2 原样落；`DigestReport` 的 `snapshot` 使用显式字段，不 import core 的 `BoardColumnId`。

`packages/protocol/src/events.ts` 增加：

```ts
export const NoticeEvent = ReplayableBase.extend({
  type: z.literal('notice'),
  payload: Notice,
})
```

并加入文件末尾的 `ServerMessage` 联合；`packages/protocol/src/api.ts` 增加 spec §5.4 的 query/response schema；`packages/protocol/src/index.ts` 增加 `export * from './automation.js'`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/protocol exec vitest run test/automation.test.ts test/exports.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src packages/protocol/test
git commit -m "feat(protocol): 定义自动化与 notice 契约"
```

---

## Task 2: core effective autopilot 与上下文安全规则

Blocking: Task 1
Slice type: tracer-bullet
Seam: `packages/core/src/automation/effective.ts` 的 `effectiveAutopilot` 与 `evaluateApproval` 的 `workspaceTrusted`

**Files：**

- Create: `packages/core/src/automation/effective.ts`
- Create: `packages/core/test/automation-effective.test.ts`
- Modify: `packages/core/src/policy/types.ts`
- Modify: `packages/core/src/policy/evaluate.ts`
- Modify: `packages/core/src/state-machine/types.ts`
- Modify: `packages/core/src/state-machine/transition.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces：**

- Produces: `effectiveAutopilot(policy, { workspaceTrusted, killSwitch }): Policy['autopilot']`；`PolicyContext` 增加 `workspaceTrusted`；`TransitionContext` 增加 `workspaceTrusted`、`killSwitch`。
- Consumes: `Policy`、`ApprovalRequest`、`PolicyDecision`、`TransitionContext`。

- [ ] **Step 1: 写失败测试**

`packages/core/test/automation-effective.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { PolicySchema } from '@baton/protocol'
import { effectiveAutopilot, evaluateApproval, transition, type TransitionContext } from '../src/index.js'

const policy = PolicySchema.parse({
  approval: { allow: ['Bash:pnpm test'], autoApproveMaxRisk: 'low' },
  autopilot: { enabled: true, retryMax: 2 },
})
const request = {
  toolName: 'Bash',
  input: { command: 'pnpm test' },
  risk: 'low' as const,
}

describe('effective autopilot', () => {
  it.each([
    { trusted: true, killSwitch: false, enabled: true },
    { trusted: false, killSwitch: false, enabled: false },
    { trusted: true, killSwitch: true, enabled: false },
  ])('enabled=$enabled when trusted=$trusted killSwitch=$killSwitch', (c) => {
    expect(
      effectiveAutopilot(policy, {
        workspaceTrusted: c.trusted,
        killSwitch: c.killSwitch,
      }).enabled,
    ).toBe(c.enabled)
  })

  it('does not auto-approve in an untrusted workspace', () => {
    const decision = evaluateApproval(policy, request, {
      killSwitch: false,
      workspaceTrusted: false,
    })
    expect(decision.decision).toBe('ask')
    expect(decision.autoApproved).toBe(false)
  })

  it('never auto-approves high risk', () => {
    const decision = evaluateApproval(
      policy,
      { ...request, risk: 'high' },
      { killSwitch: false, workspaceTrusted: true },
    )
    expect(decision.decision).toBe('ask')
    expect(decision.autoApproved).toBe(false)
  })

  it('retries verify_fail only when trusted and kill switch is off', () => {
    const ctx: TransitionContext = {
      status: 'verifying',
      retryCount: 0,
      runningCount: 0,
      maxConcurrency: 1,
      autopilot: { enabled: true, retryMax: 2 },
      workspaceTrusted: true,
      killSwitch: false,
      waitingReason: null,
    }
    const event = {
      type: 'verify_fail' as const,
      reviewId: 'r1',
      exitCode: 1,
      output: 'fail',
      diffStat: { files: 1, additions: 1, deletions: 0 },
    }
    expect(transition(ctx, event)).toMatchObject({ ok: true, status: 'queued' })
    expect(transition({ ...ctx, workspaceTrusted: false }, event)).toMatchObject({ status: 'review' })
    expect(transition({ ...ctx, killSwitch: true }, event)).toMatchObject({ status: 'review' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/core exec vitest run test/automation-effective.test.ts`
Expected: FAIL，提示 `effectiveAutopilot` 未导出或 `workspaceTrusted` 缺失。

- [ ] **Step 3: 实现**

`packages/core/src/automation/effective.ts`：

```ts
import type { Policy } from '@baton/protocol'

export interface AutomationGate {
  workspaceTrusted: boolean
  killSwitch: boolean
}

export function canAutopilot(gate: AutomationGate): boolean {
  return gate.workspaceTrusted === true && gate.killSwitch === false
}

export function effectiveAutopilot(policy: Policy, gate: AutomationGate): Policy['autopilot'] {
  return {
    ...policy.autopilot,
    enabled: policy.autopilot.enabled && canAutopilot(gate),
  }
}
```

`policy/types.ts` 的 `PolicyContext` 增加 `workspaceTrusted?: boolean`；`policy/evaluate.ts` 的 `auto` 条件用 `canAutopilot({ workspaceTrusted: ctx.workspaceTrusted === true, killSwitch: ctx.killSwitch })`。

`state-machine/types.ts` 的 `TransitionContext` 增加：

```ts
readonly workspaceTrusted?: boolean
readonly killSwitch?: boolean
```

Plan 1 先以“缺省即 fail-closed”保持全量 verify 绿：`workspaceTrusted` 缺省按 false，`killSwitch` 缺省按 true；Plan 2 再传真实值。

`state-machine/transition.ts` 的 `verify_fail` 分支改为：

```ts
if (
  ctx.autopilot.enabled &&
  canAutopilot({
    workspaceTrusted: ctx.workspaceTrusted === true,
    killSwitch: ctx.killSwitch ?? true,
  }) &&
  ctx.retryCount < ctx.autopilot.retryMax
) {
  // 原 queued 分支不变
}
```

`state-machine/index.ts` 与 `packages/core/src/index.ts` 补导出。

- [ ] **Step 4: 运行 core 全量测试**

Run: `pnpm --filter @baton/core test`
Expected: PASS；如快照因新增上下文字段变化，按实际输出更新并人工复核。

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): 统一自动批准与重试的安全门槛"
```

---

## Task 3: core digest 纯函数

Blocking: Task 1
Slice type: tracer-bullet
Seam: `buildDigest(input)` 输出 `DigestReport`

**Files：**

- Create: `packages/core/src/automation/digest.ts`
- Create: `packages/core/test/automation-digest.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces：**

- Produces: `DigestInput`、`buildDigest(input: DigestInput): DigestReport`。
- Consumes: `Task`、`DigestReport`、`DigestTaskRef`、`boardColumn`、`waitingSinceFor`。

- [ ] **Step 1: 写失败测试**

`packages/core/test/automation-digest.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildDigest } from '../src/index.js'
import type { Task } from '@baton/protocol'

const base = {
  id: 't1',
  workspaceId: 'w1',
  nodeId: 'n1',
  title: '修复登录',
  prompt: 'SECRET_PROMPT',
  status: 'review',
  waitingReason: null,
  engine: 'fake',
  workspaceMode: 'main',
  branch: null,
  worktreePath: null,
  verifyCommand: null,
  retryCount: 1,
  dangerouslySkipPermissions: false,
  contextJson: null,
  originJson: null,
  createdAt: 10,
  updatedAt: 90,
} satisfies Task

describe('buildDigest', () => {
  it('summarizes ready, blocked, dropped and changes without prompt', () => {
    const digest = buildDigest({
      workspaceId: 'w1',
      now: 100,
      windowStart: 50,
      policyVersion: 'abc123abc123',
      tasks: [
        base,
        { ...base, id: 't2', title: '等待审批', status: 'waiting_input', waitingReason: 'approval', updatedAt: 80 },
        { ...base, id: 't3', title: '已放弃', status: 'waiting_input', waitingReason: 'dropped', updatedAt: 70 },
        { ...base, id: 't4', title: '进行中', status: 'running', updatedAt: 60 },
      ],
      autoDecisions: [
        { decision: 'allow', decidedAt: 75 },
        { decision: 'deny', decidedAt: 76 },
      ],
      retryAudits: [{ ts: 78 }],
      completedAtByTask: new Map([['t1', 90]]),
    })

    expect(digest.snapshot.total).toBe(4)
    expect(digest.snapshot.review).toBe(1)
    expect(digest.snapshot.waiting).toBe(2)
    expect(digest.ready.map((task) => task.id)).toEqual(['t1'])
    expect(digest.blocked.map((task) => task.id)).toEqual(['t2'])
    expect(digest.dropped.map((task) => task.id)).toEqual(['t3'])
    expect(digest.changes.autoAllowed).toBe(1)
    expect(digest.changes.autoDenied).toBe(1)
    expect(digest.changes.retried).toBe(1)
    expect(JSON.stringify(digest)).not.toContain('SECRET_PROMPT')
  })

  it('caps arrays at 20 and ignores tasks outside the workspace', () => {
    const digest = buildDigest({
      workspaceId: 'w1',
      now: 100,
      windowStart: 0,
      policyVersion: 'abc123abc123',
      tasks: [
        ...Array.from({ length: 25 }, (_, index) => ({
          ...base,
          id: `r${index}`,
          title: `ready-${index}`,
        })),
        { ...base, id: 'other', workspaceId: 'w2' },
      ],
      autoDecisions: [],
      retryAudits: [],
      completedAtByTask: new Map(),
    })
    expect(digest.ready).toHaveLength(20)
    expect(digest.snapshot.total).toBe(25)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/core exec vitest run test/automation-digest.test.ts`
Expected: FAIL，提示 `buildDigest` 未导出。

- [ ] **Step 3: 实现**

`packages/core/src/automation/digest.ts`：

- 过滤 `task.workspaceId === input.workspaceId`。
- 用 `boardColumn` 统计 `snapshot`；用 `needsPerson` 与 `attention` 统计 attention 分组。
- `ready` = `review`；`blocked` = `waiting_input` 且 `waitingReason !== 'dropped'`；`dropped` = `waiting_input` 且 `waitingReason === 'dropped'`。
- `oldestWaiting` 在 `waiting_input`/`review` 中取 `waitingSinceFor` 最小者；无则 `null`。
- `changes.created = tasks.filter(t => t.createdAt >= windowStart).length`；`updated` 同理；`completed` 用 `completedAtByTask` 落在窗口内计数；`failed/cancelled` 按 `status + updatedAt`；`retried = retryAudits.filter(a => a.ts >= windowStart).length`；`autoAllowed/autoDenied` 按 decision 计数。
- 只映射 `DigestTaskRef` 字段，禁止携带 `prompt/contextJson/originJson`。
- 数组按 `waitingSince ?? updatedAt` 倒序，`slice(0, 20)`。

`packages/core/src/index.ts` 导出 `buildDigest` 与类型。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/core test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): 增加 digest 纯函数"
```

---

## Task 4: migration 0007 与 setting/notice 仓储

Blocking: Task 1
Slice type: tracer-bullet
Seam: fixture DB 上 `migrateDb` 后能读写 setting、notice、audit 分页

**Files：**

- Modify: `apps/daemon/src/db/schema.ts`
- Create: `apps/daemon/migrations/0007_autopilot_v0.sql`（drizzle-kit 生成后校对）
- Modify: `apps/daemon/src/db/repositories.ts`
- Create: `apps/daemon/test/migration-0007.test.ts`
- Create: `apps/daemon/test/automation-repositories.test.ts`

**Interfaces：**

- Produces: `getSetting(tx|db, key)`、`setSetting(tx|db, key, value)`、`insertNotice`、`listNotices`、`markNoticeRead`、`listAudit`。
- Consumes: `Db/Tx`、`setting/notice/audit` schema。

- [ ] **Step 1: 写失败测试**

`apps/daemon/test/automation-repositories.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/db.js'
import {
  getSetting,
  insertAudit,
  insertNotice,
  listAudit,
  listNotices,
  markNoticeRead,
  setSetting,
} from '../src/db/repositories.js'

describe('automation repositories', () => {
  it('stores settings and marks notices read', () => {
    const { db } = createTestDb()
    db.transaction((tx) => {
      setSetting(tx, 'kill_switch', { enabled: true }, 10)
      insertNotice(tx, {
        id: 'n1',
        workspaceId: 'w1',
        ts: 20,
        kind: 'digest',
        payload: { ready: 1 },
      })
    })
    expect(getSetting(db, 'kill_switch')).toEqual({ enabled: true })
    expect(listNotices(db, { workspaceId: 'w1' })).toHaveLength(1)
    db.transaction((tx) => markNoticeRead(tx, 'n1', 30))
    expect(listNotices(db, { workspaceId: 'w1' })[0]?.readAt).toBe(30)
  })

  it('lists audit by action prefix with pagination', () => {
    const { db } = createTestDb()
    db.transaction((tx) => {
      insertAudit(tx, { id: 'a1', ts: 1, actor: 'user', action: 'automation.policy.update', detail: {} })
      insertAudit(tx, { id: 'a2', ts: 2, actor: 'user', action: 'automation.kill_switch', detail: {} })
      insertAudit(tx, { id: 'a3', ts: 3, actor: 'system', action: 'task.retry', detail: {} })
    })
    expect(listAudit(db, { actionPrefix: 'automation.', limit: 2 }).entries).toHaveLength(2)
  })
})
```

`apps/daemon/test/migration-0007.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { createTestDb } from './helpers/db.js'

describe('migration 0007', () => {
  it('creates setting and notice.workspace_id', () => {
    const { raw } = createTestDb()
    const tables = raw.prepare("select name from sqlite_master where type='table'").all()
    expect(tables.map((row) => row.name)).toContain('setting')
    const columns = raw.prepare('pragma table_info(notice)').all()
    expect(columns.map((row) => row.name)).toContain('workspace_id')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/automation-repositories.test.ts test/migration-0007.test.ts`
Expected: FAIL，提示 `setting` 表或仓储函数不存在。

- [ ] **Step 3: 实现 schema 与 migration**

`apps/daemon/src/db/schema.ts` 增加：

```ts
export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const notice = sqliteTable(
  'notice',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspace.id),
    ts: integer('ts').notNull(),
    kind: text('kind').notNull(),
    payloadJson: text('payload_json').notNull(),
    readAt: integer('read_at'),
  },
  (t) => [index('notice_workspace_ts_idx').on(t.workspaceId, t.ts)],
)
```

同时给 `audit` 增加 `index('audit_action_ts_idx').on(t.action, t.ts)`，给 `task`、`session`、`review` 增加 spec §6.3 的索引。

生成 migration：

```bash
pnpm exec drizzle-kit generate --name autopilot_v0
```

校对 `0007_*.sql` 包含 `setting`、`notice.workspace_id`、四个索引；若 drizzle 未生成复合索引，手工补 SQL 并更新 `migrations/meta/_journal.json`/snapshot，以 `migrateDb` 实际执行为准。

- [ ] **Step 4: 实现仓储**

`apps/daemon/src/db/repositories.ts`：

```ts
export function getSetting(db: Db, key: string): unknown {
  const row = db.select().from(setting).where(eq(setting.key, key)).get()
  return row ? JSON.parse(row.valueJson) : null
}

export function setSetting(tx: Tx, key: string, value: unknown, now: number): void {
  tx.insert(setting)
    .values({ key, valueJson: JSON.stringify(value), updatedAt: now })
    .onConflictDoUpdate({ target: setting.key, set: { valueJson: JSON.stringify(value), updatedAt: now } })
    .run()
}

export function insertNotice(tx: Tx, input: { id: string; workspaceId: string | null; ts: number; kind: string; payload: unknown }): void {
  tx.insert(notice)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      ts: input.ts,
      kind: input.kind,
      payloadJson: JSON.stringify(input.payload),
      readAt: null,
    })
    .run()
}
```

`listNotices` 按 `ts desc` 分页（`before` 为时间戳）；`markNoticeRead` 更新 `readAt`；`listAudit` 支持 `actionPrefix`、`before`、`limit`。查询用 drizzle 参数化条件，禁止拼接 SQL。

- [ ] **Step 5: 运行测试与 daemon 全量测试**

Run: `pnpm --filter @evanfang0054/baton test`
Expected: PASS；migration fixture 同时覆盖空库与已有任务/notice 升级。

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/db apps/daemon/migrations apps/daemon/test
git commit -m "feat(daemon): migration 0007 与自动化仓储"
```

---

## Task 5: 契约层全量校验与完成记录

Blocking: Tasks 1–4
Slice type: verification
Seam: `pnpm verify` 退出码 0

**Files：**

- Modify: 本计划末尾「完成记录」
- Modify: `docs/README.md`（如 plan 索引尚未加入）

- [ ] **Step 1: 运行全量校验**

```bash
pnpm verify
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

Expected: 全部退出码 0。

- [ ] **Step 2: 记录完成情况**

在本计划末尾追加：

```md
## 完成记录（YYYY-MM-DD）

- 关键 commit：
- 测试结果：
- 与计划的偏差：
- 未解决风险：
```

- [ ] **Step 3: Commit**

```bash
git add docs/plans/2026-11-19-m2-autopilot-contracts.md
git commit -m "docs(plan): 记录 M2-2a 契约层完成"
```

---

