---
spec_ref: ../specs/2026-11-17-m1-protocol-state-machine-design.md
spec_topic: m1-protocol-state-machine
task_count: 8
estimated_phases: [tests, implementation, verification]
dod: "docs/contracts/M1-protocol-state-machine.contract.md 的 25 条全部由命令或测试判定"
depends_on: []
gdd: skipped
---

# M1-1/M1-2 协议领域模型与状态机实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-harness:subagent-driven-development` (recommended) or `agent-harness:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 M1 的协议领域契约与纯函数任务状态机，让后续 daemon/web/adapter 共享同一套类型、事件和转移规则。

**Architecture:** `packages/protocol` 用 zod 定义实体、枚举、状态转移事件、WS 命令/事件与 policy；`packages/core` 只依赖 protocol，提供 `transition(ctx, event) => { status, retryCount, effects }` 的纯函数。daemon 在 M1-5 解释 effects，本 slice 不产生 IO。

**Tech Stack:** TypeScript strict、zod 4、`@ag-ui/core` 1.0.4、vitest 5、`@vitest/coverage-v8`。

**计划位置说明**：本仓库 plan 落 `docs/plans/`，不使用 `docs/agent-harness/plans/`。`scripts/validate-handoff.sh` 不存在，落盘后用 frontmatter、任务数、占位符扫描替代。

**Commit 策略**：按 M0 先例，每个任务结束提交一次（Conventional Commits）。若要手动统一提交，执行时告知即可。

---

## 文件结构

```
packages/protocol/
├── package.json                         # 增加 @ag-ui/core
├── src/
│   ├── common.ts                        # Id / Timestamp / DiffStat / Viewport
│   ├── enums.ts                         # TaskStatus / NodeType / ...
│   ├── errors.ts                        # AppError
│   ├── policy.ts                        # PolicySchema
│   ├── agui.ts                          # @ag-ui/core re-export
│   ├── commands.ts                      # ClientMessage + 6 个命令输入
│   ├── events.ts                        # ServerMessage + 6 个服务端事件
│   ├── transitions.ts                   # TaskTransitionEvent
│   ├── entities/
│   │   ├── workspace.ts
│   │   ├── canvas.ts
│   │   ├── node.ts
│   │   ├── edge.ts
│   │   ├── task.ts
│   │   ├── session.ts
│   │   ├── event.ts
│   │   ├── approval.ts
│   │   ├── review.ts
│   │   ├── audit.ts
│   │   ├── notice.ts
│   │   └── index.ts
│   └── index.ts                         # 统一导出
└── test/
    ├── foundation.test.ts
    ├── entities-core.test.ts
    ├── entities-events.test.ts
    ├── transitions.test.ts
    ├── commands.test.ts
    ├── events.test.ts
    ├── agui.test.ts
    └── exports.test.ts

packages/core/
├── package.json                         # deps: @baton/protocol; devDeps: vitest + coverage
├── vitest.config.ts                     # coverage thresholds 80
├── src/
│   ├── index.ts
│   └── state-machine/
│       ├── types.ts
│       ├── effects.ts
│       ├── transition.ts
│       └── index.ts
└── test/
    ├── transition-happy.test.ts
    ├── transition-matrix.test.ts
    ├── guards.test.ts
    ├── terminal.test.ts
    └── effects.test.ts
```

依赖关系：Task 1 → Task 2 → Task 3；Task 4、Task 5 依赖 Task 3；Task 6 依赖 Task 3（`TaskTransitionEvent`、`DiffStat`、`AppError`）；Task 7 依赖 Task 6；Task 8 依赖全部。Task 4/5 与 Task 6 可在 Task 3 后并行，本计划按顺序执行。

---

## Task 1: Protocol 基础类型、枚举、错误与 Policy

Blocking: none
Slice type: tracer-bullet
Seam: `packages/protocol/test/foundation.test.ts`

**Files:**
- Create: `packages/protocol/src/common.ts`
- Create: `packages/protocol/src/enums.ts`
- Create: `packages/protocol/src/errors.ts`
- Create: `packages/protocol/src/policy.ts`
- Create: `packages/protocol/test/foundation.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes: `zod`
- Produces: `Id`, `Timestamp`, `DiffStat`, `Viewport`, `TaskStatus`, `NodeType`, `EdgeType`, `SessionStatus`, `ApprovalDecision`, `ReviewVerdict`, `Engine`, `WorkspaceMode`, `AppError`, `PolicySchema`, `Policy`

- [ ] **Step 1: 写失败测试**

```ts
// packages/protocol/test/foundation.test.ts
import { describe, expect, it } from 'vitest'
import { DiffStat, Id, Timestamp } from '../src/common.js'
import { TaskStatus } from '../src/enums.js'
import { AppError } from '../src/errors.js'
import { PolicySchema } from '../src/policy.js'

describe('protocol foundation', () => {
  it('validates ids and timestamps', () => {
    expect(Id.parse('n_1')).toBe('n_1')
    expect(() => Id.parse('')).toThrow()
    expect(Timestamp.parse(0)).toBe(0)
    expect(() => Timestamp.parse(-1)).toThrow()
  })

  it('validates task status', () => {
    expect(TaskStatus.parse('running')).toBe('running')
    expect(() => TaskStatus.parse('paused')).toThrow()
  })

  it('validates diff stat', () => {
    expect(DiffStat.parse({ filesChanged: 1, insertions: 2, deletions: 3 })).toEqual({
      filesChanged: 1,
      insertions: 2,
      deletions: 3,
    })
  })

  it('validates app error', () => {
    expect(AppError.parse({ code: 'x', message: 'y' }).code).toBe('x')
    expect(() => AppError.parse({ code: 'x' })).toThrow()
  })

  it('applies policy defaults', () => {
    const p = PolicySchema.parse({})
    expect(p.verify.timeoutSec).toBe(900)
    expect(p.verify.maxOutputBytes).toBe(262144)
    expect(p.approval.default).toBe('ask')
    expect(p.approval.autoApproveMaxRisk).toBe('low')
    expect(p.autopilot.enabled).toBe(false)
    expect(p.autopilot.retryMax).toBe(2)
    expect(p.autopilot.digestCron).toBe('0 9,21 * * *')
  })

  it('rejects invalid policy values', () => {
    expect(() => PolicySchema.parse({ approval: { autoApproveMaxRisk: 'extreme' } })).toThrow()
    expect(() => PolicySchema.parse({ autopilot: { retryMax: -1 } })).toThrow()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/protocol test -- foundation`
Expected: FAIL，提示 `Cannot find module '../src/common.js'`

- [ ] **Step 3: 写最小实现**

```ts
// packages/protocol/src/common.ts
import { z } from 'zod'

export const Id = z.string().min(1)
export type Id = z.infer<typeof Id>

export const Timestamp = z.number().int().nonnegative()
export type Timestamp = z.infer<typeof Timestamp>

export const DiffStat = z.object({
  filesChanged: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
})
export type DiffStat = z.infer<typeof DiffStat>

export const Viewport = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
})
export type Viewport = z.infer<typeof Viewport>
```

```ts
// packages/protocol/src/enums.ts
import { z } from 'zod'

export const TaskStatus = z.enum([
  'todo',
  'queued',
  'running',
  'waiting_input',
  'verifying',
  'review',
  'done',
  'failed',
  'cancelled',
])
export type TaskStatus = z.infer<typeof TaskStatus>

export const NodeType = z.enum(['text', 'image', 'file', 'agent', 'review', 'group'])
export type NodeType = z.infer<typeof NodeType>

export const EdgeType = z.literal('context')
export type EdgeType = z.infer<typeof EdgeType>

export const SessionStatus = z.enum(['running', 'waiting_input', 'ended', 'failed'])
export type SessionStatus = z.infer<typeof SessionStatus>

export const ApprovalDecision = z.enum(['allow', 'deny'])
export type ApprovalDecision = z.infer<typeof ApprovalDecision>

/** 审批风险级别；policy 阈值与 ApprovalRequest 共用同一枚举，避免两侧漂移。 */
export const RiskLevel = z.enum(['low', 'medium', 'high'])
export type RiskLevel = z.infer<typeof RiskLevel>

/** 人工验收结论；机器结果看 Review.verifyExitCode，不要混用。 */
export const ReviewVerdict = z.enum(['approved', 'rejected'])
export type ReviewVerdict = z.infer<typeof ReviewVerdict>

export const Engine = z.enum(['claude-sdk', 'pty', 'fake'])
export type Engine = z.infer<typeof Engine>

export const WorkspaceMode = z.enum(['main', 'worktree'])
export type WorkspaceMode = z.infer<typeof WorkspaceMode>
```

```ts
// packages/protocol/src/errors.ts
import { z } from 'zod'

export const AppError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
})
export type AppError = z.infer<typeof AppError>
```

```ts
// packages/protocol/src/policy.ts
import { z } from 'zod'
import { RiskLevel } from './enums.js'

const DEFAULT_ALLOW = [
  'Read',
  'Grep',
  'Glob',
  'Edit:src/**',
  'Edit:tests/**',
  'Bash:pnpm (test|lint|typecheck|build|install --frozen-lockfile)',
]

const DEFAULT_DENY = [
  'Bash:sudo *',
  'Bash:rm -rf *',
  'Bash:curl * | sh',
  'Bash:git push *',
  'Edit:**/.env*',
  'Edit:.git/**',
]

const VerifyPolicy = z.object({
  command: z.string().min(1).optional(),
  timeoutSec: z.number().int().positive().default(900),
  maxOutputBytes: z.number().int().positive().default(262144),
})

const ApprovalPolicy = z.object({
  default: z.literal('ask').default('ask'),
  allow: z.array(z.string().min(1)).default(DEFAULT_ALLOW),
  deny: z.array(z.string().min(1)).default(DEFAULT_DENY),
  autoApproveMaxRisk: RiskLevel.default('low'),
})

const AutopilotPolicy = z.object({
  enabled: z.boolean().default(false),
  retryMax: z.number().int().nonnegative().default(2),
  digestCron: z.string().min(1).default('0 9,21 * * *'),
})

export const PolicySchema = z.object({
  // 用函数默认值，避免多个 parse 共享同一份数组/对象默认值。
  verify: VerifyPolicy.default(() => VerifyPolicy.parse({})),
  approval: ApprovalPolicy.default(() => ApprovalPolicy.parse({})),
  autopilot: AutopilotPolicy.default(() => AutopilotPolicy.parse({})),
})
export type Policy = z.infer<typeof PolicySchema>
```

```ts
// packages/protocol/src/index.ts
export * from './common.js'
export * from './enums.js'
export * from './errors.js'
export * from './policy.js'
export * from './config.js'
export * from './health.js'
export * from './ws.js'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/protocol test -- foundation`
Expected: PASS（6 tests）

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src packages/protocol/test/foundation.test.ts
git commit -m "feat(protocol): 增加领域基础类型、枚举、错误与 policy"
```

---

## Task 2: Protocol 核心实体（workspace / canvas / node / edge / task / session）

Blocking: Task 1
Slice type: tracer-bullet
Seam: `packages/protocol/test/entities-core.test.ts`

**Files:**
- Create: `packages/protocol/src/entities/workspace.ts`
- Create: `packages/protocol/src/entities/canvas.ts`
- Create: `packages/protocol/src/entities/node.ts`
- Create: `packages/protocol/src/entities/edge.ts`
- Create: `packages/protocol/src/entities/task.ts`
- Create: `packages/protocol/src/entities/session.ts`
- Create: `packages/protocol/src/entities/index.ts`
- Create: `packages/protocol/test/entities-core.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `Id`、`Timestamp`、`Engine`、`TaskStatus`、`WorkspaceMode`、`Viewport`
- Produces: `Workspace`、`Canvas`、`Node`（六类联合）、`TextNode`、`ImageNode`、`FileNode`、`AgentNode`、`ReviewNode`、`GroupNode`、`Edge`、`Task`、`Session`

- [ ] **Step 1: 写失败测试**

```ts
// packages/protocol/test/entities-core.test.ts
import { describe, expect, it } from 'vitest'
import { Canvas } from '../src/entities/canvas.js'
import { Edge } from '../src/entities/edge.js'
import { Node } from '../src/entities/node.js'
import { Session } from '../src/entities/session.js'
import { Task } from '../src/entities/task.js'
import { Workspace } from '../src/entities/workspace.js'

const nodeBase = {
  id: 'n1',
  canvasId: 'c1',
  x: 0,
  y: 0,
  groupId: null,
  createdAt: 1,
  updatedAt: 1,
}

describe('core entities', () => {
  it('parses workspace and canvas', () => {
    expect(
      Workspace.parse({ id: 'w1', name: 'demo', relPath: 'demo', createdAt: 1 }).relPath,
    ).toBe('demo')
    expect(
      Canvas.parse({ id: 'c1', workspaceId: 'w1', viewport: { x: 0, y: 0, zoom: 1 } }).id,
    ).toBe('c1')
  })

  it('parses six node types and rejects mismatched data', () => {
    const text = Node.parse({ ...nodeBase, type: 'text', data: { content: 'hi' } })
    expect(text.type).toBe('text')
    const group = Node.parse({ ...nodeBase, type: 'group', data: { label: 'G' } })
    expect(group.type === 'group' && group.data.collapsed).toBe(false)
    expect(() => Node.parse({ ...nodeBase, type: 'text', data: { src: 'x' } })).toThrow()
  })

  it('parses edge, task and session', () => {
    expect(Edge.parse({ id: 'e1', canvasId: 'c1', sourceId: 'n1', targetId: 'n2', type: 'context' })).toBeTruthy()
    expect(
      Task.parse({
        id: 't1',
        workspaceId: 'w1',
        nodeId: 'n1',
        title: 't',
        prompt: 'p',
        status: 'todo',
        engine: 'fake',
        workspaceMode: 'main',
        branch: null,
        worktreePath: null,
        verifyCommand: null,
        retryCount: 0,
        createdAt: 1,
        updatedAt: 1,
      }).status,
    ).toBe('todo')
    expect(
      Session.parse({
        id: 's1',
        taskId: 't1',
        adapter: 'fake',
        engineSessionId: null,
        status: 'running',
        startedAt: 1,
        endedAt: null,
      }).status,
    ).toBe('running')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/protocol test -- entities-core`
Expected: FAIL，提示找不到 `../src/entities/*.js`

- [ ] **Step 3: 写实现**

```ts
// packages/protocol/src/entities/workspace.ts
import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const Workspace = z.object({
  id: Id,
  name: z.string().min(1),
  relPath: z.string().min(1),
  createdAt: Timestamp,
})
export type Workspace = z.infer<typeof Workspace>
```

```ts
// packages/protocol/src/entities/canvas.ts
import { z } from 'zod'
import { Id, Viewport } from '../common.js'

export const Canvas = z.object({
  id: Id,
  workspaceId: Id,
  viewport: Viewport,
})
export type Canvas = z.infer<typeof Canvas>
```

```ts
// packages/protocol/src/entities/node.ts
import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { Engine } from '../enums.js'

const NodeBase = z.object({
  id: Id,
  canvasId: Id,
  x: z.number(),
  y: z.number(),
  w: z.number().positive().default(320),
  h: z.number().positive().default(200),
  groupId: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const TextNode = NodeBase.extend({
  type: z.literal('text'),
  data: z.object({ content: z.string() }),
})

export const ImageNode = NodeBase.extend({
  type: z.literal('image'),
  data: z.object({ src: z.string().min(1), alt: z.string().optional() }),
})

export const FileNode = NodeBase.extend({
  type: z.literal('file'),
  data: z.object({
    path: z.string().min(1),
    name: z.string().min(1),
    mime: z.string().min(1).optional(),
  }),
})

export const AgentNode = NodeBase.extend({
  type: z.literal('agent'),
  data: z.object({
    title: z.string().min(1),
    engine: Engine,
    taskId: Id.nullable(),
  }),
})

export const ReviewNode = NodeBase.extend({
  type: z.literal('review'),
  data: z.object({ taskId: Id }),
})

export const GroupNode = NodeBase.extend({
  type: z.literal('group'),
  data: z.object({
    label: z.string().min(1),
    color: z.string().min(1).optional(),
    collapsed: z.boolean().default(false),
  }),
})

export const Node = z.discriminatedUnion('type', [
  TextNode,
  ImageNode,
  FileNode,
  AgentNode,
  ReviewNode,
  GroupNode,
])
export type Node = z.infer<typeof Node>
```

```ts
// packages/protocol/src/entities/edge.ts
import { z } from 'zod'
import { Id } from '../common.js'
import { EdgeType } from '../enums.js'

export const Edge = z.object({
  id: Id,
  canvasId: Id,
  sourceId: Id,
  targetId: Id,
  type: EdgeType,
})
export type Edge = z.infer<typeof Edge>
```

```ts
// packages/protocol/src/entities/task.ts
import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { Engine, TaskStatus, WorkspaceMode } from '../enums.js'

export const Task = z.object({
  id: Id,
  workspaceId: Id,
  nodeId: Id.nullable(),
  title: z.string().min(1),
  prompt: z.string(),
  status: TaskStatus,
  engine: Engine,
  workspaceMode: WorkspaceMode,
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  verifyCommand: z.string().nullable(),
  retryCount: z.number().int().nonnegative(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Task = z.infer<typeof Task>
```

```ts
// packages/protocol/src/entities/session.ts
import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { Engine, SessionStatus } from '../enums.js'

export const Session = z.object({
  id: Id,
  taskId: Id,
  adapter: Engine,
  engineSessionId: z.string().nullable(),
  status: SessionStatus,
  startedAt: Timestamp,
  endedAt: Timestamp.nullable(),
})
export type Session = z.infer<typeof Session>
```

```ts
// packages/protocol/src/entities/index.ts
export * from './workspace.js'
export * from './canvas.js'
export * from './node.js'
export * from './edge.js'
export * from './task.js'
export * from './session.js'
```

```ts
// packages/protocol/src/index.ts（追加一行）
export * from './entities/index.js'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/protocol test -- entities-core`
Expected: PASS（3 tests）

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src packages/protocol/test/entities-core.test.ts
git commit -m "feat(protocol): 增加 workspace/canvas/node/edge/task/session 实体"
```

---

## Task 3: Protocol 事件、审批、验收、审计、通知与状态转移事件

Blocking: Task 2
Slice type: tracer-bullet
Seam: `packages/protocol/test/entities-events.test.ts` + `packages/protocol/test/transitions.test.ts`

**Files:**
- Create: `packages/protocol/src/entities/event.ts`
- Create: `packages/protocol/src/entities/approval.ts`
- Create: `packages/protocol/src/entities/review.ts`
- Create: `packages/protocol/src/entities/audit.ts`
- Create: `packages/protocol/src/entities/notice.ts`
- Modify: `packages/protocol/src/entities/index.ts`
- Create: `packages/protocol/src/transitions.ts`
- Create: `packages/protocol/test/entities-events.test.ts`
- Create: `packages/protocol/test/transitions.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes: Task 1/2 的 `Id`、`Timestamp`、`DiffStat`、`ApprovalDecision`、`ReviewVerdict`
- Produces: `Event`、`ApprovalRequest`、`Approval`、`Review`、`Audit`、`Notice`、`TaskTransitionEvent`

- [ ] **Step 1: 写失败测试**

```ts
// packages/protocol/test/entities-events.test.ts
import { describe, expect, it } from 'vitest'
import { Approval } from '../src/entities/approval.js'
import { Event } from '../src/entities/event.js'
import { Review } from '../src/entities/review.js'

describe('event/approval/review entities', () => {
  it('requires a global ordinal and a session seq', () => {
    const base = {
      id: 'ev1',
      sessionId: 's1',
      type: 'TEXT_MESSAGE_CONTENT',
      payload: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hi' },
      ts: 1,
    }
    expect(Event.parse({ ...base, ordinal: 10, seq: 1 }).ordinal).toBe(10)
    expect(() => Event.parse({ ...base, seq: 1 })).toThrow()
    expect(() => Event.parse({ ...base, ordinal: -1, seq: 1 })).toThrow()
  })

  it('keeps approval pending with a null decision', () => {
    expect(
      Approval.parse({
        id: 'a1',
        sessionId: 's1',
        request: { toolName: 'Bash', input: { cmd: 'ls' }, risk: 'low' },
        decision: null,
        decidedBy: null,
        decidedAt: null,
      }).decision,
    ).toBeNull()
  })

  it('uses verdict only for the human decision', () => {
    const review = {
      id: 'r1',
      taskId: 't1',
      verifyExitCode: 0,
      verifyOutput: 'ok',
      diffStat: { filesChanged: 1, insertions: 2, deletions: 0 },
      decidedAt: 2,
    }
    expect(Review.parse({ ...review, verdict: 'approved' }).verdict).toBe('approved')
    expect(() => Review.parse({ ...review, verdict: 'passed' })).toThrow()
  })
})
```

```ts
// packages/protocol/test/transitions.test.ts
import { describe, expect, it } from 'vitest'
import { TaskTransitionEvent } from '../src/transitions.js'

const diffStat = { filesChanged: 1, insertions: 2, deletions: 0 }

describe('TaskTransitionEvent', () => {
  it('parses the twelve transition events', () => {
    const events = [
      { type: 'enqueue' },
      { type: 'start' },
      { type: 'approval_requested', approvalId: 'a1' },
      { type: 'approval_allow', approvalId: 'a1' },
      { type: 'approval_deny', approvalId: 'a1', note: 'no' },
      { type: 'completed' },
      { type: 'verify_ok', reviewId: 'r1', exitCode: 0, output: 'ok', diffStat },
      { type: 'verify_fail', reviewId: 'r1', exitCode: 1, output: 'bad', diffStat },
      { type: 'approve', reviewId: 'r1' },
      { type: 'reject', reviewId: 'r1', feedback: 'fix it' },
      { type: 'cancel', reason: 'user' },
      { type: 'error', message: 'boom' },
    ] as const
    for (const event of events) {
      expect(TaskTransitionEvent.parse(event).type).toBe(event.type)
    }
  })

  it('enforces exit code and feedback constraints', () => {
    expect(() =>
      TaskTransitionEvent.parse({ type: 'verify_ok', reviewId: 'r1', exitCode: 1, output: '', diffStat }),
    ).toThrow()
    expect(() =>
      TaskTransitionEvent.parse({ type: 'verify_fail', reviewId: 'r1', exitCode: 0, output: '', diffStat }),
    ).toThrow()
    expect(() =>
      TaskTransitionEvent.parse({ type: 'reject', reviewId: 'r1', feedback: '' }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/protocol test -- entities-events transitions`
Expected: FAIL，提示找不到对应模块

- [ ] **Step 3: 写实现**

```ts
// packages/protocol/src/entities/event.ts
import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const Event = z.object({
  id: Id,
  sessionId: Id,
  ordinal: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.unknown(),
  ts: Timestamp,
})
export type Event = z.infer<typeof Event>
```

```ts
// packages/protocol/src/entities/approval.ts
import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { ApprovalDecision } from '../enums.js'

export const ApprovalRequest = z.object({
  toolName: z.string().min(1),
  input: z.unknown(),
  risk: z.enum(['low', 'medium', 'high']),
  reason: z.string().optional(),
})
export type ApprovalRequest = z.infer<typeof ApprovalRequest>

export const Approval = z.object({
  id: Id,
  sessionId: Id,
  request: ApprovalRequest,
  decision: ApprovalDecision.nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: Timestamp.nullable(),
})
export type Approval = z.infer<typeof Approval>
```

```ts
// packages/protocol/src/entities/review.ts
import { z } from 'zod'
import { DiffStat, Id, Timestamp } from '../common.js'
import { ReviewVerdict } from '../enums.js'

export const Review = z.object({
  id: Id,
  taskId: Id,
  verdict: ReviewVerdict.nullable(),
  verifyExitCode: z.number().int().nullable(),
  verifyOutput: z.string().nullable(),
  diffStat: DiffStat.nullable(),
  decidedAt: Timestamp.nullable(),
})
export type Review = z.infer<typeof Review>
```

```ts
// packages/protocol/src/entities/audit.ts
import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const Audit = z.object({
  id: Id,
  ts: Timestamp,
  actor: z.string().min(1),
  action: z.string().min(1),
  detail: z.unknown(),
})
export type Audit = z.infer<typeof Audit>
```

```ts
// packages/protocol/src/entities/notice.ts
import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const Notice = z.object({
  id: Id,
  ts: Timestamp,
  kind: z.string().min(1),
  payload: z.unknown(),
  readAt: Timestamp.nullable(),
})
export type Notice = z.infer<typeof Notice>
```

```ts
// packages/protocol/src/entities/index.ts（追加）
export * from './event.js'
export * from './approval.js'
export * from './review.js'
export * from './audit.js'
export * from './notice.js'
```

```ts
// packages/protocol/src/transitions.ts
import { z } from 'zod'
import { DiffStat, Id } from './common.js'

const DiffStatFixture = DiffStat

export const TaskTransitionEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('enqueue') }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('approval_requested'), approvalId: Id }),
  z.object({ type: z.literal('approval_allow'), approvalId: Id }),
  z.object({ type: z.literal('approval_deny'), approvalId: Id, note: z.string().min(1).optional() }),
  z.object({ type: z.literal('completed') }),
  z.object({
    type: z.literal('verify_ok'),
    reviewId: Id,
    exitCode: z.literal(0),
    output: z.string(),
    diffStat: DiffStatFixture,
  }),
  z.object({
    type: z.literal('verify_fail'),
    reviewId: Id,
    exitCode: z.number().int().refine((n) => n !== 0, { message: 'exitCode must be non-zero' }),
    output: z.string(),
    diffStat: DiffStatFixture,
  }),
  z.object({ type: z.literal('approve'), reviewId: Id }),
  z.object({ type: z.literal('reject'), reviewId: Id, feedback: z.string().min(1) }),
  z.object({ type: z.literal('cancel'), reason: z.string().min(1).optional() }),
  z.object({ type: z.literal('error'), message: z.string().min(1) }),
])
export type TaskTransitionEvent = z.infer<typeof TaskTransitionEvent>
```

```ts
// packages/protocol/src/index.ts（追加一行）
export * from './transitions.js'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/protocol test -- entities-events transitions`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src packages/protocol/test
git commit -m "feat(protocol): 增加事件、审批、验收实体与状态转移事件"
```

---

## Task 4: Protocol WS 客户端命令

Blocking: Task 3
Slice type: tracer-bullet
Seam: `packages/protocol/test/commands.test.ts`

**Files:**
- Create: `packages/protocol/src/commands.ts`
- Create: `packages/protocol/test/commands.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes: `Id`、`Timestamp`、`Engine`、`WorkspaceMode`、`ApprovalDecision`
- Produces: `ResumeInput`、`TaskCreateInput`、`TaskEnqueueInput`、`TaskCancelInput`、`ApprovalDecideInput`、`ReviewDecideInput`、`ClientMessage`

- [ ] **Step 1: 写失败测试**

```ts
// packages/protocol/test/commands.test.ts
import { describe, expect, it } from 'vitest'
import { ClientMessage } from '../src/commands.js'

const fixtures = [
  ['resume', { sinceSeq: 10 }],
  [
    'task.create',
    {
      workspaceId: 'w1',
      nodeId: 'n1',
      title: 'demo',
      prompt: 'do it',
      contextNodeIds: ['n1'],
      engine: 'fake',
    },
  ],
  ['task.enqueue', { taskId: 't1' }],
  ['task.cancel', { taskId: 't1', reason: 'user' }],
  ['approval.decide', { approvalId: 'a1', decision: 'allow' }],
  ['review.decide', { reviewId: 'r1', decision: 'reject', feedback: 'fix it' }],
] as const

describe('ClientMessage', () => {
  it.each(fixtures)('parses %s', (type, payload) => {
    const parsed = ClientMessage.parse({ v: 1, id: 'c1', ts: 1, type, payload })
    expect(parsed.type).toBe(type)
  })

  it('requires feedback on reject', () => {
    expect(() =>
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'reject' },
      }),
    ).toThrow()
  })

  it('accepts approve without feedback', () => {
    expect(
      ClientMessage.parse({
        v: 1,
        id: 'c1',
        ts: 1,
        type: 'review.decide',
        payload: { reviewId: 'r1', decision: 'approve' },
      }).type,
    ).toBe('review.decide')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/protocol test -- commands`
Expected: FAIL，提示找不到 `../src/commands.js`

- [ ] **Step 3: 写实现**

```ts
// packages/protocol/src/commands.ts
import { z } from 'zod'
import { Id, Timestamp } from './common.js'
import { ApprovalDecision, Engine, WorkspaceMode } from './enums.js'

export const ResumeInput = z.object({
  sinceSeq: z.number().int().nonnegative().optional(),
})
export type ResumeInput = z.infer<typeof ResumeInput>

export const TaskCreateInput = z.object({
  workspaceId: Id,
  nodeId: Id,
  title: z.string().min(1),
  prompt: z.string().min(1),
  contextNodeIds: z.array(Id),
  engine: Engine,
  workspaceMode: WorkspaceMode.default('main'),
  verifyCommand: z.string().min(1).optional(),
})
export type TaskCreateInput = z.infer<typeof TaskCreateInput>

export const TaskEnqueueInput = z.object({ taskId: Id })
export type TaskEnqueueInput = z.infer<typeof TaskEnqueueInput>

export const TaskCancelInput = z.object({
  taskId: Id,
  reason: z.string().min(1).optional(),
})
export type TaskCancelInput = z.infer<typeof TaskCancelInput>

export const ApprovalDecideInput = z.object({
  approvalId: Id,
  decision: ApprovalDecision,
  note: z.string().min(1).optional(),
})
export type ApprovalDecideInput = z.infer<typeof ApprovalDecideInput>

export const ReviewDecideInput = z.discriminatedUnion('decision', [
  z.object({ reviewId: Id, decision: z.literal('approve') }),
  z.object({
    reviewId: Id,
    decision: z.literal('reject'),
    feedback: z.string().min(1),
  }),
])
export type ReviewDecideInput = z.infer<typeof ReviewDecideInput>

const CommandBase = z.object({
  v: z.literal(1),
  id: Id,
  ts: Timestamp,
})

export const ClientMessage = z.discriminatedUnion('type', [
  CommandBase.extend({ type: z.literal('resume'), payload: ResumeInput }),
  CommandBase.extend({ type: z.literal('task.create'), payload: TaskCreateInput }),
  CommandBase.extend({ type: z.literal('task.enqueue'), payload: TaskEnqueueInput }),
  CommandBase.extend({ type: z.literal('task.cancel'), payload: TaskCancelInput }),
  CommandBase.extend({ type: z.literal('approval.decide'), payload: ApprovalDecideInput }),
  CommandBase.extend({ type: z.literal('review.decide'), payload: ReviewDecideInput }),
])
export type ClientMessage = z.infer<typeof ClientMessage>
```

```ts
// packages/protocol/src/index.ts（追加一行）
export * from './commands.js'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/protocol test -- commands`
Expected: PASS（8 tests）

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src packages/protocol/test/commands.test.ts
git commit -m "feat(protocol): 增加 M1 WS 客户端命令"
```

---

## Task 5: Protocol WS 服务端事件、AG-UI 与导出契约

Blocking: Task 4
Slice type: tracer-bullet
Seam: `packages/protocol/test/events.test.ts` + `packages/protocol/test/agui.test.ts` + `packages/protocol/test/exports.test.ts`

**Files:**
- Create: `packages/protocol/src/events.ts`
- Create: `packages/protocol/src/agui.ts`
- Create: `packages/protocol/test/events.test.ts`
- Create: `packages/protocol/test/agui.test.ts`
- Create: `packages/protocol/test/exports.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/package.json`（增加 `@ag-ui/core`）

**Interfaces:**
- Consumes: Task 3/4 的 `TaskStatus`、`ApprovalRequest`、`DiffStat`、`Id`、`Timestamp`
- Produces: `ServerMessage`、`AckEvent`、`ErrorEvent`、`TaskStatusEvent`、`SessionEvent`、`ApprovalRequestEvent`、`VerifyResultEvent`、`AgentEvent`、`EventType`、`EventSchemas`

- [ ] **Step 1: 写失败测试**

```ts
// packages/protocol/test/events.test.ts
import { describe, expect, it } from 'vitest'
import { ServerMessage } from '../src/events.js'

const aguiEvent = { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hi' }

const fixtures = [
  ['ack', { commandId: 'c1', ok: true }],
  ['error', { code: 'invalid_transition', message: 'no' }],
  ['task.status', { taskId: 't1', status: 'running', previousStatus: 'queued', retryCount: 0, updatedAt: 2 }],
  ['session.event', { sessionId: 's1', event: aguiEvent }],
  ['approval.request', { approvalId: 'a1', sessionId: 's1', request: { toolName: 'Bash', input: {}, risk: 'low' } }],
  ['verify.result', { taskId: 't1', reviewId: 'r1', exitCode: 0, output: 'ok', diffStat: { filesChanged: 1, insertions: 1, deletions: 0 }, durationMs: 10 }],
] as const

describe('ServerMessage', () => {
  it.each(fixtures)('parses %s', (type, payload) => {
    const parsed = ServerMessage.parse({ v: 1, ts: 1, seq: 1, type, payload })
    expect(parsed.type).toBe(type)
  })
})
```

```ts
// packages/protocol/test/agui.test.ts
import { describe, expect, it } from 'vitest'
import { EventSchemas } from '../src/agui.js'

describe('AG-UI', () => {
  it('parses a real TEXT_MESSAGE_CONTENT event', () => {
    const parsed = EventSchemas.parse({
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: 'm1',
      delta: 'hello',
    })
    expect(parsed.type).toBe('TEXT_MESSAGE_CONTENT')
  })
})
```

```ts
// packages/protocol/test/exports.test.ts
import { describe, expect, it } from 'vitest'
import * as protocol from '../src/index.js'
import type { AgentEvent } from '../src/index.js'

function acceptsAgentEvent(event: AgentEvent): AgentEvent {
  return event
}

describe('protocol exports', () => {
  it('exports the M1 contract surface', () => {
    const required = [
      'TaskStatus',
      'NodeType',
      'EdgeType',
      'SessionStatus',
      'ApprovalDecision',
      'RiskLevel',
      'ReviewVerdict',
      'Engine',
      'WorkspaceMode',
      'Id',
      'Timestamp',
      'DiffStat',
      'Viewport',
      'AppError',
      'PolicySchema',
      'Workspace',
      'Canvas',
      'Node',
      'Edge',
      'Task',
      'Session',
      'Event',
      'ApprovalRequest',
      'Approval',
      'Review',
      'Audit',
      'Notice',
      'TaskTransitionEvent',
      'ClientMessage',
      'ServerMessage',
      'EventType',
      'EventSchemas',
    ] as const
    for (const name of required) {
      expect(protocol).toHaveProperty(name)
    }
    expect(acceptsAgentEvent).toBeTypeOf('function')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/protocol test -- events agui exports`
Expected: FAIL，提示找不到 `../src/events.js` / `../src/agui.js`

- [ ] **Step 3: 安装 AG-UI 依赖**

Run: `pnpm --filter @baton/protocol add @ag-ui/core@^1.0.4`
Expected: `packages/protocol/package.json` 出现 `@ag-ui/core`，`pnpm-lock.yaml` 更新

- [ ] **Step 4: 写实现**

```ts
// packages/protocol/src/agui.ts
export { EventType } from '@ag-ui/core'
export { EventSchemas } from '@ag-ui/core/schemas'
import { EventSchemas } from '@ag-ui/core/schemas'
import type { z } from 'zod'

export type AgentEvent = z.infer<typeof EventSchemas>
```

```ts
// packages/protocol/src/events.ts
import { z } from 'zod'
import { DiffStat, Id, Timestamp } from './common.js'
import { ApprovalRequest } from './entities/approval.js'
import { TaskStatus } from './enums.js'
import { EventSchemas } from './agui.js'

const EventBase = z.object({
  v: z.literal(1),
  ts: Timestamp,
})

const ReplayableBase = EventBase.extend({
  seq: z.number().int().nonnegative(),
})

export const AckEvent = EventBase.extend({
  type: z.literal('ack'),
  seq: z.number().int().nonnegative().optional(),
  payload: z.object({ commandId: Id, ok: z.literal(true) }),
})
export type AckEvent = z.infer<typeof AckEvent>

export const ErrorEvent = EventBase.extend({
  type: z.literal('error'),
  seq: z.number().int().nonnegative().optional(),
  payload: z.object({
    commandId: Id.optional(),
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
})
export type ErrorEvent = z.infer<typeof ErrorEvent>

export const TaskStatusEvent = ReplayableBase.extend({
  type: z.literal('task.status'),
  payload: z.object({
    taskId: Id,
    status: TaskStatus,
    previousStatus: TaskStatus,
    retryCount: z.number().int().nonnegative(),
    updatedAt: Timestamp,
  }),
})
export type TaskStatusEvent = z.infer<typeof TaskStatusEvent>

export const SessionEvent = ReplayableBase.extend({
  type: z.literal('session.event'),
  payload: z.object({ sessionId: Id, event: EventSchemas }),
})
export type SessionEvent = z.infer<typeof SessionEvent>

export const ApprovalRequestEvent = ReplayableBase.extend({
  type: z.literal('approval.request'),
  payload: z.object({
    approvalId: Id,
    sessionId: Id,
    request: ApprovalRequest,
  }),
})
export type ApprovalRequestEvent = z.infer<typeof ApprovalRequestEvent>

export const VerifyResultEvent = ReplayableBase.extend({
  type: z.literal('verify.result'),
  payload: z.object({
    taskId: Id,
    reviewId: Id,
    exitCode: z.number().int(),
    output: z.string(),
    diffStat: DiffStat,
    durationMs: z.number().int().nonnegative(),
  }),
})
export type VerifyResultEvent = z.infer<typeof VerifyResultEvent>

export const ServerMessage = z.discriminatedUnion('type', [
  AckEvent,
  ErrorEvent,
  TaskStatusEvent,
  SessionEvent,
  ApprovalRequestEvent,
  VerifyResultEvent,
])
export type ServerMessage = z.infer<typeof ServerMessage>
```

```ts
// packages/protocol/src/index.ts（追加两行）
export * from './events.js'
export * from './agui.js'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @baton/protocol test -- events agui exports`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/protocol/package.json packages/protocol/src packages/protocol/test pnpm-lock.yaml
git commit -m "feat(protocol): 增加 WS 服务端事件、AG-UI 包装与导出契约"
```

---

## Task 6: Core 状态机 API 与执行/审批前半段

Blocking: Task 3
Slice type: tracer-bullet
Seam: `packages/core/test/transition-happy.test.ts`

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/state-machine/types.ts`
- Create: `packages/core/src/state-machine/effects.ts`
- Create: `packages/core/src/state-machine/transition.ts`
- Create: `packages/core/src/state-machine/index.ts`
- Create: `packages/core/test/transition-happy.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `TaskStatus`、`TaskTransitionEvent`、`DiffStat`、`AppError` from `@baton/protocol`
- Produces: `TransitionContext`、`TaskEffect`、`TransitionResult`、`effects`、`transition`

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/test/transition-happy.test.ts
import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import type { TransitionContext } from '../src/state-machine/types.js'
import type { TaskStatus } from '@baton/protocol'

const ctx = (status: TaskStatus, overrides: Partial<TransitionContext> = {}): TransitionContext => ({
  status,
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 2 },
  ...overrides,
})

describe('transition happy path', () => {
  it('moves todo to queued', () => {
    const result = transition(ctx('todo'), { type: 'enqueue' })
    expect(result).toMatchObject({ ok: true, status: 'queued' })
    expect(result.ok && result.effects).toContainEqual({ type: 'enqueueTask' })
  })

  it('moves queued to running when a slot is free', () => {
    const result = transition(ctx('queued'), { type: 'start' })
    expect(result).toMatchObject({ ok: true, status: 'running' })
    expect(result.ok && result.effects).toContainEqual({ type: 'startSession' })
  })

  it('moves running to waiting_input and back', () => {
    const waiting = transition(ctx('running'), { type: 'approval_requested', approvalId: 'a1' })
    expect(waiting).toMatchObject({ ok: true, status: 'waiting_input' })
    const allowed = transition(ctx('waiting_input'), { type: 'approval_allow', approvalId: 'a1' })
    expect(allowed).toMatchObject({ ok: true, status: 'running' })
    expect(allowed.ok && allowed.effects).toContainEqual({
      type: 'resolveApproval',
      approvalId: 'a1',
      decision: 'allow',
    })
  })

  it('moves running to verifying on completion', () => {
    const result = transition(ctx('running'), { type: 'completed' })
    expect(result).toMatchObject({ ok: true, status: 'verifying' })
    expect(result.ok && result.effects).toContainEqual({ type: 'runVerify' })
  })

  it('moves running and waiting_input to failed on error', () => {
    expect(transition(ctx('running'), { type: 'error', message: 'boom' })).toMatchObject({
      ok: true,
      status: 'failed',
    })
    expect(transition(ctx('waiting_input'), { type: 'error', message: 'boom' })).toMatchObject({
      ok: true,
      status: 'failed',
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/core test`
Expected: FAIL，提示找不到 `vitest` 或 `../src/state-machine/index.js`

- [ ] **Step 3: 配置 core 包**

```json
// packages/core/package.json
{
  "name": "@baton/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run --coverage"
  },
  "dependencies": {
    "@baton/protocol": "workspace:*"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^5.1.0",
    "typescript": "^5.9.3",
    "vitest": "^5.1.0"
  }
}
```

```ts
// packages/core/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
```

```json
// packages/core/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "test"]
}
```

Run: `pnpm install --frozen-lockfile=false`
Expected: 安装成功，lockfile 更新

- [ ] **Step 4: 写状态机实现（前半段）**

```ts
// packages/core/src/state-machine/types.ts
import type { AppError, DiffStat, TaskStatus } from '@baton/protocol'

export interface TransitionContext {
  readonly status: TaskStatus
  readonly retryCount: number
  readonly runningCount: number
  readonly maxConcurrency: number
  readonly autopilot: { readonly enabled: boolean; readonly retryMax: number }
}

export type TaskEffect =
  | { type: 'emitTaskStatus'; status: TaskStatus }
  | { type: 'enqueueTask' }
  | { type: 'startSession' }
  | { type: 'requestApproval'; approvalId: string }
  | { type: 'resolveApproval'; approvalId: string; decision: 'allow' | 'deny'; note?: string }
  | { type: 'runVerify' }
  | { type: 'persistVerifyResult'; reviewId: string; exitCode: number; output: string; diffStat: DiffStat }
  | { type: 'persistReviewVerdict'; reviewId: string; verdict: 'approved' | 'rejected' }
  | { type: 'appendFeedback'; feedback: string }
  | { type: 'incrementRetry' }
  | { type: 'interruptSession'; reason?: string }

export type TransitionResult =
  | { ok: true; status: TaskStatus; retryCount: number; effects: TaskEffect[] }
  | { ok: false; error: AppError }
```

```ts
// packages/core/src/state-machine/effects.ts
import type { DiffStat, TaskStatus } from '@baton/protocol'
import type { TaskEffect } from './types.js'

export const effects = {
  emitTaskStatus: (status: TaskStatus): TaskEffect => ({ type: 'emitTaskStatus', status }),
  enqueueTask: (): TaskEffect => ({ type: 'enqueueTask' }),
  startSession: (): TaskEffect => ({ type: 'startSession' }),
  requestApproval: (approvalId: string): TaskEffect => ({ type: 'requestApproval', approvalId }),
  resolveApproval: (
    approvalId: string,
    decision: 'allow' | 'deny',
    note?: string,
  ): TaskEffect => ({
    type: 'resolveApproval',
    approvalId,
    decision,
    ...(note ? { note } : {}),
  }),
  runVerify: (): TaskEffect => ({ type: 'runVerify' }),
  persistVerifyResult: (
    reviewId: string,
    exitCode: number,
    output: string,
    diffStat: DiffStat,
  ): TaskEffect => ({ type: 'persistVerifyResult', reviewId, exitCode, output, diffStat }),
  persistReviewVerdict: (
    reviewId: string,
    verdict: 'approved' | 'rejected',
  ): TaskEffect => ({ type: 'persistReviewVerdict', reviewId, verdict }),
  appendFeedback: (feedback: string): TaskEffect => ({ type: 'appendFeedback', feedback }),
  incrementRetry: (): TaskEffect => ({ type: 'incrementRetry' }),
  interruptSession: (reason?: string): TaskEffect => ({
    type: 'interruptSession',
    ...(reason ? { reason } : {}),
  }),
}
```

```ts
// packages/core/src/state-machine/transition.ts
import type { TaskStatus, TaskTransitionEvent } from '@baton/protocol'
import { effects } from './effects.js'
import type { TaskEffect, TransitionContext, TransitionResult } from './types.js'

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['done', 'failed', 'cancelled'])
// verifying 是 verify 子进程阶段，agent session 已结束；取消 verify 由 M1-5 的 verify executor 处理。
const ACTIVE_SESSION: ReadonlySet<TaskStatus> = new Set(['running', 'waiting_input'])

function ok(status: TaskStatus, retryCount: number, extra: TaskEffect[]): TransitionResult {
  return { ok: true, status, retryCount, effects: [...extra, effects.emitTaskStatus(status)] }
}

function assertNever(value: never): never {
  throw new Error(`unhandled task status: ${String(value)}`)
}

/**
 * 纯状态转移：不读写 IO，不修改入参；成功时 effects 以 emitTaskStatus 结尾。
 */
export function transition(
  ctx: TransitionContext,
  event: TaskTransitionEvent,
): TransitionResult {
  if (event.type === 'cancel') {
    if (TERMINAL.has(ctx.status)) return invalid(ctx, event)
    const extra = ACTIVE_SESSION.has(ctx.status) ? [effects.interruptSession(event.reason)] : []
    return ok('cancelled', ctx.retryCount, extra)
  }

  switch (ctx.status) {
    case 'todo':
      if (event.type === 'enqueue') return ok('queued', ctx.retryCount, [effects.enqueueTask()])
      return invalid(ctx, event)

    case 'queued':
      if (event.type === 'start') {
        if (ctx.runningCount >= ctx.maxConcurrency) {
          return {
            ok: false,
            error: {
              code: 'guard_failed',
              message: 'max concurrency reached',
              details: {
                runningCount: ctx.runningCount,
                maxConcurrency: ctx.maxConcurrency,
              },
            },
          }
        }
        return ok('running', ctx.retryCount, [effects.startSession()])
      }
      return invalid(ctx, event)

    case 'running':
      if (event.type === 'approval_requested') {
        return ok('waiting_input', ctx.retryCount, [effects.requestApproval(event.approvalId)])
      }
      if (event.type === 'completed') return ok('verifying', ctx.retryCount, [effects.runVerify()])
      if (event.type === 'error') {
        return ok('failed', ctx.retryCount, [effects.interruptSession(event.message)])
      }
      return invalid(ctx, event)

    case 'waiting_input':
      if (event.type === 'approval_allow') {
        return ok('running', ctx.retryCount, [
          effects.resolveApproval(event.approvalId, 'allow'),
        ])
      }
      if (event.type === 'approval_deny') {
        return ok('running', ctx.retryCount, [
          effects.resolveApproval(event.approvalId, 'deny', event.note),
        ])
      }
      if (event.type === 'error') {
        return ok('failed', ctx.retryCount, [effects.interruptSession(event.message)])
      }
      return invalid(ctx, event)

    case 'verifying':
    case 'review':
    case 'done':
    case 'failed':
    case 'cancelled':
      return invalid(ctx, event)

    default:
      return assertNever(ctx.status)
  }
}
```

```ts
// packages/core/src/state-machine/index.ts
export { transition } from './transition.js'
export { effects } from './effects.js'
export type { TaskEffect, TransitionContext, TransitionResult } from './types.js'
```

```ts
// packages/core/src/index.ts
export * from './state-machine/index.js'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @baton/core test -- transition-happy`
Expected: PASS（5 tests）；coverage 可能暂时低于 80%，Task 7/8 补齐

- [ ] **Step 6: 提交**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): 增加状态机 API 与执行/审批转移"
```

---

## Task 7: Core 验收、打回、终态与完整转移矩阵

Blocking: Task 6
Slice type: tracer-bullet
Seam: `transition-matrix.test.ts` + `guards.test.ts` + `terminal.test.ts`

**Files:**
- Modify: `packages/core/src/state-machine/transition.ts`
- Create: `packages/core/test/transition-matrix.test.ts`
- Create: `packages/core/test/guards.test.ts`
- Create: `packages/core/test/terminal.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `transition`、`TransitionContext`
- Produces: `verifying`、`review`、`done/failed/cancelled` 的完整转移；108 组合矩阵

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/test/transition-matrix.test.ts
import { describe, expect, it } from 'vitest'
import type { TaskStatus, TaskTransitionEvent } from '@baton/protocol'
import { transition } from '../src/state-machine/index.js'
import type { TransitionContext } from '../src/state-machine/types.js'

const STATUSES: TaskStatus[] = [
  'todo',
  'queued',
  'running',
  'waiting_input',
  'verifying',
  'review',
  'done',
  'failed',
  'cancelled',
]

const EVENTS: TaskTransitionEvent[] = [
  { type: 'enqueue' },
  { type: 'start' },
  { type: 'approval_requested', approvalId: 'a1' },
  { type: 'approval_allow', approvalId: 'a1' },
  { type: 'approval_deny', approvalId: 'a1', note: 'no' },
  { type: 'completed' },
  { type: 'verify_ok', reviewId: 'r1', exitCode: 0, output: 'ok', diffStat: { filesChanged: 0, insertions: 0, deletions: 0 } },
  { type: 'verify_fail', reviewId: 'r1', exitCode: 1, output: 'bad', diffStat: { filesChanged: 1, insertions: 1, deletions: 0 } },
  { type: 'approve', reviewId: 'r1' },
  { type: 'reject', reviewId: 'r1', feedback: 'fix' },
  { type: 'cancel', reason: 'user' },
  { type: 'error', message: 'boom' },
]

const VALID = new Set([
  'todo:enqueue',
  'queued:start',
  'running:approval_requested',
  'running:completed',
  'running:error',
  'waiting_input:approval_allow',
  'waiting_input:approval_deny',
  'waiting_input:error',
  'verifying:verify_ok',
  'verifying:verify_fail',
  'review:approve',
  'review:reject',
  'todo:cancel',
  'queued:cancel',
  'running:cancel',
  'waiting_input:cancel',
  'verifying:cancel',
  'review:cancel',
])

const ctx = (status: TaskStatus): TransitionContext => ({
  status,
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 2 },
})

describe('transition matrix', () => {
  it('covers 9 statuses x 12 events', () => {
    expect(STATUSES.length * EVENTS.length).toBe(108)
    for (const status of STATUSES) {
      for (const event of EVENTS) {
        const result = transition(ctx(status), event)
        const key = `${status}:${event.type}`
        if (VALID.has(key)) {
          expect(result.ok, key).toBe(true)
          if (result.ok) {
            expect(
              result.effects.filter((effect) => effect.type === 'emitTaskStatus'),
              key,
            ).toHaveLength(1)
          }
        } else {
          expect(result.ok, key).toBe(false)
          if (!result.ok) expect(result.error.code).toBe('invalid_transition')
        }
      }
    }
  })
})
```

```ts
// packages/core/test/guards.test.ts
import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import type { TransitionContext } from '../src/state-machine/types.js'

const base: TransitionContext = {
  status: 'queued',
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 2 },
}

describe('guards', () => {
  it('rejects start when concurrency is full', () => {
    const result = transition({ ...base, runningCount: 1 }, { type: 'start' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('guard_failed')
  })

  it('retries verify_fail when autopilot is on and under retryMax', () => {
    const result = transition(
      { ...base, status: 'verifying', retryCount: 1, autopilot: { enabled: true, retryMax: 2 } },
      { type: 'verify_fail', reviewId: 'r1', exitCode: 1, output: 'bad', diffStat: { filesChanged: 1, insertions: 1, deletions: 0 } },
    )
    expect(result).toMatchObject({ ok: true, status: 'queued', retryCount: 2 })
  })

  it('goes to review at retryMax', () => {
    const result = transition(
      { ...base, status: 'verifying', retryCount: 2, autopilot: { enabled: true, retryMax: 2 } },
      { type: 'verify_fail', reviewId: 'r1', exitCode: 1, output: 'bad', diffStat: { filesChanged: 1, insertions: 1, deletions: 0 } },
    )
    expect(result).toMatchObject({ ok: true, status: 'review', retryCount: 2 })
  })
})
```

```ts
// packages/core/test/terminal.test.ts
import { describe, expect, it } from 'vitest'
import type { TaskStatus, TaskTransitionEvent } from '@baton/protocol'
import { transition } from '../src/state-machine/index.js'
import type { TransitionContext } from '../src/state-machine/types.js'

const TERMINAL: TaskStatus[] = ['done', 'failed', 'cancelled']
const EVENT: TaskTransitionEvent = { type: 'enqueue' }

const ctx = (status: TaskStatus): TransitionContext => ({
  status,
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 2 },
})

describe('terminal states', () => {
  it('rejects every event from terminal states', () => {
    for (const status of TERMINAL) {
      const result = transition(ctx(status), EVENT)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('invalid_transition')
    }
  })

  it('cancel from review has no interruptSession', () => {
    const result = transition(ctx('review'), { type: 'cancel' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.status).toBe('cancelled')
      expect(result.effects).not.toContainEqual({ type: 'interruptSession' })
    }
  })

  it('cancel from running interrupts the session', () => {
    const result = transition(ctx('running'), { type: 'cancel' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.effects).toContainEqual({ type: 'interruptSession' })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @baton/core test -- transition-matrix guards terminal`
Expected: FAIL，`verifying` / `review` 分支尚未实现

- [ ] **Step 3: 补齐 transition 的验收与终态分支**

```ts
// packages/core/src/state-machine/transition.ts（替换最后三个 case）
    case 'verifying': {
      if (event.type === 'verify_ok' && event.exitCode === 0) {
        return ok('review', ctx.retryCount, [
          effects.persistVerifyResult(event.reviewId, event.exitCode, event.output, event.diffStat),
        ])
      }
      if (event.type === 'verify_fail') {
        const persisted = effects.persistVerifyResult(
          event.reviewId,
          event.exitCode,
          event.output,
          event.diffStat,
        )
        if (ctx.autopilot.enabled && ctx.retryCount < ctx.autopilot.retryMax) {
          return ok('queued', ctx.retryCount + 1, [
            persisted,
            effects.incrementRetry(),
            effects.appendFeedback(event.output),
            effects.enqueueTask(),
          ])
        }
        return ok('review', ctx.retryCount, [persisted])
      }
      return invalid(ctx, event)
    }

    case 'review':
      if (event.type === 'approve') {
        return ok('done', ctx.retryCount, [
          effects.persistReviewVerdict(event.reviewId, 'approved'),
        ])
      }
      if (event.type === 'reject') {
        return ok('queued', ctx.retryCount, [
          effects.persistReviewVerdict(event.reviewId, 'rejected'),
          effects.appendFeedback(event.feedback),
          effects.enqueueTask(),
        ])
      }
      return invalid(ctx, event)

    case 'done':
    case 'failed':
    case 'cancelled':
      return invalid(ctx, event)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @baton/core test -- transition-matrix guards terminal`
Expected: PASS（108 组合 + guards + terminal）

- [ ] **Step 5: 提交**

```bash
git add packages/core
git commit -m "feat(core): 补齐验收、打回、终态与完整转移矩阵"
```

---

## Task 8: Effects 快照、覆盖率与全量验收

Blocking: Task 5, Task 7
Slice type: verification
Seam: `packages/core/test/effects.test.ts` + `pnpm verify`

**Files:**
- Create: `packages/core/test/effects.test.ts`
- Modify: `packages/core/vitest.config.ts`（确认阈值）
- Modify: `THIRD_PARTY_NOTICES.md`（补 `@vitest/coverage-v8`）
- Modify: `docs/README.md`（加入本 plan）

**Interfaces:**
- Consumes: 全部
- Produces: 验收证据；contract 25 条的最终验证

- [ ] **Step 1: 写 effects 快照测试**

```ts
// packages/core/test/effects.test.ts
import { describe, expect, it } from 'vitest'
import { transition } from '../src/state-machine/index.js'
import type { TransitionContext } from '../src/state-machine/types.js'

const ctx = (overrides: Partial<TransitionContext>): TransitionContext => ({
  status: 'todo',
  retryCount: 0,
  runningCount: 0,
  maxConcurrency: 1,
  autopilot: { enabled: false, retryMax: 2 },
  ...overrides,
})

const diff = { filesChanged: 1, insertions: 2, deletions: 0 }

describe('effects snapshots', () => {
  it('happy path', () => {
    expect(transition(ctx({ status: 'todo' }), { type: 'enqueue' })).toMatchSnapshot()
    expect(transition(ctx({ status: 'queued' }), { type: 'start' })).toMatchSnapshot()
    expect(transition(ctx({ status: 'running' }), { type: 'completed' })).toMatchSnapshot()
    expect(
      transition(ctx({ status: 'verifying' }), {
        type: 'verify_ok',
        reviewId: 'r1',
        exitCode: 0,
        output: 'ok',
        diffStat: diff,
      }),
    ).toMatchSnapshot()
    expect(transition(ctx({ status: 'review' }), { type: 'approve', reviewId: 'r1' })).toMatchSnapshot()
  })

  it('verify fail retry', () => {
    expect(
      transition(ctx({ status: 'verifying', autopilot: { enabled: true, retryMax: 2 } }), {
        type: 'verify_fail',
        reviewId: 'r1',
        exitCode: 1,
        output: 'bad',
        diffStat: diff,
      }),
    ).toMatchSnapshot()
  })

  it('reject does not increment retry', () => {
    const result = transition(ctx({ status: 'review', retryCount: 1 }), {
      type: 'reject',
      reviewId: 'r1',
      feedback: 'fix it',
    })
    expect(result).toMatchObject({ ok: true, status: 'queued', retryCount: 1 })
    expect(result.ok && result.effects).not.toContainEqual({ type: 'incrementRetry' })
    expect(result).toMatchSnapshot()
  })

  it('every successful transition emits exactly one task status', () => {
    const result = transition(ctx({ status: 'todo' }), { type: 'enqueue' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.effects.filter((e) => e.type === 'emitTaskStatus')).toHaveLength(1)
    }
  })
})
```

- [ ] **Step 2: 运行快照测试**

Run: `pnpm --filter @baton/core test -- effects`
Expected: PASS，生成 `packages/core/test/__snapshots__/effects.test.ts.snap`

- [ ] **Step 3: 补 notices**

在 `THIRD_PARTY_NOTICES.md` 的开发依赖或主要依赖表中补一行：

```markdown
| `@vitest/coverage-v8` | MIT | 单元测试覆盖率（仅开发依赖） |
```

- [ ] **Step 4: 更新 docs 索引**

在 `docs/README.md` 的“现行 plan”下补：

```markdown
- [M1-1/M1-2 协议领域模型与状态机实施计划](plans/2026-11-17-m1-protocol-state-machine.md)
```

- [ ] **Step 5: 跑全量校验**

```bash
pnpm verify
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
pnpm --filter @baton/core test
pnpm --filter @baton/protocol test
git diff --name-only origin/main...HEAD -- apps
git diff --name-only origin/main...HEAD
if grep -RInE 'TODO|FIXME' packages/protocol/src packages/core/src; then
  echo "placeholder found"
  exit 1
fi
```

Expected：

- 前 6 条退出码 0。
- `git diff ... -- apps` 输出为空。
- 全量 changed paths 只包含 contract 第 23 条列出的 allowed paths。
- 占位符扫描无输出。
- core coverage 四项均 ≥ 80%。

- [ ] **Step 6: 检查 contract 的 25 条**

逐条对照 `docs/contracts/M1-protocol-state-machine.contract.md`：

- 1–12：protocol 导出、实体、节点、Review、Event、转移事件、命令、事件、AG-UI、Policy、AppError。
- 13–19：core API、108 矩阵、四条快照、守卫、计数、终态、状态广播唯一。
- 20–25：分层、覆盖率、全量校验、变更边界、文档许可、无占位。

任何一条没有证据，回到对应 Task 补测试，不要用“看起来没问题”结案。

- [ ] **Step 7: 提交**

```bash
git add packages/core THIRD_PARTY_NOTICES.md docs/README.md
git commit -m "test(core): 增加 effects 快照、覆盖率与全量验收"
```

---

## Self-Review

- **Spec coverage**：spec 4.2–4.9 由 Task 1–5 覆盖；spec 5.1–5.4 由 Task 6–7 覆盖；spec 6.1–6.4 由 Task 5、7、8 覆盖；spec 8 的后续任务未在本 plan 实现，符合范围。
- **Placeholder scan**：没有 `TBD`/`TODO`/“类似 Task N”；每个代码步骤都有可执行内容。
- **Type consistency**：`TransitionContext`、`TaskEffect`、`TransitionResult` 在 Task 6 定义，Task 7/8 只扩展不重命名；`Review.verdict` 在 protocol 与 core 测试中使用 `approved/rejected`；`verifyExitCode` 独立。
- **Scope check**：8 个任务，单子系统；没有 daemon/web/adapter/DB 实现。
- **GDD**：显式跳过；sprint contract 的 25 条与 108 矩阵承担测试设计职责。
- **结构校验替代**：仓库无 `scripts/validate-handoff.sh`；已检查 frontmatter、8 个任务、无占位符、文件路径存在。

---

## 执行记录

| 日期 | Task | 结果 | Commit | 备注 |
|---|---|---|---|---|
| 2026-11-17 | Task 1 | protocol tests 10 passed；typecheck/prettier 通过 | `482044e` | Policy 默认值改用函数默认值，避免多次 parse 共享数组 |
| 2026-11-17 | Task 2 | protocol tests 13 passed；typecheck/prettier 通过 | `037571d` | 六类节点与全部核心实体补齐 valid/invalid fixtures |
| 2026-11-17 | Task 3 | protocol tests 18 passed；typecheck/prettier 通过 | `37dbbfe` | Event cursor、Review verdict/evidence、Audit/Notice 补齐测试 |
| 2026-11-17 | Task 4 | protocol tests 54 passed；typecheck/prettier 通过 | `83c8eba` | 6 个命令；review.decide approve/reject 分支 |
| 2026-11-17 | Task 5 | protocol tests 64 passed；typecheck/prettier 通过 | `c47a9c1` | @ag-ui/core 1.0.4；ServerMessage；导出契约 |
| 2026-11-17 | Task 6 | core happy-path 5 tests；typecheck/prettier 通过 | `3c2af1c` | TransitionContext / TaskEffect / transition 前半段 |
| 2026-11-17 | Task 7 | core tests 14 passed；108 组合矩阵 | `beefabb` | verifying/review/terminal + guards |
| 2026-11-17 | Task 8 | `pnpm verify`、`pnpm pack:check` 均通过；core coverage 96.66% | 本提交 | effects 快照、notices、contract 核对 |

**Batch review（Task 1–3）修复**：

- `PolicySchema` 改用 `.default(() => Inner.parse({}))`，并新增“两次 parse 不共享默认数组”的测试。
- 新增 `RiskLevel` 枚举，`Policy.autoApproveMaxRisk` 与 `ApprovalRequest.risk` 共用。
- `Review.verifyExitCode` / `verifyOutput` / `diffStat` 收紧为必填；`verdict` / `decidedAt` 仍可空。spec 4.3 同步说明。
- `Event.ordinal` / `seq`、`Review.verdict` / `verifyExitCode` 增加语义注释。
- 测试改为逐实体 valid/invalid；六类节点全部覆盖；`TaskTransitionEvent` 改为 `toEqual` round-trip。
- `Viewport.zoom > 0` 已记录在 spec 4.1。

**Batch review（Task 4–5）修复**：

- `ErrorEvent` 复用 `AppError`，避免错误形状两处定义。
- `agui.ts` 合并重复 import/re-export，并注明 `/schemas` 子路径的原因。
- `review.decide` 的 approve 分支改为 strict，显式拒绝多余 feedback。
- `exports.test.ts` 改为逐 schema 断言 `parse` 函数存在，并覆盖 6 个命令输入与 6 个服务端事件。
- `ServerMessage` 补齐 `seq` 不对称测试：可重放事件必须有 `seq`，ack/error 可省略。
- `task.create` 补 `workspaceMode` 默认值断言。
- 修复两处测试未使用解构变量，`pnpm lint` 恢复绿色。

**Core review（Task 6–8）修复**：

- `emitTaskStatus` 改为 effects 末尾追加，与 spec 5.2 “统一追加”一致；所有快照重新生成。
- 108 矩阵改为 `{ to, effects }` 全量断言，覆盖 18 个合法组合与 90 个非法组合。
- 新增 approval request/allow/deny、error from waiting_input、verify_fail 不重试快照。
- 补齐 autopilot 关闭与 `retryMax = 0/1/2` 边界。
- `verifying` 不再触发 `interruptSession`；pending approval 清理写入 spec，M1-5 实现。
- 增加 `assertNever`、只读 Set、`transition` JSDoc 与 `verify_ok` 运行时守卫。
- 测试统一用 `expectOk` helper；`terminal.test.ts` 遍历全部 12 个事件。
- `.gitignore` 加入 allowed paths 仅用于忽略 coverage 产物，作为实现期例外记录。

### Contract 25 条核对

| Contract | 证据 |
|---|---|
| 1 导出完整 | `packages/protocol/test/exports.test.ts` 覆盖 43 个运行时 schema + EventType |
| 2 导出 parse | 每个 schema 断言 `parse` 为函数；类型 `AgentEvent` 由 tsc 验证 |
| 3 实体 schema | `entities-core.test.ts` / `entities-events.test.ts` 逐实体 valid/invalid |
| 4 节点联合 | 六类节点 valid/mismatch 全覆盖 |
| 5 Review 语义 | `Review.verdict` 拒绝 passed/failed；verify 字段必填 |
| 6 事件游标 | Event 缺 ordinal/seq、负数、非整数均拒绝 |
| 7 转移事件 | 12 个事件 `toEqual` round-trip；exitCode/feedback/note 约束 |
| 8 WS 命令 | 6 个命令 round-trip；approve/reject 分支与默认 workspaceMode |
| 9 WS 事件 | 6 个事件 round-trip；seq 不对称测试 |
| 10 AG-UI | `TEXT_MESSAGE_CONTENT` 通过官方 `EventSchemas` |
| 11 Policy 默认值 | 默认值断言 + fresh object 测试 |
| 12 AppError | 缺 code/message 拒绝 |
| 13 状态机 API | `transition` / types / effects 导出 |
| 14 108 矩阵 | `transition-matrix.test.ts` 9×12，逐组合断言 `{ to, effects }` |
| 15 effects 快照 | `effects.test.ts.snap` 12 条，覆盖 approval/retry/no-retry/error/reject |
| 16 守卫 | 并发满、autopilot 关闭、retryMax 0/1/2 边界 |
| 17 计数 | verify_fail 递增；reject 不递增 |
| 18 终态 | done/failed/cancelled 拒绝；cancel review/running 差异 |
| 19 状态广播 | 每个成功转移恰好一条 emitTaskStatus |
| 20 分层 | `check:boundaries` / `check:protocol` 通过；core 只依赖 protocol |
| 21 覆盖率 | core coverage 96.66%，阈值 80% |
| 22 全量校验 | `pnpm verify` 退出码 0 |
| 23 变更边界 | `git diff ... -- apps` 为空；全量路径在 allowed list 内 |
| 24 文档许可 | notices 增加 coverage-v8；spec/contract/plan 互链 |
| 25 无占位 | `packages/protocol/src` 与 `packages/core/src` 无 TODO/FIXME |
