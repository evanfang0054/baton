---
spec_ref: ../specs/2026-11-21-m6-2-context-injection-design.md
spec_topic: m6-2-context-injection
task_count: 6
estimated_phases: [tests, implementation, verification]
dod: 'M6-2 DoD 1-6, 12：protocol/core 注入模型、状态矩阵、预算、prompt 块、enqueuedAt、migration 0011'
status: pending
depends_on: []
---

# M6-2 Plan 1：protocol + core + migration 0011

> **For agentic workers:** REQUIRED SUB-SKILL: Use agent-harness:subagent-driven-development (recommended) or agent-harness:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先把注入的协议、纯函数、状态机 effect 和数据库列做对，让后续 daemon/web 只接线，不再改语义。

**Architecture:** `ContextInjection` 是 append-only 事实，挂在 `ContextSnapshot.injections[]`；`assembleContext` 抽出共享的 `assemblePayload`，`assembleContextInjection` 复用它并产出 `<context_update>` 块；`user_input`/`reject` 增加可选 `contextInjection` 和纯 DB effect；migration 0011 只加 nullable 列并回填 queued。

**Tech Stack:** TypeScript ESM、zod 4、vitest、drizzle-kit、better-sqlite3。

**Commit strategy:** 每个 task 末尾提交；最后统一跑 `pnpm verify`。

**File structure:**

- `packages/protocol/src/context.ts`：`ContextInjection`、`ContextSnapshot.injections`。
- `packages/protocol/src/commands.ts`：`ContextInjectInput`、`context.inject`、review decide 字段。
- `packages/protocol/src/entities/task.ts` / `session.ts`：`enqueuedAt`、`costUsd/turns`。
- `packages/protocol/src/transitions.ts`：`user_input`/`reject` 可选 `contextInjection`。
- `packages/protocol/src/events.ts`：`context.injected`、`SESSION_USAGE_EVENT`。
- `packages/core/src/context/assemble.ts`：抽出 `assemblePayload`，保持 `assembleContext` 输出不变。
- `packages/core/src/context/inject.ts`：`canInjectContext`、`assembleContextInjection`、`buildContextUpdateBlock`、`cumulativeInjectedChars`。
- `packages/core/src/canvas/scene.ts`：`relatedNodeIdSet` 纳入注入节点。
- `packages/core/src/state-machine/{types,effects,transition}.ts`：`appendContextInjection`。
- `apps/daemon/src/db/schema.ts` + `apps/daemon/migrations/0011_*.sql`：新列与回填。
- `apps/daemon/src/db/repositories.ts`：注入上下文、队列排序、usage 更新。

---

### Task 1: Protocol schemas

Blocking: none
Slice type: tracer-bullet
Seam: `packages/protocol/test/context-injection.test.ts`

**Files:**
- Create: `packages/protocol/test/context-injection.test.ts`
- Modify: `packages/protocol/src/context.ts`
- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/entities/task.ts`
- Modify: `packages/protocol/src/entities/session.ts`
- Modify: `packages/protocol/src/transitions.ts`
- Modify: `packages/protocol/src/events.ts`

**Interfaces:**
- Produces: `ContextInjection`、`ContextInjectInput`、`ContextSnapshot.injections`、`Task.enqueuedAt`、`Session.costUsd/turns`、`ContextInjectedEvent`、`SESSION_USAGE_EVENT`。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  ContextInjection,
  ContextInjectInput,
  ContextSnapshot,
  ReviewDecideInput,
  SESSION_USAGE_EVENT,
  ServerMessage,
  Session,
  Task,
  TaskTransitionEvent,
} from '../src/index.js'

const injection = {
  seq: 1,
  at: 1_700_000_000_000,
  source: 'user' as const,
  note: '补充报错',
  nodeIds: ['n1'],
  included: [{ id: 'n1', type: 'text' as const, title: '报错', depth: 0, chars: 12 }],
  dropped: [],
  truncated: false,
  relations: [],
  relationsTruncated: false,
  chars: 17,
}

describe('M6-2 protocol', () => {
  it('defaults old ContextSnapshot to empty injections', () => {
    const parsed = ContextSnapshot.parse({
      included: [],
      dropped: [],
      truncated: false,
      redactedPaths: [],
      relations: [],
      relationsTruncated: false,
    })
    expect(parsed.injections).toEqual([])
  })

  it('parses ContextInjection and rejects empty nodeIds', () => {
    expect(ContextInjection.parse(injection)).toEqual(injection)
    expect(ContextInjectInput.safeParse({ taskId: 't1', nodeIds: [] }).success).toBe(false)
    expect(ContextInjectInput.safeParse({ taskId: 't1', nodeIds: ['n1'] }).success).toBe(true)
  })

  it('allows review reject with feedback or context', () => {
    expect(
      ReviewDecideInput.safeParse({ reviewId: 'r1', decision: 'reject', feedback: '改一下' })
        .success,
    ).toBe(true)
    expect(
      ReviewDecideInput.safeParse({
        reviewId: 'r1',
        decision: 'reject',
        contextNodeIds: ['n1'],
      }).success,
    ).toBe(true)
    expect(
      ReviewDecideInput.safeParse({ reviewId: 'r1', decision: 'reject' }).success,
    ).toBe(false)
  })

  it('adds task/session fields with defaults', () => {
    const task = Task.parse({
      id: 't1',
      workspaceId: 'w1',
      nodeId: 'a1',
      title: '任务',
      prompt: '做',
      status: 'todo',
      waitingReason: null,
      engine: 'fake',
      workspaceMode: 'main',
      branch: null,
      worktreePath: null,
      verifyCommand: null,
      retryCount: 0,
      dangerouslySkipPermissions: false,
      createdAt: 1,
      updatedAt: 1,
    })
    expect(task.enqueuedAt).toBeNull()
    const session = Session.parse({
      id: 's1',
      taskId: 't1',
      adapter: 'fake',
      engineSessionId: null,
      status: 'running',
      outcome: null,
      startedAt: 1,
      endedAt: null,
    })
    expect(session.costUsd).toBeNull()
    expect(session.turns).toBeNull()
  })

  it('parses transition context and the injected event', () => {
    expect(
      TaskTransitionEvent.safeParse({
        type: 'user_input',
        text: '继续',
        contextInjection: injection,
      }).success,
    ).toBe(true)
    expect(
      TaskTransitionEvent.safeParse({
        type: 'reject',
        reviewId: 'r1',
        feedback: '改',
        contextInjection: injection,
        contextBlock: '<context_update/>',
      }).success,
    ).toBe(true)
    expect(
      ServerMessage.safeParse({
        v: 1,
        ts: 1,
        type: 'context.injected',
        payload: { taskId: 't1', seq: 1, at: 1, source: 'user', nodeIds: ['n1'], chars: 17 },
      }).success,
    ).toBe(true)
    expect(SESSION_USAGE_EVENT).toBe('baton.session.usage')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @baton/protocol exec vitest run test/context-injection.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

`packages/protocol/src/context.ts`：顶部 import 补 `Timestamp`；在 `ContextSnapshot` 前加：

```ts
export const ContextInjection = z.object({
  seq: z.number().int().positive(),
  at: Timestamp,
  source: z.enum(['user', 'supervisor']),
  note: z.string().max(2000).nullable(),
  nodeIds: z.array(Id).min(1),
  included: z.array(ContextNodeRef),
  dropped: z.array(ContextDropped),
  truncated: z.boolean(),
  relations: z.array(ContextRelation),
  relationsTruncated: z.boolean(),
  chars: z.number().int().nonnegative(),
})
export type ContextInjection = z.infer<typeof ContextInjection>
```

`ContextSnapshot` 加：

```ts
injections: z.array(ContextInjection).default([]),
```

`packages/protocol/src/commands.ts`：

```ts
export const ContextInjectInput = z.object({
  taskId: Id,
  nodeIds: z.array(Id).min(1).max(40),
  note: z.string().max(2000).optional(),
})
export type ContextInjectInput = z.infer<typeof ContextInjectInput>
```

`ReviewDecideInput` 改为：

```ts
export const ReviewDecideInput = z
  .discriminatedUnion('decision', [
    z
      .object({
        reviewId: Id,
        decision: z.literal('approve'),
        reason: z.string().max(2000).optional(),
      })
      .strict(),
    z
      .object({
        reviewId: Id,
        decision: z.literal('reject'),
        feedback: z.string().max(16_384).optional(),
        contextNodeIds: z.array(Id).min(1).max(40).optional(),
        contextNote: z.string().max(2000).optional(),
      })
      .strict(),
  ])
  .refine(
    (value) =>
      value.decision !== 'reject' ||
      Boolean(value.feedback?.trim()) ||
      (value.contextNodeIds?.length ?? 0) > 0,
    { message: 'feedback or contextNodeIds is required' },
  )
```

`ClientMessage` 加：

```ts
CommandBase.extend({ type: z.literal('context.inject'), payload: ContextInjectInput }),
```

`packages/protocol/src/entities/task.ts` 加：

```ts
enqueuedAt: Timestamp.nullable().default(null),
```

`packages/protocol/src/entities/session.ts` 加：

```ts
costUsd: z.number().nonnegative().nullable().default(null),
turns: z.number().int().nonnegative().nullable().default(null),
```

`packages/protocol/src/transitions.ts` 顶部 import `ContextInjection`，并给 `user_input` / `reject` 加：

```ts
// user_input：text 上限 64_000
contextInjection: ContextInjection.optional(),
// reject：
contextInjection: ContextInjection.optional(),
contextBlock: z.string().max(64_000).optional(),
```

`packages/protocol/src/events.ts` 加：

```ts
export const SESSION_USAGE_EVENT = 'baton.session.usage'
export const SessionUsageValue = z.object({
  costUsd: z.number().nonnegative().optional(),
  turns: z.number().int().nonnegative().optional(),
})
export type SessionUsageValue = z.infer<typeof SessionUsageValue>

export const ContextInjectedEvent = ReplayableBase.extend({
  type: z.literal('context.injected'),
  payload: z.object({
    taskId: Id,
    seq: z.number().int().positive(),
    at: Timestamp,
    source: z.enum(['user', 'supervisor']),
    nodeIds: z.array(Id).min(1),
    chars: z.number().int().nonnegative(),
  }),
})
export type ContextInjectedEvent = z.infer<typeof ContextInjectedEvent>
```

并把 `ContextInjectedEvent` 加进 `ServerMessage`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @baton/protocol exec vitest run test/context-injection.test.ts`
Expected: PASS。再跑 `pnpm --filter @baton/protocol exec vitest run` 确认旧测试不回归。

- [ ] **Step 5: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): 上下文注入与 usage 字段"
```

---

### Task 2: Core context injection

Blocking: Task 1
Slice type: refactor
Seam: `packages/core/test/context-inject.test.ts`

**Files:**
- Create: `packages/core/src/context/inject.ts`
- Create: `packages/core/test/context-inject.test.ts`
- Modify: `packages/core/src/context/assemble.ts`
- Modify: `packages/core/src/context/index.ts`

**Interfaces:**
- Consumes: `ContextInjection`、`Node`、`Edge`、`AssembleContextInput`。
- Produces: `canInjectContext`、`assembleContextInjection`、`buildContextUpdateBlock`、`cumulativeInjectedChars`。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@baton/protocol'
import {
  assembleContextInjection,
  buildContextUpdateBlock,
  canInjectContext,
  cumulativeInjectedChars,
} from '../src/index.js'

function text(id: string, content: string, x = 0, y = 0): Node {
  return {
    id,
    canvasId: 'c1',
    type: 'text',
    x,
    y,
    w: 200,
    h: 100,
    groupId: null,
    data: { content },
    createdAt: 1,
    updatedAt: 1,
  }
}

const edge = (sourceId: string, targetId: string): Edge => ({
  id: `${sourceId}-${targetId}`,
  canvasId: 'c1',
  sourceId,
  targetId,
  type: 'context',
})

describe('context injection', () => {
  it('allows only safe task states', () => {
    expect(canInjectContext({ status: 'todo', waitingReason: null }).ok).toBe(true)
    expect(canInjectContext({ status: 'queued', waitingReason: null }).ok).toBe(true)
    expect(canInjectContext({ status: 'waiting_input', waitingReason: 'question' }).ok).toBe(true)
    expect(canInjectContext({ status: 'waiting_input', waitingReason: 'approval' }).ok).toBe(false)
    expect(canInjectContext({ status: 'review', waitingReason: null }).ok).toBe(false)
    expect(canInjectContext({ status: 'running', waitingReason: null }).ok).toBe(false)
  })

  it('selects nodes, direct edges and upstream depth 2', () => {
    const nodes = [text('a', '上游'), text('b', '中间'), text('c', '选中')]
    const edges = [edge('a', 'b'), edge('b', 'c')]
    const result = assembleContextInjection({
      selectedNodeIds: ['c'],
      nodes,
      edges,
      contentByNodeId: {},
    })
    expect(result.included.map((item) => item.id)).toEqual(['c', 'b', 'a'])
    expect(result.included.map((item) => item.depth)).toEqual([0, 1, 2])
  })

  it('drops sensitive files and counts chars without wrapper tags', () => {
    const nodes = [
      text('a', '内容'),
      {
        ...text('f', ''),
        type: 'file' as const,
        data: { path: 'secrets/.env', name: '.env', mime: 'text/plain' },
      },
    ]
    const result = assembleContextInjection({
      selectedNodeIds: ['a', 'f'],
      nodes,
      edges: [],
      contentByNodeId: {},
    })
    expect(result.included.map((item) => item.id)).toEqual(['a'])
    expect(result.dropped).toContainEqual(expect.objectContaining({ id: 'f', reason: 'sensitive' }))
    const block = buildContextUpdateBlock({
      seq: 1,
      at: 1,
      source: 'user',
      note: '补充',
      assembled: result,
    })
    expect(block).toContain('<context_update seq="1" at="1" source="user">')
    expect(block).toContain('<note>补充</note>')
    // assembleContextInjection 只返回节点内容；note 由 service 计入最终 chars。
    expect(result.chars).toBe(2)
  })

  it('computes cumulative injected chars', () => {
    expect(
      cumulativeInjectedChars({
        included: [],
        dropped: [],
        truncated: false,
        redactedPaths: [],
        relations: [],
        relationsTruncated: false,
        injections: [
          {
            seq: 1,
            at: 1,
            source: 'user',
            note: null,
            nodeIds: ['a'],
            included: [],
            dropped: [],
            truncated: false,
            relations: [],
            relationsTruncated: false,
            chars: 10,
          },
        ],
      }),
    ).toBe(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @baton/core exec vitest run test/context-inject.test.ts`
Expected: FAIL — exports missing。

- [ ] **Step 3: Refactor `assemble.ts`**

把 `packages/core/src/context/assemble.ts:116-398` 的函数体原样移到新的内部函数：

```ts
export interface AssemblePayload {
  body: string
  included: ContextNodeRef[]
  dropped: ContextDropped[]
  truncated: boolean
  redactedPaths: string[]
  relations: ContextRelation[]
  relationsTruncated: boolean
  relationLines: string[]
  /** 原逻辑里的 truncatedIds；包装器用它生成 <truncated>，保持旧输出逐字节一致。 */
  truncatedIds: string[]
}

export function assemblePayload(input: AssembleContextInput): AssemblePayload {
  // 原 assembleContext 的 116-373 行原样搬入；最后返回 body、included、dropped、truncated、
  // redactedPaths、relations、relationsTruncated、relationLines、truncatedIds，而不是 prompt。
  // 注意保留原 truncatedIds 集合与 relationLines 的排序。
  return {
    body,
    included,
    dropped: droppedList,
    truncated,
    redactedPaths,
    relations: renderedRelations,
    relationsTruncated,
    relationLines,
    truncatedIds: [...truncatedIds].sort(),
  }
}
```

`assembleContext` 改为包装器，输出必须与重构前逐字节一致：

```ts
export function assembleContext(input: AssembleContextInput): AssembleContextResult {
  const payload = assemblePayload(input)
  const parts = [
    `<task>${input.taskPrompt}</task>`,
    `<context>${payload.body.length > 0 ? `\n${payload.body}\n` : ''}</context>`,
  ]
  if (payload.relationLines.length > 0) {
    const attr = payload.relationsTruncated ? ' truncated="true"' : ''
    parts.push(`<relations${attr}>\n${payload.relationLines.join('\n')}\n</relations>`)
  }
  if (payload.truncatedIds.length > 0) {
    parts.push(`<truncated nodes="${escapeAttr(payload.truncatedIds.join(','))}"/>`)
  }
  return {
    prompt: parts.join('\n'),
    included: payload.included,
    dropped: payload.dropped,
    truncated: payload.truncated,
    redactedPaths: payload.redactedPaths,
    relations: payload.relations,
    relationsTruncated: payload.relationsTruncated,
  }
}
```

- [ ] **Step 4: Add `inject.ts`**

```ts
import type { ContextSnapshot, WaitingReason } from '@baton/protocol'
import { canAcceptUserInput } from '../state-machine/attention.js'
import { assemblePayload, type AssemblePayload } from './assemble.js'
import type { AssembleContextInput } from './types.js'

export interface CanInjectResult {
  ok: boolean
  reason?: 'approval_pending' | 'use_review_reject' | 'running' | 'terminal'
}

export function canInjectContext(task: {
  status: string
  waitingReason: WaitingReason | null
}): CanInjectResult {
  if (task.status === 'todo' || task.status === 'queued') return { ok: true }
  if (task.status === 'waiting_input') {
    return canAcceptUserInput(task.waitingReason)
      ? { ok: true }
      : { ok: false, reason: 'approval_pending' }
  }
  if (task.status === 'review') return { ok: false, reason: 'use_review_reject' }
  if (task.status === 'running' || task.status === 'verifying') return { ok: false, reason: 'running' }
  return { ok: false, reason: 'terminal' }
}

export interface InjectionPayload extends AssemblePayload {
  /** 只把 included/dropped/truncated/redactedPaths/relations/relationsTruncated/chars
   * 写进 ContextInjection；不要把整个 payload spread 进 context_json。 */
  chars: number
}

export function assembleContextInjection(
  input: Omit<AssembleContextInput, 'taskPrompt' | 'targetNodeId'>,
): InjectionPayload {
  const payload = assemblePayload({
    ...input,
    taskPrompt: '',
    // 显式注入只从选中节点向上游闭包；不自动展开目标 Agent 的既有 context 边。
    targetNodeId: '',
  })
  const chars = payload.included.reduce((sum, item) => sum + item.chars, 0)
  return { ...payload, chars }
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function contextUpdateChars(assembled: InjectionPayload, note: string): number {
  return assembled.chars + escapeText(note).length
}

export function buildContextUpdateBlock(input: {
  seq: number
  at: number
  source: 'user' | 'supervisor'
  note: string
  assembled: InjectionPayload
}): string {
  const lines = [
    `<context_update seq="${input.seq}" at="${input.at}" source="${input.source}">`,
  ]
  if (input.note.length > 0) lines.push(`<note>${escapeText(input.note)}</note>`)
  if (input.assembled.body.length > 0) lines.push(input.assembled.body)
  if (input.assembled.truncatedIds.length > 0) {
    lines.push(`<truncated nodes="${escapeAttr(input.assembled.truncatedIds.join(','))}"/>`)
  }
  if (input.assembled.relationLines.length > 0) {
    const attr = input.assembled.relationsTruncated ? ' truncated="true"' : ''
    lines.push(`<relations${attr}>\n${input.assembled.relationLines.join('\n')}\n</relations>`)
  }
  lines.push('</context_update>')
  return lines.join('\n')
}

export function cumulativeInjectedChars(snapshot: ContextSnapshot | null): number {
  return snapshot?.injections?.reduce((sum, item) => sum + item.chars, 0) ?? 0
}
```

`packages/core/src/context/index.ts` 加 `export * from './inject.js'`。

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @baton/core exec vitest run test/context-inject.test.ts test/context.test.ts`
Expected: PASS；`context.test.ts` 的快照逐字节不变。

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): 上下文注入纯函数"
```

---

### Task 3: Core transition effect

Blocking: Task 1, Task 2
Slice type: tracer-bullet
Seam: `packages/core/test/transition-injection.test.ts`

**Files:**
- Create: `packages/core/test/transition-injection.test.ts`
- Modify: `packages/core/src/state-machine/types.ts`
- Modify: `packages/core/src/state-machine/effects.ts`
- Modify: `packages/core/src/state-machine/transition.ts`

**Interfaces:**
- Consumes: `ContextInjection`。
- Produces: `TaskEffect.appendContextInjection`。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import type { ContextInjection } from '@baton/protocol'
import { effects } from '../src/state-machine/effects.js'
import { transition } from '../src/state-machine/transition.js'

const injection: ContextInjection = {
  seq: 1,
  at: 1,
  source: 'user',
  note: '补充',
  nodeIds: ['n1'],
  included: [],
  dropped: [],
  truncated: false,
  relations: [],
  relationsTruncated: false,
  chars: 2,
}

const base = {
  status: 'waiting_input' as const,
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 3 },
  workspaceTrusted: true,
  killSwitch: false,
  waitingReason: 'question' as const,
}

describe('transition context injection', () => {
  it('adds appendContextInjection to user_input', () => {
    const result = transition(base, { type: 'user_input', text: '继续', contextInjection: injection })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.effects).toContainEqual(effects.appendContextInjection(injection))
      expect(result.effects.some((effect) => effect.type === 'appendUserReply')).toBe(true)
    }
  })

  it('adds appendContextInjection to reject', () => {
    const result = transition(
      { ...base, status: 'review', waitingReason: null },
      {
        type: 'reject',
        reviewId: 'r1',
        feedback: '改',
        contextInjection: injection,
        contextBlock: '<context_update/>',
      },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.effects).toContainEqual(
        effects.appendContextInjection(injection, '<context_update/>'),
      )
    }
  })

  it('does not add the effect without context', () => {
    const result = transition(base, { type: 'user_input', text: '继续' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.effects.some((effect) => effect.type === 'appendContextInjection')).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @baton/core exec vitest run test/transition-injection.test.ts`
Expected: FAIL — effect/field missing。

- [ ] **Step 3: Implement**

`types.ts`：import `ContextInjection`，在 `TaskEffect` 加：

```ts
| { type: 'appendContextInjection'; injection: ContextInjection; block?: string }
```

`effects.ts`：

```ts
appendContextInjection: (injection: ContextInjection, block?: string): TaskEffect => ({
  type: 'appendContextInjection',
  injection,
  ...(block ? { block } : {}),
}),
```

`transition.ts` 的 `user_input`：

```ts
return ok('running', ctx.retryCount, [
  effects.sendToSession(event.text),
  effects.appendUserReply(event.text),
  ...(event.contextInjection ? [effects.appendContextInjection(event.contextInjection)] : []),
])
```

`reject`：

```ts
return ok(
  'queued',
  ctx.retryCount,
  [
    effects.persistReviewVerdict(event.reviewId, 'rejected'),
    effects.appendFeedback(event.feedback),
    ...(event.contextInjection
      ? [effects.appendContextInjection(event.contextInjection, event.contextBlock)]
      : []),
    effects.enqueueTask(),
  ],
  null,
  { reviewId: event.reviewId },
)
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @baton/core exec vitest run test/transition-injection.test.ts test/transition-happy.test.ts test/transition-matrix.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): 注入 effect 接入 user_input/reject"
```

---

### Task 4: Migration 0011 + repositories

Blocking: Task 1
Slice type: tracer-bullet
Seam: `apps/daemon/test/migration-0011.test.ts`

**Files:**
- Create: `apps/daemon/test/migration-0011.test.ts`
- Modify: `apps/daemon/src/db/schema.ts`
- Generate: `apps/daemon/migrations/0011_*.sql` + `migrations/meta/*`
- Modify: `apps/daemon/src/db/repositories.ts`
- Modify: `apps/daemon/test/repositories.test.ts`

**Interfaces:**
- Produces: `appendTaskContextInjection`、`listQueuedTasksByEnqueuedAt`、`updateSessionUsage`、`setTaskEnqueuedAt`、`clearTaskEnqueuedAt`。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateDb, openDb } from '../src/db/index.js'
import {
  appendTaskContextInjection,
  getTaskDetail,
  insertTask,
  listQueuedTasksByEnqueuedAt,
  updateSessionUsage,
  insertSession,
} from '../src/db/repositories.js'

describe('migration 0011', () => {
  it('adds enqueued_at and session usage columns', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'baton-m6-2-')), 'db.sqlite'))
    migrateDb(db)
    const columns = (table: string) =>
      (db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).map(
        (row) => row.name,
      )
    expect(columns('task')).toContain('enqueued_at')
    expect(columns('session')).toEqual(expect.arrayContaining(['cost_usd', 'turns']))
  })

  it('appends injection and preserves initial snapshot', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'baton-m6-2-')), 'db.sqlite'))
    migrateDb(db)
    insertTask(
      db,
      {
        id: 't1',
        workspaceId: 'w1',
        nodeId: null,
        title: '任务',
        prompt: '<task>x</task>',
        status: 'todo',
        waitingReason: null,
        engine: 'fake',
        workspaceMode: 'main',
        branch: null,
        worktreePath: null,
        verifyCommand: null,
        retryCount: 0,
        dangerouslySkipPermissions: false,
        createdAt: 1,
        updatedAt: 1,
      },
      JSON.stringify({
        included: [{ id: 'old', type: 'text', title: '旧', depth: 0, chars: 1 }],
        dropped: [],
        truncated: false,
        redactedPaths: [],
        relations: [],
        relationsTruncated: false,
      }),
    )
    db.transaction((tx) =>
      appendTaskContextInjection(tx, 't1', {
        seq: 1,
        at: 2,
        source: 'user',
        note: null,
        nodeIds: ['n1'],
        included: [],
        dropped: [],
        truncated: false,
        relations: [],
        relationsTruncated: false,
        chars: 1,
      }),
    )
    const detail = getTaskDetail(db, 't1')
    expect(detail?.task.context?.included.map((item) => item.id)).toEqual(['old'])
    expect(detail?.task.context?.injections.map((item) => item.seq)).toEqual([1])
  })

  it('orders queued tasks by enqueued_at', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'baton-m6-2-')), 'db.sqlite'))
    migrateDb(db)
    const task = (id: string, enqueuedAt: number) => ({
      id,
      workspaceId: 'w1',
      nodeId: null,
      title: id,
      prompt: '',
      status: 'queued' as const,
      waitingReason: null,
      engine: 'fake' as const,
      workspaceMode: 'main' as const,
      branch: null,
      worktreePath: null,
      verifyCommand: null,
      retryCount: 0,
      dangerouslySkipPermissions: false,
      createdAt: 1,
      updatedAt: 100,
      enqueuedAt,
    })
    insertTask(db, task('t2', 20))
    insertTask(db, task('t1', 10))
    expect(listQueuedTasksByEnqueuedAt(db).map((item) => item.id)).toEqual(['t1', 't2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/migration-0011.test.ts`
Expected: FAIL — columns/functions missing。

- [ ] **Step 3: Schema + migration**

`apps/daemon/src/db/schema.ts`：

```ts
// task
enqueuedAt: integer('enqueued_at'),
// session
costUsd: real('cost_usd'),
turns: integer('turns'),
```

生成迁移：

```bash
pnpm --filter @evanfang0054/baton exec drizzle-kit generate --name m6_2_context_injection
```

打开生成的 `apps/daemon/migrations/0011_m6_2_context_injection.sql`，在三条 `ALTER TABLE` 后追加：

```sql
UPDATE `task` SET `enqueued_at` = `updated_at` WHERE `status` = 'queued';
```

确认 `migrations/meta/_journal.json` 追加了 idx 11、`migrations/meta/0011_snapshot.json` 存在。

- [ ] **Step 4: Repository functions**

`repositories.ts` 加（顶部 `drizzle-orm` import 补 `sql`）：

```ts
export function appendTaskContextInjection(
  tx: Tx,
  taskId: string,
  injection: ContextInjection,
): void {
  const row = tx.select({ contextJson: task.contextJson }).from(task).where(eq(task.id, taskId)).get()
  if (!row) return
  const current = row.contextJson
    ? ContextSnapshot.safeParse(JSON.parse(row.contextJson) as unknown)
    : null
  const snapshot = current?.success
    ? current.data
    : {
        included: [],
        dropped: [],
        truncated: false,
        redactedPaths: [],
        relations: [],
        relationsTruncated: false,
        injections: [],
      }
  tx.update(task)
    .set({
      contextJson: JSON.stringify({
        ...snapshot,
        injections: [...snapshot.injections, injection],
      }),
    })
    .where(eq(task.id, taskId))
    .run()
}

export function listQueuedTasksByEnqueuedAt(db: Db): Task[] {
  return db
    .select()
    .from(task)
    .where(eq(task.status, 'queued'))
    .orderBy(sql`coalesce(${task.enqueuedAt}, ${task.updatedAt})`, asc(task.id))
    .all()
    .map(toTask)
}

export function updateSessionUsage(
  tx: Tx,
  sessionId: string,
  usage: { costUsd?: number; turns?: number },
): void {
  tx.update(session)
    .set({
      ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
      ...(usage.turns !== undefined ? { turns: usage.turns } : {}),
    })
    .where(eq(session.id, sessionId))
    .run()
}

export function setTaskEnqueuedAt(tx: Tx, taskId: string, at: number): void {
  tx.update(task).set({ enqueuedAt: at }).where(eq(task.id, taskId)).run()
}

export function clearTaskEnqueuedAt(tx: Tx, taskId: string): void {
  tx.update(task).set({ enqueuedAt: null }).where(eq(task.id, taskId)).run()
}
```

同时：

- `insertTask` 的签名放宽为 `Omit<Task, 'enqueuedAt'> & { enqueuedAt?: number | null }`，values 加 `enqueuedAt: input.enqueuedAt ?? null`；这样现有 task-service/handoff/supervisor 调用不用逐个补字段。
- `toTask` 加 `enqueuedAt: row.enqueuedAt ?? null`。
- `toSession` 加 `costUsd: row.costUsd ?? null`、`turns: row.turns ?? null`。
- `insertSession` 的签名放宽为 `Omit<Session, 'costUsd' | 'turns'> & { costUsd?: number | null; turns?: number | null }`，values 加 `costUsd: input.costUsd ?? null`、`turns: input.turns ?? null`。
- 新增 `appendTaskPromptRaw`：`context_update` 已经带外层标签，不能再被 `appendTaskPromptBlock` 包一层。

```ts
export function appendTaskPromptRaw(
  tx: Tx,
  id: string,
  text: string,
  maxChars: number,
  updatedAt: number,
): void {
  const row = tx.select({ prompt: task.prompt }).from(task).where(eq(task.id, id)).get()
  if (!row) return
  const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text
  tx.update(task)
    .set({ prompt: `${row.prompt}\n\n${clipped}`, updatedAt })
    .where(eq(task.id, id))
    .run()
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/migration-0011.test.ts test/migrate.test.ts test/repositories.test.ts`
Expected: PASS；如果 `migrate.test.ts` 断言表数量/索引，确保只加列、不加表。

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/db apps/daemon/migrations apps/daemon/test
git commit -m "feat(daemon): migration 0011 与注入仓储"
```

---

### Task 5: Task scene includes injections

Blocking: Task 1
Slice type: tracer-bullet
Seam: `packages/core/test/scene.test.ts`

**Files:**
- Modify: `packages/core/src/canvas/scene.ts`
- Modify: `packages/core/test/scene.test.ts`

**Interfaces:**
- Consumes: `TaskDetail.context.injections`。
- Produces: `relatedNodeIdSet` / `buildTaskScene` 包含注入节点与缺失节点。

- [ ] **Step 1: Write the failing test**

在 `packages/core/test/scene.test.ts` 加：

```ts
it('includes injection node ids and reports missing ones', () => {
  const injected = {
    ...task,
    context: {
      ...task.context,
      injections: [
        {
          seq: 1,
          at: 1,
          source: 'user' as const,
          note: null,
          nodeIds: ['n2', 'gone'],
          included: [],
          dropped: [],
          truncated: false,
          relations: [],
          relationsTruncated: false,
          chars: 1,
        },
      ],
    },
  } satisfies TaskDetail
  const scene = buildTaskScene(injected, [{ ...text, id: 'n2' }], [])
  expect(scene.relatedNodeIds).toContain('n2')
  expect(scene.missingNodeIds).toContain('gone')
})
```

复用现有 `task` / `text` fixture；先给 `task` fixture 补 `enqueuedAt: null`（`TaskDetail` 新字段），不要新建第二套 fixture。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @baton/core exec vitest run test/scene.test.ts`
Expected: FAIL — injection IDs 不在 related。

- [ ] **Step 3: Implement**

`packages/core/src/canvas/scene.ts` 的 `relatedNodeIdSet`：

```ts
export function relatedNodeIdSet(task: TaskDetail): Set<string> {
  const related = new Set<string>()
  if (task.nodeId) related.add(task.nodeId)
  for (const ref of task.context?.included ?? []) related.add(ref.id)
  for (const id of task.origin?.contextNodeIds ?? []) related.add(id)
  for (const injection of task.context?.injections ?? []) {
    for (const id of injection.nodeIds) related.add(id)
  }
  return related
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @baton/core exec vitest run test/scene.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): 任务现场纳入注入节点"
```

---

### Task 6: Fixture sweep for new required fields

Blocking: Task 1-5
Slice type: refactor
Seam: `pnpm typecheck`

**Files (至少这些；以 `pnpm typecheck` 报错为准):**
- Modify: `apps/web/e2e/m6-helpers.ts`
- Modify: `apps/web/e2e/*.spec.ts`（任务/context/session fixture）
- Modify: `apps/web/src/features/tasks/*.test.tsx`
- Modify: `apps/web/src/features/canvas/*.test.tsx`
- Modify: `apps/web/src/features/realtime/*.test.tsx`
- Modify: `apps/daemon/test/helpers/db.ts`
- Modify: `packages/protocol/test/context.test.ts`
- Modify: `packages/protocol/test/api.test.ts`
- Modify: `packages/core/test/scene.test.ts`

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: FAIL，列出缺少 `enqueuedAt` / `injections` / `costUsd` / `turns` 的 fixture。

- [ ] **Step 2: 机械补齐**

- `TaskSummary` / `TaskDetail.task` fixture 加 `enqueuedAt: null`。
- `ContextSnapshot` fixture 加 `injections: []`（或在需要注入的测试里给数组）。
- `Session` fixture 加 `costUsd: null`、`turns: null`。
- 如果 `TaskDetailResponse` fixture 的 `task.context` 是 `null`，不需要改。
- 不改变任何断言；只补字段。

- [ ] **Step 3: Run typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: protocol/core/web fixture 错误清零；daemon 仍会有 `appendContextInjection`/`context.inject`/`feedback`/usage 的预期错误，由 Plan 2 Task 2-4 接上。若只想验证本 Plan，跑 `pnpm --filter @baton/protocol typecheck && pnpm --filter @baton/core typecheck && pnpm --filter @baton/web typecheck`。

- [ ] **Step 4: Commit**

```bash
git add apps packages
git commit -m "test: 补齐 M6-2 新字段 fixture"
```

---

## 验收

- `pnpm --filter @baton/protocol exec vitest run`
- `pnpm --filter @baton/core exec vitest run`
- `pnpm --filter @evanfang0054/baton exec vitest run test/migration-0011.test.ts test/migrate.test.ts test/repositories.test.ts`
- `pnpm --filter @baton/protocol typecheck && pnpm --filter @baton/core typecheck && pnpm --filter @baton/web typecheck`
- 根 `pnpm typecheck` 在 daemon Plan 2 Task 2-4 接上 `appendContextInjection`/`context.inject`/feedback/usage 后转绿；本 Plan 不把 daemon 的预期红当成功能失败。
- 不新增表；`assembleContext` 旧快照逐字节不变。
