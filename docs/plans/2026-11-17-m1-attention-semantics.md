---
spec_ref: ../specs/2026-11-17-m1-attention-semantics-design.md
spec_topic: m1-attention-semantics
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: "docs/contracts/M1-attention-semantics.contract.md 的 22 条全部由命令或测试判定"
depends_on: [2026-11-17-m1-daemon-runtime.md]
gdd: skipped
---

# M1-5a 任务注意力语义实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-harness:subagent-driven-development` (recommended) or `agent-harness:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任务状态能区分「做完了」「等我回答」「建议放弃」「停了没说明」，并允许用户直接回复等待中的会话。

**Architecture:** `packages/protocol` 增加 `SessionOutcome` / `WaitingReason` / `session.reply` / `session.outcome` 与 `task.status` 的 `cause/attention`；`packages/core` 增加 `session_reported` 与 `user_input` 转移；`apps/daemon` 在 session runner 解析结局、在 effects 中发送回复、在 boot 中保留 verify 证据。`task.status` 仍是投影，`ws_event` 仍是任务状态历史，不新增 `task_event`。

**Tech Stack:** TypeScript strict、zod 4、AG-UI、better-sqlite3 + Drizzle、Fastify 5 + ws、vitest 5。

**计划位置说明**：本仓库 plan 落 `docs/plans/`，不使用 `docs/agent-harness/plans/`。`scripts/validate-handoff.sh` 不存在，落盘后用 frontmatter、任务数、占位符扫描替代。

**Commit 策略**：按 M0/M1 先例，每个 Task 结束提交一次（Conventional Commits）。

---

## 文件结构

```
packages/protocol/
├── src/
│   ├── enums.ts                         # SessionOutcome / WaitingReason / Attention
│   ├── entities/task.ts                 # waitingReason
│   ├── entities/session.ts              # outcome
│   ├── transitions.ts                   # session_reported / user_input
│   ├── commands.ts                      # session.reply
│   ├── events.ts                        # session.outcome / cause / attention / user.message
│   └── api.ts                           # waitingSince
└── test/
    ├── attention.test.ts                # 新增
    ├── entities-core.test.ts            # 更新 fixture
    ├── entities-events.test.ts          # 更新 fixture
    ├── commands.test.ts                 # session.reply
    ├── events.test.ts                   # cause/attention/session.outcome
    └── transitions.test.ts              # 两个新事件

packages/core/
├── src/state-machine/
│   ├── types.ts                         # waitingReason / sendToSession
│   ├── effects.ts                       # emitTaskStatus(cause) / sendToSession
│   ├── attention.ts                     # attentionFor
│   ├── transition.ts                    # 新转移
│   └── index.ts                         # 导出 attentionFor
└── test/
    ├── transition-attention.test.ts     # 新增
    ├── transition-matrix.test.ts        # 9 × 14
    ├── effects.test.ts                  # 快照更新
    └── helpers.ts                       # TransitionContext 补 waitingReason

packages/adapters/
└── src/fake.ts                          # finish.outcome + session.outcome

apps/daemon/
├── migrations/0002_attention_semantics.sql
├── src/db/schema.ts                     # waiting_reason / outcome
├── src/db/repositories.ts               # updateTaskState / updateSessionStatus / toTask / toSession
├── src/runtime/transition-runner.ts     # waitingReason + attention
├── src/runtime/effects.ts               # sendToSession
├── src/runtime/session-runner.ts        # outcome / reply / 静默结束
├── src/runtime/types.ts                 # sendToSession hook
├── src/runtime/index.ts                 # session.reply 命令
├── src/runtime/boot.ts                  # verifying → verify_fail
├── src/http/tasks.ts                    # waitingSince
└── test/
    ├── migrate.test.ts                  # 新列
    ├── repositories.test.ts             # 新字段
    ├── session-runner-attention.test.ts # 新增
    ├── boot.test.ts                     # verify 收敛
    ├── ws-router.test.ts                # session.reply
    └── rest-api.test.ts                 # waitingSince

docs/
├── specs/2026-11-17-m1-attention-semantics-design.md
├── contracts/M1-attention-semantics.contract.md
├── plans/2026-11-17-m1-attention-semantics.md
├── adr/0001-no-full-event-sourcing.md
└── README.md
```

依赖关系：Task 1 → Task 2 → Task 3 → Task 4 → Task 5。

---

## Task 1: Protocol 与 core 状态机

Blocking: none
Slice type: tracer-bullet
Seam: `packages/protocol/test/attention.test.ts` + `packages/core/test/transition-attention.test.ts`

**Files:**
- Modify: `packages/protocol/src/enums.ts`
- Modify: `packages/protocol/src/entities/task.ts`
- Modify: `packages/protocol/src/entities/session.ts`
- Modify: `packages/protocol/src/transitions.ts`
- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/events.ts`
- Modify: `packages/protocol/src/api.ts`
- Create: `packages/protocol/test/attention.test.ts`
- Modify: `packages/protocol/test/entities-core.test.ts`
- Modify: `packages/protocol/test/entities-events.test.ts`
- Modify: `packages/protocol/test/commands.test.ts`
- Modify: `packages/protocol/test/events.test.ts`
- Modify: `packages/protocol/test/transitions.test.ts`
- Modify: `packages/core/src/state-machine/types.ts`
- Modify: `packages/core/src/state-machine/effects.ts`
- Create: `packages/core/src/state-machine/attention.ts`
- Modify: `packages/core/src/state-machine/transition.ts`
- Modify: `packages/core/src/state-machine/index.ts`
- Create: `packages/core/test/transition-attention.test.ts`
- Modify: `packages/core/test/transition-matrix.test.ts`
- Modify: `packages/core/test/effects.test.ts`
- Modify: `packages/core/test/helpers.ts`

**Interfaces:**
- Consumes: `zod`、`@baton/protocol`、现有 `TaskStatus` / `TaskTransitionEvent` / `TaskEffect`
- Produces: `SessionOutcome`、`WaitingReason`、`Attention`、`SessionOutcomeValue`、`SESSION_OUTCOME_EVENT`、`SessionReplyInput`、`session_reported`、`user_input`、`attentionFor`、`effects.sendToSession`、`TransitionResult.waitingReason`

- [ ] **Step 1: 写 protocol 失败测试**

```ts
// packages/protocol/test/attention.test.ts
import { describe, expect, it } from 'vitest'
import {
  Attention,
  ClientMessage,
  SESSION_OUTCOME_EVENT,
  SessionOutcome,
  SessionOutcomeValue,
  TaskStatusEvent,
  TaskTransitionEvent,
  WaitingReason,
} from '../src/index.js'

describe('attention protocol', () => {
  it('validates enums', () => {
    expect(SessionOutcome.parse('blocked')).toBe('blocked')
    expect(WaitingReason.parse('question')).toBe('question')
    expect(Attention.parse('needs_reply')).toBe('needs_reply')
    expect(() => SessionOutcome.parse('paused')).toThrow()
  })

  it('validates session outcome event', () => {
    expect(SESSION_OUTCOME_EVENT).toBe('session.outcome')
    expect(SessionOutcomeValue.parse({ outcome: 'blocked', reason: 'need a decision' })).toEqual({
      outcome: 'blocked',
      reason: 'need a decision',
    })
    expect(() => SessionOutcomeValue.parse({ outcome: 'blocked', reason: '' })).toThrow()
  })

  it('parses session.reply', () => {
    const message = ClientMessage.parse({
      v: 1,
      id: 'cmd-1',
      ts: 1,
      type: 'session.reply',
      payload: { taskId: 't1', text: 'use option B' },
    })
    expect(message.type).toBe('session.reply')
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'cmd-2',
        ts: 1,
        type: 'session.reply',
        payload: { taskId: 't1', text: '' },
      }),
    ).toThrow()
  })

  it('accepts non-ready session_reported only', () => {
    expect(
      TaskTransitionEvent.parse({ type: 'session_reported', outcome: 'blocked' }).type,
    ).toBe('session_reported')
    expect(() =>
      TaskTransitionEvent.parse({ type: 'session_reported', outcome: 'ready' }),
    ).toThrow()
  })

  it('accepts task.status with and without attention', () => {
    const base = {
      v: 1,
      type: 'task.status',
      ts: 1,
      seq: 1,
      payload: {
        taskId: 't1',
        status: 'waiting_input',
        previousStatus: 'running',
        retryCount: 0,
        updatedAt: 2,
      },
    }
    expect(TaskStatusEvent.parse(base).payload.attention).toBeUndefined()
    expect(
      TaskStatusEvent.parse({
        ...base,
        payload: {
          ...base.payload,
          attention: 'needs_reply',
          cause: { waitingReason: 'question', sessionId: 's1' },
        },
      }).payload.attention,
    ).toBe('needs_reply')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/protocol test -- attention`
Expected: FAIL，提示 `SessionOutcome` 等导出不存在。

- [ ] **Step 3: 实现 protocol**

`packages/protocol/src/enums.ts` 追加：

```ts
export const SessionOutcome = z.enum(['ready', 'blocked', 'dropped', 'unreported'])
export type SessionOutcome = z.infer<typeof SessionOutcome>

export const WaitingReason = z.enum(['approval', 'question', 'stalled', 'dropped'])
export type WaitingReason = z.infer<typeof WaitingReason>

export const Attention = z.enum(['none', 'needs_approval', 'needs_reply', 'needs_review'])
export type Attention = z.infer<typeof Attention>
```

`packages/protocol/src/entities/task.ts`：

```ts
import { Engine, TaskStatus, WaitingReason, WorkspaceMode } from '../enums.js'
// ...
waitingReason: WaitingReason.nullable(),
```

`packages/protocol/src/entities/session.ts`：

```ts
import { Engine, SessionOutcome, SessionStatus } from '../enums.js'
// ...
outcome: SessionOutcome.nullable(),
```

`packages/protocol/src/transitions.ts` 追加：

```ts
z.object({
  type: z.literal('session_reported'),
  outcome: z.enum(['blocked', 'dropped', 'unreported']),
  reason: z.string().min(1).optional(),
}),
z.object({
  type: z.literal('user_input'),
  text: z.string().min(1).max(16_384),
}),
```

`packages/protocol/src/commands.ts` 追加：

```ts
export const SessionReplyInput = z.object({
  taskId: Id,
  text: z.string().min(1).max(16_384),
})
export type SessionReplyInput = z.infer<typeof SessionReplyInput>

// ClientMessage 判别联合追加：
CommandBase.extend({ type: z.literal('session.reply'), payload: SessionReplyInput }),
```

`packages/protocol/src/events.ts` 追加：

```ts
import { Attention, SessionOutcome, TaskStatus, WaitingReason } from './enums.js'

export const SESSION_OUTCOME_EVENT = 'session.outcome'
export const USER_MESSAGE_EVENT = 'user.message'

export const SessionOutcomeValue = z.object({
  outcome: SessionOutcome,
  reason: z.string().min(1).optional(),
})
export type SessionOutcomeValue = z.infer<typeof SessionOutcomeValue>

export const TaskStatusCause = z.object({
  waitingReason: WaitingReason.optional(),
  outcome: SessionOutcome.optional(),
  sessionId: Id.optional(),
  approvalId: Id.optional(),
  reviewId: Id.optional(),
  reason: z.string().min(1).optional(),
})
export type TaskStatusCause = z.infer<typeof TaskStatusCause>
```

`TaskStatusEvent.payload` 增加：

```ts
cause: TaskStatusCause.optional(),
attention: Attention.optional(),
```

`packages/protocol/src/api.ts`：

```ts
import { Id, Timestamp } from './common.js'
// TaskDetailResponse 增加：
waitingSince: Timestamp.nullable(),
```

- [ ] **Step 4: 更新 protocol fixture 并跑测试**

Run: `pnpm --filter @baton/protocol test`
Expected: PASS。

如果 `Task` / `Session` fixture 缺字段，按报错补 `waitingReason: null` / `outcome: null`；不要放宽 schema。

- [ ] **Step 5: 写 core 失败测试**

```ts
// packages/core/test/transition-attention.test.ts
import { describe, expect, it } from 'vitest'
import { transition } from '../src/index.js'

const base = {
  status: 'running' as const,
  retryCount: 0,
  runningCount: 1,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 2 },
  waitingReason: null,
}

describe('attention transitions', () => {
  it('moves blocked to waiting_input(question)', () => {
    const result = transition(base, { type: 'session_reported', outcome: 'blocked' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status).toBe('waiting_input')
    expect(result.waitingReason).toBe('question')
    expect(result.effects.at(-1)?.type).toBe('emitTaskStatus')
  })

  it('moves dropped to waiting_input(dropped)', () => {
    const result = transition(base, { type: 'session_reported', outcome: 'dropped' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status).toBe('waiting_input')
    expect(result.waitingReason).toBe('dropped')
  })

  it('moves unreported to waiting_input(stalled)', () => {
    const result = transition(base, { type: 'session_reported', outcome: 'unreported' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status).toBe('waiting_input')
    expect(result.waitingReason).toBe('stalled')
  })

  it('accepts user input only for non-approval waiting', () => {
    const ok = transition(
      { ...base, status: 'waiting_input', waitingReason: 'question' },
      { type: 'user_input', text: 'use option B' },
    )
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.status).toBe('running')
    expect(ok.waitingReason).toBeNull()
    expect(ok.effects[0]).toEqual({ type: 'sendToSession', text: 'use option B' })

    const denied = transition(
      { ...base, status: 'waiting_input', waitingReason: 'approval' },
      { type: 'user_input', text: 'use option B' },
    )
    expect(denied.ok).toBe(false)
    if (denied.ok) return
    expect(denied.error.code).toBe('invalid_transition')
  })
})
```

Run: `pnpm --filter @baton/core test -- transition-attention`
Expected: FAIL，`waitingReason` 字段或 `sendToSession` 不存在。

- [ ] **Step 6: 实现 core**

`packages/core/src/state-machine/types.ts`：

```ts
import type {
  AppError, ApprovalDecision, Attention, DiffStat, ReviewVerdict, TaskStatus,
  TaskStatusCause, WaitingReason,
} from '@baton/protocol'

export interface TransitionContext {
  readonly status: TaskStatus
  readonly retryCount: number
  readonly runningCount: number
  readonly maxConcurrency: number
  readonly autopilot: { readonly enabled: boolean; readonly retryMax: number }
  readonly waitingReason: WaitingReason | null
}

export type TaskEffect =
  | { type: 'emitTaskStatus'; status: TaskStatus; cause?: TaskStatusCause }
  // ...既有分支保持不变
  | { type: 'sendToSession'; text: string }

export type TransitionResult =
  | {
      ok: true
      status: TaskStatus
      retryCount: number
      waitingReason: WaitingReason | null
      effects: TaskEffect[]
    }
  | { ok: false; error: AppError }
```

`packages/core/src/state-machine/effects.ts`：

```ts
import type { TaskStatus, TaskStatusCause } from '@baton/protocol'

export const effects = {
  emitTaskStatus: (status: TaskStatus, cause?: TaskStatusCause): TaskEffect => ({
    type: 'emitTaskStatus',
    status,
    ...(cause ? { cause } : {}),
  }),
  sendToSession: (text: string): TaskEffect => ({ type: 'sendToSession', text }),
  // ...既有 effect 保持不变
}
```

`packages/core/src/state-machine/attention.ts`：

```ts
import type { Attention, TaskStatus, WaitingReason } from '@baton/protocol'

export function attentionFor(
  status: TaskStatus,
  waitingReason: WaitingReason | null,
): Attention {
  if (status === 'waiting_input') {
    return waitingReason === 'approval' || waitingReason === null
      ? 'needs_approval'
      : 'needs_reply'
  }
  return status === 'review' ? 'needs_review' : 'none'
}
```

`packages/core/src/state-machine/transition.ts`：

```ts
function ok(
  status: TaskStatus,
  retryCount: number,
  extra: TaskEffect[],
  waitingReason: WaitingReason | null = null,
  cause?: TaskStatusCause,
): TransitionResult {
  return {
    ok: true,
    status,
    retryCount,
    waitingReason,
    effects: [...extra, effects.emitTaskStatus(status, cause)],
  }
}

// running 分支：
if (event.type === 'approval_requested') {
  return ok('waiting_input', ctx.retryCount, [effects.requestApproval(event.approvalId)], 'approval', {
    waitingReason: 'approval',
    approvalId: event.approvalId,
  })
}
if (event.type === 'session_reported') {
  const waitingReason = event.outcome === 'blocked'
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

// waiting_input 分支：
if (event.type === 'user_input') {
  if (ctx.waitingReason === null || ctx.waitingReason === 'approval') {
    return invalid(ctx, event)
  }
  return ok('running', ctx.retryCount, [effects.sendToSession(event.text)])
}
```

- [ ] **Step 7: 更新所有 `TransitionContext` fixture**

Run: `rg -n "TransitionContext|maxConcurrency:" packages/core/test packages/core/src`
Expected: 每个 context 字面量补 `waitingReason: null`；`helpers.ts` 的工厂函数补默认值。

- [ ] **Step 8: 更新矩阵与快照并跑测试**

Run: `pnpm --filter @baton/core test`
Expected: PASS；矩阵从 9 × 12 改为 9 × 14，新增转移有断言。快照只在确认差异符合 spec 后更新。

- [ ] **Step 9: Commit**

```bash
git add packages/protocol packages/core
git commit -m "feat(protocol): 增加会话结局与用户回复转移"
```

---

## Task 2: DB migration、repository 与 transition runner

Blocking: Task 1
Slice type: tracer-bullet
Seam: `apps/daemon/test/migrate.test.ts` + `apps/daemon/test/transition-runner.test.ts`

**Files:**
- Modify: `apps/daemon/src/db/schema.ts`
- Modify: `apps/daemon/src/db/repositories.ts`
- Create: `apps/daemon/migrations/0002_attention_semantics.sql`（由 drizzle-kit 生成）
- Modify: `apps/daemon/src/runtime/transition-runner.ts`
- Modify: `apps/daemon/src/runtime/effects.ts`
- Modify: `apps/daemon/src/runtime/types.ts`
- Modify: `apps/daemon/test/migrate.test.ts`
- Modify: `apps/daemon/test/repositories.test.ts`
- Modify: `apps/daemon/test/transition-runner.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `TransitionResult.waitingReason`、`TaskStatusCause`、`attentionFor`
- Produces: `task.waiting_reason`、`session.outcome`、`updateTaskState(..., waitingReason, ...)`、`updateSessionStatus(..., outcome)`、`TaskStatusEvent.attention`

- [ ] **Step 1: 写 migration 失败测试**

在 `apps/daemon/test/migrate.test.ts` 的旧 fixture 升级断言中追加：

```ts
const taskCols = database.raw
  .prepare("pragma table_info('task')")
  .all() as Array<{ name: string }>
expect(taskCols.map((column) => column.name)).toContain('waiting_reason')

const sessionCols = database.raw
  .prepare("pragma table_info('session')")
  .all() as Array<{ name: string }>
expect(sessionCols.map((column) => column.name)).toContain('outcome')

const oldTask = database.raw
  .prepare('select waiting_reason from task limit 1')
  .get() as { waiting_reason: string | null }
expect(oldTask.waiting_reason).toBeNull()
```

Run: `pnpm --filter @evanfang0054/baton test -- migrate`
Expected: FAIL，列不存在。

- [ ] **Step 2: 更新 schema 并生成 migration**

`apps/daemon/src/db/schema.ts`：

```ts
export const task = sqliteTable('task', {
  // ...
  waitingReason: text('waiting_reason'),
  // ...
})

export const session = sqliteTable('session', {
  // ...
  outcome: text('outcome'),
  // ...
})
```

Run:

```bash
pnpm --filter @evanfang0054/baton exec drizzle-kit generate
```

Expected: 生成 `0002_*.sql`，内容为两个 `ALTER TABLE ... ADD ...`。若 drizzle-kit 生成 table rebuild，手工改成 `ALTER TABLE`；两列均可空，不需要回填。

- [ ] **Step 3: 更新 repositories**

`apps/daemon/src/db/repositories.ts`：

```ts
import type { SessionOutcome, TaskStatus, WaitingReason } from '@baton/protocol'

export function updateTaskState(
  tx: Tx,
  id: string,
  status: TaskStatus,
  retryCount: number,
  waitingReason: WaitingReason | null,
  updatedAt: number,
): void {
  tx.update(task)
    .set({ status, retryCount, waitingReason, updatedAt })
    .where(eq(task.id, id))
    .run()
}

export function updateSessionStatus(
  tx: Tx,
  id: string,
  status: SessionStatus,
  endedAt: number | null = null,
  outcome: SessionOutcome | null = null,
): void {
  tx.update(session).set({ status, endedAt, outcome }).where(eq(session.id, id)).run()
}
```

同时更新 `toTask` / `toSession` 映射和 `insertTask` / `insertSession`：

```ts
// toTask
waitingReason: row.waitingReason as WaitingReason | null,

// toSession
outcome: row.outcome as SessionOutcome | null,

// insertTask
waitingReason: input.waitingReason,

// insertSession
outcome: input.outcome,
```

`TaskCreateInput` 不含新字段；`task.create` 插入 `waitingReason: null`。在 `task-service.ts` 的 `insertTask` 入参补 `waitingReason: null`。

- [ ] **Step 4: 更新 transition runner 与 effects**

`apps/daemon/src/runtime/transition-runner.ts`：

```ts
const result = transition(
  {
    status: task.status,
    retryCount: task.retryCount,
    runningCount: countActiveTasks(deps.db),
    maxConcurrency: deps.config.maxConcurrency,
    autopilot: policy.autopilot,
    waitingReason: task.waitingReason,
  },
  event,
)
// ...
updateTaskState(tx, task.id, result.status, result.retryCount, result.waitingReason, now)
```

`apps/daemon/src/runtime/effects.ts`：

```ts
import { attentionFor } from '@baton/core'

case 'emitTaskStatus': {
  plan.events.push(
    ctx.eventStore.appendTaskStatus(tx, {
      taskId: ctx.task.id,
      status: effect.status,
      previousStatus: ctx.previousStatus,
      retryCount: ctx.retryCount,
      updatedAt: ctx.now,
      ...(effect.cause ? { cause: effect.cause } : {}),
      attention: attentionFor(effect.status, effect.cause?.waitingReason ?? null),
    }),
  )
  break
}
case 'sendToSession': {
  plan.afterCommit.push(() => ctx.hooks.sendToSession(ctx.task.id, effect.text))
  break
}
```

`apps/daemon/src/runtime/types.ts` 的 `RuntimeHooks` 增加：

```ts
sendToSession(taskId: string, text: string): void | Promise<void>
```

并在 `createRuntime` 的 hooks 中接线（Task 4 完成 `SessionRunner.reply` 后）：

```ts
sendToSession:
  deps.sendToSession ??
  ((taskId, text) => (sessionHolder.value ? sessionHolder.value.reply(taskId, text) : undefined)),
```

同时 `RuntimeDeps` 增加可选 `sendToSession`，测试可以注入 stub。

- [ ] **Step 5: 更新 repositories 测试**

在 `apps/daemon/test/repositories.test.ts` 增加：

```ts
it('persists waiting reason and session outcome', () => {
  const taskId = seedTask(database.raw).taskId
  database.db.transaction((tx) => {
    updateTaskState(tx, taskId, 'waiting_input', 0, 'question', 10)
    const sessionId = 's-attention'
    insertSession(tx, {
      id: sessionId,
      taskId,
      adapter: 'fake',
      engineSessionId: null,
      status: 'running',
      outcome: null,
      startedAt: 1,
      endedAt: null,
    })
    updateSessionStatus(tx, sessionId, 'ended', 20, 'blocked')
  })

  const task = getTask(database.db, taskId)
  expect(task?.waitingReason).toBe('question')
  const session = getSession(database.db, 's-attention')
  expect(session?.outcome).toBe('blocked')
})
```

Run: `pnpm --filter @evanfang0054/baton test -- repositories migrate transition-runner`
Expected: PASS。

- [ ] **Step 6: 全量 typecheck 并修 fixture**

Run: `pnpm typecheck`
Expected: PASS。所有 `updateTaskState` / `updateSessionStatus` 调用点按新签名补参数；所有 `Task` / `Session` fixture 补 `waitingReason: null` / `outcome: null`。

- [ ] **Step 7: Commit**

```bash
git add apps/daemon packages/protocol packages/core
git commit -m "feat(daemon): 持久化等待原因与会话结局"
```

---

## Task 3: Fake 适配器与 session runner

Blocking: Task 2
Slice type: tracer-bullet
Seam: `apps/daemon/test/session-runner-attention.test.ts`

**Files:**
- Modify: `packages/adapters/src/fake.ts`
- Modify: `packages/adapters/test/fake.test.ts`
- Modify: `apps/daemon/src/runtime/session-runner.ts`
- Create: `apps/daemon/test/session-runner-attention.test.ts`
- Modify: `apps/daemon/test/session-runner.test.ts`
- Modify: `apps/daemon/test/failure-paths.test.ts`

**Interfaces:**
- Consumes: `SESSION_OUTCOME_EVENT`、`SessionOutcomeValue`、`USER_MESSAGE_EVENT`、`SessionRunner.reply`
- Produces: `FakeStep.finish.outcome`、`ActiveRun.outcome`、`ActiveRun.seq`、`session.reply` 的 runner 实现

- [ ] **Step 1: 写 fake 失败测试**

```ts
// packages/adapters/test/fake.test.ts 追加
import type { AgentEvent } from '@baton/protocol'

it('emits ready outcome before finish by default', async () => {
  const run = await new FakeAdapter().start({} as never)
  const events = []
  for await (const event of run.events) events.push(event)
  const outcome = events.find(
    (event) => event.type === 'CUSTOM' && event.name === 'session.outcome',
  )
  expect(outcome).toMatchObject({ value: { outcome: 'ready' } })
})

it('pauses on blocked and resumes after send', async () => {
  const run = await new FakeAdapter({
    script: [{ kind: 'pause', outcome: 'blocked' }, { kind: 'finish' }],
  }).start({} as never)
  const events: AgentEvent[] = []
  let onBlocked!: () => void
  const blocked = new Promise<void>((resolve) => {
    onBlocked = resolve
  })
  const collecting = (async () => {
    for await (const event of run.events) {
      events.push(event)
      if (
        event.type === 'CUSTOM' &&
        event.name === 'session.outcome' &&
        event.value.outcome === 'blocked'
      ) {
        onBlocked()
      }
    }
  })()
  await blocked
  await run.send('continue')
  await collecting
  expect(
    events.some(
      (event) =>
        event.type === 'CUSTOM' &&
        event.name === 'session.outcome' &&
        event.value.outcome === 'ready',
    ),
  ).toBe(true)
})
```

Run: `pnpm --filter @baton/adapters test -- fake`
Expected: FAIL，`pause` 不被接受或事件缺失。

- [ ] **Step 2: 实现 fake 结局**

`packages/adapters/src/fake.ts`：

```ts
import { SESSION_OUTCOME_EVENT } from '@baton/protocol'

export type FakeStep =
  | { kind: 'text'; text: string }
  | { kind: 'approval'; request: ApprovalRequest }
  | { kind: 'pause'; outcome: 'blocked' | 'dropped'; reason?: string }
  | { kind: 'finish'; outcome?: 'ready' | 'unreported' }
  | { kind: 'error'; message: string }
```

`pause` 需要在 `start()` 的闭包里持有等待中的 send：

```ts
let pauseWait: Deferred<string> | null = null

// events 生成器里：
} else if (step.kind === 'pause') {
  yield event({
    type: EventType.CUSTOM,
    name: SESSION_OUTCOME_EVENT,
    value: { outcome: step.outcome, ...(step.reason ? { reason: step.reason } : {}) },
  })
  const wait = deferred<string>()
  pauseWait = wait
  const reply = await wait.promise
  pauseWait = null
  if (isClosed() || interrupted) {
    return
  }
  yield* text(`fake: resumed: ${reply}`)
}

// send：
send: async (delta) => {
  if (isClosed()) {
    throw new Error('fake adapter run is closed')
  }
  if (pauseWait) {
    const wait = pauseWait
    pauseWait = null
    wait.resolve(delta)
    return
  }
  queue.push(delta)
}
```

`interrupt` / `dispose` / 生成器 `finally` 里要 `pauseWait?.resolve('')` 并置空，
避免测试或关闭流程卡在 pause 上。

在 `finish` 分支前发 outcome：

```ts
} else if (step.kind === 'finish') {
  if (step.outcome === 'unreported') {
    return
  }
  yield event({
    type: EventType.CUSTOM,
    name: SESSION_OUTCOME_EVENT,
    value: { outcome: 'ready' },
  })
  break
}
```

默认脚本的 `{ kind: 'finish' }` 自动得到 `ready`；`unreported` 直接结束事件流（不发 `RUN_FINISHED`），用于测试静默停止路径。

审批被拒绝的分支同样要在 `RUN_FINISHED` 前发 `ready`，否则 M1-5 的 auto-deny 测试会从 `verifying` 变成 `waiting_input`：

```ts
if (decision === 'deny') {
  yield* text('fake: denied')
  if (isClosed() || interrupted) {
    return
  }
  yield event({
    type: EventType.CUSTOM,
    name: SESSION_OUTCOME_EVENT,
    value: { outcome: 'ready' },
  })
  finished = true
  yield event({ type: EventType.RUN_FINISHED, threadId, runId })
  return
}
```

- [ ] **Step 3: 写 session runner 失败测试**

```ts
// apps/daemon/test/session-runner-attention.test.ts
import { FakeAdapter } from '@baton/adapters'
import { afterEach, describe, expect, it } from 'vitest'
import { listSessionsByTask } from '../src/db/repositories.js'
import { createAdapterFactory } from '../src/runtime/adapter-factory.js'
import { waitFor } from './helpers/async.js'
import { createTestRuntime, type TestRuntimeHandle } from './helpers/runtime.js'

const handles: TestRuntimeHandle[] = []

function setup(script: ConstructorParameters<typeof FakeAdapter>[0]['script']) {
  const handle = createTestRuntime({
    useSessionRunner: true,
    adapters: createAdapterFactory({ fake: new FakeAdapter({ script }) }),
  })
  handles.push(handle)
  return handle
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()))
})

describe('session runner attention', () => {
  it('blocked -> waiting_input(question) -> reply -> verifying', async () => {
    const handle = setup([
      { kind: 'text', text: 'need a decision' },
      { kind: 'pause', outcome: 'blocked' },
      { kind: 'finish' },
    ])
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })

    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input')
    expect(handle.runtime.getTask(taskId)?.waitingReason).toBe('question')
    const paused = listSessionsByTask(handle.database.db, taskId)[0]
    expect(paused?.status).toBe('waiting_input')
    expect(paused?.outcome).toBeNull()

    const replied = handle.runtime.handleCommand({
      v: 1,
      id: 'reply-1',
      ts: 1,
      type: 'session.reply',
      payload: { taskId, text: 'use option B' },
    })
    expect(replied.ok).toBe(true)

    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'verifying')
    expect(handle.events.some((event) => event.type === 'task.status')).toBe(true)
  })

  it('missing outcome -> waiting_input(stalled), not failed', async () => {
    const handle = setup([{ kind: 'finish', outcome: 'unreported' }])
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })

    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'waiting_input')
    expect(handle.runtime.getTask(taskId)?.waitingReason).toBe('stalled')
  })

  it('RUN_ERROR -> failed', async () => {
    const handle = setup([{ kind: 'error', message: 'boom' }])
    const taskId = handle.createTask()
    handle.runtime.applyTransition(taskId, { type: 'enqueue' })

    await waitFor(() => handle.runtime.getTask(taskId)?.status === 'failed')
  })
})
```

Run: `pnpm --filter @evanfang0054/baton test -- session-runner-attention`
Expected: FAIL，`waitingReason` 或 `session.reply` 未实现。

- [ ] **Step 4: 实现 session runner**

`apps/daemon/src/runtime/session-runner.ts`：

```ts
import {
  SESSION_OUTCOME_EVENT,
  SessionOutcomeValue,
  USER_MESSAGE_EVENT,
  type SessionOutcome,
} from '@baton/protocol'

interface ActiveRun {
  taskId: string
  sessionId: string
  run: AgentRun
  requestIdByApprovalId: Map<string, string>
  seq: number
  outcome: SessionOutcome | null
  outcomeReason?: string
}
```

`consume` 使用 `active.seq`：

```ts
const seq = ++active.seq
const wsEvent = deps.eventStore.appendSessionEvent({
  sessionId: active.sessionId,
  seq,
  event,
  ts: deps.now(),
})
```

CUSTOM 分支增加：

```ts
} else if (event.type === EventType.CUSTOM && event.name === SESSION_OUTCOME_EVENT) {
  const parsed = SessionOutcomeValue.safeParse(event.value)
  if (!parsed.success || parsed.data.outcome === 'unreported' || active.outcome !== null) {
    deps.applyTransition(active.taskId, {
      type: 'error',
      message: 'invalid session outcome',
    })
    break
  }
  active.outcome = parsed.data.outcome
  if (parsed.data.reason) active.outcomeReason = parsed.data.reason

  if (parsed.data.outcome === 'blocked' || parsed.data.outcome === 'dropped') {
    const outcome = deps.applyTransition(active.taskId, {
      type: 'session_reported',
      outcome: parsed.data.outcome,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    })
    if (!outcome.ok) {
      break
    }
    deps.db.transaction((tx) =>
      updateSessionStatus(tx, active.sessionId, 'waiting_input', null, null),
    )
    // 不 break：run 仍然活着，等待 session.reply 调 send。
  }
}
```

`RUN_FINISHED` 分支：

```ts
} else if (event.type === EventType.RUN_FINISHED) {
  finished = true
  if (active.outcome !== 'ready') {
    deps.applyTransition(active.taskId, {
      type: 'error',
      message: 'RUN_FINISHED without ready outcome',
    })
    endSession(active.sessionId, 'failed')
  } else {
    deps.applyTransition(active.taskId, { type: 'completed' })
    endSession(active.sessionId, 'ended', 'ready')
  }
  break
}
```

`reply` 需要把 session 写回 `running`，并拒绝非 blocked/dropped 的等待态：

```ts
async function reply(taskId: string, text: string): Promise<void> {
  const active = [...activeRuns.values()].find((run) => run.taskId === taskId)
  if (!active) {
    throw appError('session_not_active', 'no active session for task', { taskId })
  }
  if (active.outcome !== 'blocked' && active.outcome !== 'dropped') {
    throw appError('reply_not_allowed', 'session is not waiting for a reply', {
      taskId,
      outcome: active.outcome,
    })
  }

  active.outcome = null
  active.outcomeReason = undefined
  deps.db.transaction((tx) => updateSessionStatus(tx, active.sessionId, 'running', null, null))

  const seq = ++active.seq
  const wsEvent = deps.eventStore.appendSessionEvent({
    sessionId: active.sessionId,
    seq,
    event: { type: EventType.CUSTOM, name: USER_MESSAGE_EVENT, value: { text } },
    ts: deps.now(),
  })
  deps.broadcast(wsEvent)

  try {
    await active.run.send(text)
  } catch (error) {
    deps.applyTransition(taskId, { type: 'error', message: toAppError(error).message })
    endSession(active.sessionId, 'failed')
    throw error
  }
}
```

流结束分支：

```ts
if (!finished) {
  const current = getTask(deps.db, active.taskId)
  if (current?.status === 'running') {
    deps.applyTransition(active.taskId, {
      type: 'session_reported',
      outcome: 'unreported',
    })
    endSession(active.sessionId, 'ended', 'unreported')
  } else if (current?.status === 'waiting_input') {
    deps.applyTransition(active.taskId, {
      type: 'error',
      message: 'adapter stream ended while waiting for input',
    })
    endSession(active.sessionId, 'failed')
  } else if (current?.status === 'cancelled') {
    endSession(active.sessionId, 'ended')
  }
}
```

`endSession` 增加 outcome：

```ts
function endSession(
  sessionId: string,
  status: 'ended' | 'failed',
  outcome: SessionOutcome | null = null,
): void {
  deps.db.transaction((tx) => updateSessionStatus(tx, sessionId, status, deps.now(), outcome))
}
```

`reply`：

```ts
async function reply(taskId: string, text: string): Promise<void> {
  const active = [...activeRuns.values()].find((run) => run.taskId === taskId)
  if (!active) {
    throw appError('session_not_active', 'no active session for task', { taskId })
  }
  const seq = ++active.seq
  const wsEvent = deps.eventStore.appendSessionEvent({
    sessionId: active.sessionId,
    seq,
    event: { type: EventType.CUSTOM, name: USER_MESSAGE_EVENT, value: { text } },
    ts: deps.now(),
  })
  deps.broadcast(wsEvent)

  try {
    await active.run.send(text)
  } catch (error) {
    deps.applyTransition(taskId, { type: 'error', message: toAppError(error).message })
    endSession(active.sessionId, 'failed')
    throw error
  }
}

function has(taskId: string): boolean {
  return [...activeRuns.values()].some((run) => run.taskId === taskId)
}

return { start, interrupt, approve, reply, has, close }
```

- [ ] **Step 5: 更新既有 session runner 测试**

- `session-runner.test.ts` 的 happy path 仍应到 `verifying`（默认 ready；auto-deny 分支也要发 ready）。
- `failure-paths.test.ts` 里「流意外结束 → failed」的断言改为：
  - fake 显式 `error` → `failed`；
  - 新增 `finish: unreported` → `waiting_input(stalled)`，session `ended/unreported`；
  - `pause: blocked` 后直接 `interrupt` → `failed`；
  - 不再断言「所有意外结束都 failed」。

Run: `pnpm --filter @evanfang0054/baton test -- session-runner`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/adapters apps/daemon
git commit -m "feat(daemon): 会话结局与等待回复"
```

---

## Task 4: Boot、runtime、WS 与 REST

Blocking: Task 3
Slice type: tracer-bullet
Seam: `apps/daemon/test/boot.test.ts` + `apps/daemon/test/ws-router.test.ts` + `apps/daemon/test/rest-api.test.ts`

**Files:**
- Modify: `apps/daemon/src/runtime/boot.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/src/runtime/types.ts`
- Modify: `apps/daemon/src/http/tasks.ts`
- Modify: `apps/daemon/test/boot.test.ts`
- Modify: `apps/daemon/test/ws-router.test.ts`
- Modify: `apps/daemon/test/rest-api.test.ts`
- Modify: `apps/daemon/test/runtime-e2e.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `SessionRunner.reply` / `has`
- Produces: `session.reply` WS 命令、`waitingSince`、`verifying` 重启证据

- [ ] **Step 1: 写 boot 失败测试**

在 `apps/daemon/test/boot.test.ts` 增加：

```ts
it('keeps verify evidence when daemon restarts during verifying', async () => {
  const handle = setup()
  const taskId = handle.createTask()
  handle.runtime.applyTransition(taskId, { type: 'enqueue' })
  await handle.runtime.settle()
  handle.runtime.applyTransition(taskId, { type: 'completed' })
  await handle.runtime.settle()

  reconcileOnBoot({
    db: handle.database.db,
    applyTransition: handle.runtime.applyTransition,
    now: () => 99,
    newId: () => 'review-boot',
  })

  expect(handle.runtime.getTask(taskId)?.status).toBe('review')
  const review = handle.runtime.getReviewByTask(taskId)
  expect(review?.verifyExitCode).toBe(124)
  expect(review?.verifyOutput).toContain('daemon restarted during verify')
})
```

Run: `pnpm --filter @evanfang0054/baton test -- boot`
Expected: FAIL，任务仍是 `cancelled` 或没有 review。

- [ ] **Step 2: 实现 boot 收敛**

`apps/daemon/src/runtime/boot.ts`：

```ts
import type { TaskTransitionEvent } from '@baton/protocol'

applyTransition: (taskId: string, event: TaskTransitionEvent) => TransitionOutcome

for (const task of listTasksByStatus(deps.db, ['verifying'])) {
  deps.applyTransition(task.id, {
    type: 'verify_fail',
    reviewId: deps.newId(),
    exitCode: 124,
    output: 'daemon restarted during verify',
    diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
  })
}
```

`running/waiting_input` 的 `error` 收敛保持不变；pending approval 过期保持不变。

- [ ] **Step 3: 实现 `session.reply` 命令**

`apps/daemon/src/runtime/index.ts`：

```ts
import { getActiveSession } from '../db/repositories.js'

case 'session.reply': {
  const task = getTask(deps.db, message.payload.taskId)
  if (!task) {
    return { ok: false, error: appError('task_not_found', 'task not found', { taskId: message.payload.taskId }) }
  }
  if (task.status !== 'waiting_input') {
    return {
      ok: false,
      error: appError('reply_not_allowed', 'task is not waiting for input', {
        taskId: task.id,
        status: task.status,
      }),
    }
  }
  if (task.waitingReason === null || task.waitingReason === 'approval') {
    return {
      ok: false,
      error: appError('reply_not_allowed', 'approval must be decided with approval.decide', {
        taskId: task.id,
        waitingReason: task.waitingReason,
      }),
    }
  }
  if (!sessionHolder.value?.has(task.id)) {
    return {
      ok: false,
      error: appError('session_not_active', 'no active session for task', { taskId: task.id }),
    }
  }
  return ackFromOutcome(
    applyTransition(task.id, { type: 'user_input', text: message.payload.text }),
  )
}
```

`RuntimeHooks` 增加 `sendToSession`，`createRuntime` 接线：

```ts
sendToSession:
  deps.sendToSession ??
  ((taskId, text) => (sessionHolder.value ? sessionHolder.value.reply(taskId, text) : undefined)),
```

`RuntimeDeps` 增加可选 `sendToSession`，测试可注入。

- [ ] **Step 4: 实现 `waitingSince`**

`apps/daemon/src/http/tasks.ts`：

```ts
const waitingSince =
  task.status === 'waiting_input' || task.status === 'review' ? task.updatedAt : null

return TaskDetailResponse.parse({
  task,
  sessions: listSessionsByTask(deps.db, task.id),
  approvals: listApprovalsByTask(deps.db, task.id),
  review: getReviewByTask(deps.db, task.id),
  waitingSince,
})
```

- [ ] **Step 5: 写 WS/REST 测试**

把现有 `reconcileOnBoot` 测试里的 `verifying → cancelled` 断言改为 `verifying → review`，
并断言 `verifyExitCode=124`、`verifyOutput` 含 `daemon restarted during verify`。

```ts
// ws-router.test.ts 追加
it('rejects session.reply for approval waiting', async () => {
  // 用现有 approval 场景创建 waiting_input(approval)
  const response = await sendCommand({
    v: 1,
    id: 'reply-1',
    ts: 1,
    type: 'session.reply',
    payload: { taskId, text: 'hello' },
  })
  expect(response.type).toBe('error')
  expect(response.payload.code).toBe('reply_not_allowed')
})

// rest-api.test.ts 追加
it('returns waitingSince for waiting tasks', async () => {
  const response = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` })
  const body = response.json()
  expect(body.waitingSince).toBeTypeOf('number')
  expect(body.task.waitingReason).toBe('question')
})
```

用现有 helper 的 `sendCommand` / `app.inject` 写法；不要新造 HTTP 客户端。

Run: `pnpm --filter @evanfang0054/baton test -- boot ws-router rest-api runtime-e2e`
Expected: PASS。

- [ ] **Step 6: 补端到端**

在 `runtime-e2e.test.ts` 增加一条：

```ts
it('question -> reply -> verify -> review -> done', async () => {
  const handle = createTestRuntime({
    useSessionRunner: true,
    adapters: createAdapterFactory({
      fake: new FakeAdapter({
        script: [
          { kind: 'text', text: 'need a decision' },
          { kind: 'pause', outcome: 'blocked' },
          { kind: 'finish' },
        ],
      }),
    }),
  })
  const taskId = handle.createTask()
  handle.runtime.applyTransition(taskId, { type: 'enqueue' })
  await waitFor(() => handle.runtime.getTask(taskId)?.waitingReason === 'question')

  const replied = handle.runtime.handleCommand({
    v: 1,
    id: 'reply-1',
    ts: 1,
    type: 'session.reply',
    payload: { taskId, text: 'use option B' },
  })
  expect(replied.ok).toBe(true)

  // runVerify stub 需要把任务推到 review；按现有 e2e helper 的 verify 流程断言
  await waitFor(() => handle.runtime.getTask(taskId)?.status === 'review')
})
```

如果 fake 的 `send` 只会把文本排进流，不会自动 finish，测试脚本要在 reply 后补一个 `finish` 步骤；按 FakeAdapter 的实际队列行为调整脚本，不要 mock session runner。

- [ ] **Step 7: Commit**

```bash
git add apps/daemon
git commit -m "feat(daemon): 回复命令与重启验收证据"
```

---

## Task 5: 文档同步与全量验证

Blocking: Task 4
Slice type: verification
Seam: `pnpm verify:full` + docs review

**Files:**
- Modify: `docs/specs/2026-11-16-baton-architecture-design.md`
- Modify: `docs/specs/2026-11-17-m1-daemon-runtime-design.md`
- Modify: `docs/specs/2026-11-17-m1-protocol-state-machine-design.md`
- Create: `docs/adr/0001-no-full-event-sourcing.md`
- Modify: `docs/README.md`
- Modify: `docs/plans/2026-11-17-m1-attention-semantics.md`（执行记录）

**Interfaces:**
- Consumes: Task 1-4 的实现与测试
- Produces: 文档事实同步、ADR、索引、执行记录

- [ ] **Step 1: 写 ADR**

`docs/adr/0001-no-full-event-sourcing.md`：

```md
# ADR 0001：不做完整事件溯源，`task.status` 作为投影

- 状态：proposed
- 日期：2026-11-17

## 背景

baton 已有 `task.status`、`ws_event`、`event` 与会话 transcript。
M1-5a 需要让任务状态可解释（cause/attention），但不是多写者或合规回溯场景。

## 选项

1. 完整事件溯源：只存领域事件，状态折叠得出。
2. 状态投影 + `ws_event` 历史：`task.status` 单写者、事务更新，事件用于重放与解释。
3. 不存状态，每次从事件现算。

## 决定

选 2。`task.status` 是投影，不是第二事实来源；`transition()` 是唯一写入口；
任务状态历史由 `ws_event` 承担；本轮不新增 `task_event`。

## 后果

- 优点：读模型简单、看板无投影延迟、迁移成本低、隐私面更小。
- 代价：不能任意时间点回放；若 `task.status` 被旁路写入，历史无法自动纠正。
- 回退：出现多 daemon/多写者、任务历史 UI、合规回溯时，再评估 task aggregate 的事件溯源。

## 触发条件

多写者；一个任务多 session 并发；合规时间点回溯；投影 bug 频繁需要 replay。
```

- [ ] **Step 2: 更新架构 spec 的事实漂移（不改锁定语义）**

`docs/specs/2026-11-16-baton-architecture-design.md`：

- §2.4：`event` 行补 `ordinal`；新增 `ws_event` 行；`approval` 行补 `request_id`。
- §2.10：命令表补 `task.enqueue`；把 `task.retry`、`auth`、`supervisor.send`、`node/edge/context.inject`、`canvas.patch`、`notice` 标为“后置到 M1-5a/M1-6/M2”。
- §7：M1 里程碑拆成 M1-5（done）、M1-5a（本 slice）、M1-6 web、M1-7 Claude。
- §8：补三条风险（提问误判、状态不可解释、重启丢证据）。
- §9：S2 截止改 M1-7 前；S3/S4 按实际状态更新。
- §10：追加决策（不完整 ES、会话结局、7 列投影、Router 后置），不重写旧条目。
- 文首加一行：`后续增量见 docs/specs/2026-11-17-m1-attention-semantics-design.md`。

不要改 §1.2 五条不变量、§2.5 转移表的既有行；语义增量由新 spec 承担。

- [ ] **Step 3: 更新子 spec 状态**

- `docs/specs/2026-11-17-m1-daemon-runtime-design.md` 头部“设计草案，待用户评审”改为“已实现，已随 PR #5 合并；本 slice 的增量见 attention spec”。
- `docs/specs/2026-11-17-m1-protocol-state-machine-design.md` 文首加一行“M1-5a 增量见 `2026-11-17-m1-attention-semantics-design.md`；本文转移表不被直接改写”。

- [ ] **Step 4: 更新 README 索引**

`docs/README.md` 的“现行 spec / contract / plan”各补一行：

```md
- [2026-11-17 M1-5a 任务注意力语义设计](specs/2026-11-17-m1-attention-semantics-design.md)
- [M1-5a 任务注意力语义](contracts/M1-attention-semantics.contract.md)
- [M1-5a 任务注意力语义实施计划](plans/2026-11-17-m1-attention-semantics.md)
```

新增“现行 ADR”小节：

```md
## 现行 ADR

- [0001 不做完整事件溯源](adr/0001-no-full-event-sourcing.md)
```

- [ ] **Step 5: 跑全量验证**

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
git diff --name-only main...HEAD -- apps/web
```

Expected: 前六条退出码 0；最后一条输出为空。

- [ ] **Step 6: 更新执行记录并 Commit**

在 `docs/plans/2026-11-17-m1-attention-semantics.md` 末尾追加执行记录表，
记录每个 Task 的实际 commit、测试结果与偏离说明；执行时填写真实值，不预填占位。

```bash
git add docs
git commit -m "docs: 同步 M1-5a 注意力语义与架构状态"
```

---

## Self-Review

**1. Spec coverage**

- spec §4.1-4.7 → Task 1；§5 → Task 1；§6.1-6.3 → Task 3；§6.4 → Task 4；§7 → Task 2/3；§8 → Task 1-4；§9 → Task 5。
- contract 22 条均有对应 Task 或验证命令；Task 5 负责文档与全量命令。

**2. Placeholder scan**

- 无 `TODO`/`TBD`/“类似 Task N”；每个 Task 都有测试代码、实现片段、运行命令与提交命令。
- `runtime-e2e` 的 verify stub 断言需按现有 helper 的实际流程调整，但不得 mock session runner。

**3. Type consistency**

- `SessionOutcome` 在 entity、CUSTOM 事件、`session_reported` 三处使用同一枚举；`session_reported` 只接受非 ready。
- `WaitingReason` 与 `attentionFor` 的输入输出一致；`waitingReason=null` 在 `waiting_input` 下按 `approval` 处理。
- `updateTaskState` / `updateSessionStatus` 的新签名在 Task 2 中定义，Task 3/4 只调用，不重复定义。
- `sendToSession` 在 core effect、daemon hook、session runner 三层同名，参数均为 `(taskId, text)` 或 `(text)`，按层转换。

**4. Boundary check**

- `apps/web` 无改动；`packages/core` 不 import `node:*`；`packages/protocol` 不 import daemon。
- 不新增运行时依赖；不引入 `task_event`；不实现 `task.retry/reopen`。
- `session.reply` 有状态守卫、审批守卫、活跃 run 守卫与长度上限。

---

## 执行记录

| 日期 | Task | 结果 | Commit | 备注 |
|---|---|---|---|---|
| 2026-11-17 | Task 1-4 | `pnpm verify` 全绿；protocol 78、core 95、adapters 13、daemon 98 tests | `d746f5c` | 跨层契约改动合并为一个 code commit，避免中间 commit 全量 typecheck 失败 |
| 2026-11-17 | Task 5 | `pnpm verify:full`、`pnpm pack:check` 全绿；`apps/web` 无 diff | 见 docs commit | 架构 spec 只做事实同步与回链，未改写锁定语义 |

**已记录偏离**：

- `blocked`/`dropped` 实现为**暂停而非结束**：适配器不发 `RUN_FINISHED`，run 保持活跃，`session.reply` 通过 `AgentRun.send` 继续；`session.outcome` 仅在会话真正结束时写入。
- fake 的 `finish { outcome: 'unreported' }` 直接结束事件流、不发 `RUN_FINISHED`，用于验证「静默停止」；`RUN_FINISHED` 缺少 ready 视为协议违约。
- `task_event` 未新增；`ws_event` 继续承担任务状态历史。
- `task.retry/reopen` 未实现，按 spec 留到 M2。

---

## 后续

- M1-6 web：按 `waitingReason/attention/waitingSince` 做 7 列看板、任务卡等待时长、回复输入框、验收卡。
- M1-7 agent-claude：映射 SDK 的结束原因到 `SESSION_OUTCOME_EVENT`，并接通 `AgentRun.send`。
- M2：Router 工具白名单、通知升级、`task.retry/reopen`、外部触发器 ADR。
