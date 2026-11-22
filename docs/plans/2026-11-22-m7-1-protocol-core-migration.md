---
spec_ref: ../specs/2026-11-22-m7-delivery-playbook-design.md
spec_topic: m7-delivery-playbook
task_count: 10
estimated_phases: [tests, implementation, verification]
dod: "protocol entities + core playbook/status/prompt/layout + migration 0015 + node/task 兼容；protocol/core/daemon 测试通过；pnpm verify 全绿"
status: completed
depends_on: []
---

# M7 Plan 1：Protocol、Core 与 Migration 0015

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `agent-harness:subagent-driven-development`（推荐）或 `agent-harness:executing-plans`，按 task 逐条执行。步骤用 checkbox 跟踪。
> 对应 spec：`docs/specs/2026-11-22-m7-delivery-playbook-design.md`
> 对应 contract：`docs/contracts/M7-delivery-playbook.contract.md`
> 执行图：`docs/plans/2026-11-22-m7-0-execution-map.md`

**Goal:** 先把 M7 的类型契约、纯函数与数据库迁移落稳，让后续 daemon/web 不需要边写边改协议；本计划结束时，protocol/core/daemon 测试全绿，`pnpm verify` 通过。

**Architecture:** 自下而上：`packages/protocol` 加 delivery/artifact/annotation/playbook 实体与 node/task 增量；`packages/core` 加 playbook 校验、交付/阶段状态推导、stage prompt、annotation block、交付画布布局；`apps/daemon` 加 drizzle schema 与 migration 0015。daemon service、REST、web 画布对象留给 Plan 2/3。

**Tech Stack:** TypeScript ESM、zod 4、Drizzle ORM + better-sqlite3、vitest、pnpm workspace。

**Design sync:** 本计划不做正式 UI；只给新节点类型加最小兼容卡（沿用 `NodeShell` 与既有 token）。完整画布对象、覆盖层、右栏收敛在 Plan 3 做设计同步。

**Contract mapping:**
- DoD 1：migration 0015 + 旧库升级/回滚。
- DoD 4：playbook 解析/校验/快照字段。
- DoD 5：阶段/交付状态推导与闸门纯函数（auto transition 在 Plan 2）。
- DoD 6：交付状态矩阵与 currentStageKey。
- DoD 7：artifact 类型/路径/状态 schema。
- DoD 8/9：annotation 类型、summary、annotation block。
- DoD 10：工具引用的实体/字段先落 protocol（工具实现在 Plan 2）。
- DoD 20：protocol/core/daemon 测试。
- DoD 21/22：最终命令与文档索引。

**Commit strategy:** 每个 task 末尾一次 commit，message 使用 `<type>(<scope>): <subject>`；实现分支从 `docs/m7-delivery-playbook` 派生为 `feat/m7-1-protocol-core`。

**GDD:** 本计划没有单独 GDD；以 contract DoD + task 级测试/typecheck 为 gate tree。若要正式 GDD，执行前暂停并先跑 `agent-harness:gate-driven-test-design`。

**Scope scan（新增 node 类型会触发的 exhaustive switch）:**
- `packages/core/src/context/assemble.ts`（`nodeTitle`）
- `apps/daemon/src/supervisor/canvas-summary.ts`（`nodeTitle` / `nodeSummary`）
- `apps/web/src/features/canvas/model.ts`（`toFlowNodes`）
- `apps/web/src/features/canvas/CanvasPanel.tsx`（`nodeTypes`）
- `apps/web/src/features/canvas/nodes/nodes.test.tsx`
- 另有任何 `pnpm typecheck` 暴露的 `switch (node.type)` 必须补 case，不允许 `default` 吞掉新类型。

**API type verification（已核对）:**
- `Attention`、`TaskStatus` 在 `packages/protocol/src/enums.ts` 导出。
- `TaskDetail` 在 `packages/protocol/src/entities/task.ts`，`TaskDetailResponse` 在 `api.ts`。
- `TaskCreateInput` 在 `packages/protocol/src/commands.ts`。
- `insertTask` 在 `apps/daemon/src/db/repositories.ts`，输入类型为 `Omit<Task, 'enqueuedAt' | 'budgetUsd'>`；新增字段必须改成可选，避免所有旧调用点补参。

---

### Task 1: Protocol 加 artifact / annotation / playbook 实体

Blocking: none
Slice type: tracer-bullet
Seam: `Artifact.parse` / `AnnotationSummary.parse` / `Playbook.parse`

**Files:**
- Create: `packages/protocol/src/entities/artifact.ts`
- Create: `packages/protocol/src/entities/annotation.ts`
- Create: `packages/protocol/src/entities/playbook.ts`
- Modify: `packages/protocol/src/entities/index.ts`
- Test: `packages/protocol/test/delivery-entities.test.ts`

**Interfaces:**
- Consumes: `Id`、`Timestamp` from `common.ts`；`ArtifactKind` from `artifact.ts`（playbook 复用）。
- Produces: `ArtifactKind`、`ArtifactStatus`、`Artifact`、`AnnotationStatus`、`Annotation`、`AnnotationSummary`、`PlaybookStage`、`Playbook`。

- [ ] **Step 1: Write the failing tests**

```ts
// packages/protocol/test/delivery-entities.test.ts
import { describe, expect, it } from 'vitest'
import { Annotation, AnnotationSummary, Artifact, Playbook } from '../src/index.js'

describe('artifact entity', () => {
  it('parses a drawing artifact with editable source', () => {
    const artifact = Artifact.parse({
      id: 'a1',
      workspaceId: 'w1',
      deliveryId: 'd1',
      stageKey: 'design',
      taskId: null,
      kind: 'drawing',
      name: 'wireframe',
      path: '.baton/deliveries/d1/design/wireframe.png',
      sourcePath: '.baton/deliveries/d1/design/wireframe.excalidraw',
      svgPath: null,
      mime: 'image/png',
      size: 1024,
      sha256: 'abc',
      version: 1,
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    })
    expect(artifact.kind).toBe('drawing')
    expect(artifact.sourcePath).toContain('.excalidraw')
  })

  it('rejects unknown artifact kind', () => {
    expect(
      Artifact.safeParse({
        id: 'a1', workspaceId: 'w1', deliveryId: 'd1', stageKey: 'design', taskId: null,
        kind: 'video', name: 'x', path: 'x', sourcePath: null, svgPath: null,
        mime: null, size: 0, sha256: 'x', version: 1, status: 'draft',
        createdAt: 1, updatedAt: 1,
      }).success,
    ).toBe(false)
  })
})

describe('annotation entity', () => {
  it('summarizes without strokes', () => {
    const annotation = Annotation.parse({
      id: 'an1', workspaceId: 'w1', deliveryId: 'd1', stageKey: 'design',
      targetNodeIds: ['n1'], targetArtifactId: null, note: '按钮右对齐',
      strokesJson: '[]', bbox: { x: 0, y: 0, w: 10, h: 10 },
      imagePath: '.baton/deliveries/d1/design/annotations/an1.png',
      status: 'open', taskId: null, createdAt: 1, updatedAt: 1, resolvedAt: null,
    })
    const summary = AnnotationSummary.parse(annotation)
    expect(summary.note).toBe('按钮右对齐')
    expect('strokesJson' in summary).toBe(false)
  })

  it('rejects note over 2000 chars', () => {
    expect(
      Annotation.safeParse({
        id: 'an1', workspaceId: 'w1', deliveryId: 'd1', stageKey: 'design',
        targetNodeIds: [], targetArtifactId: null, note: 'x'.repeat(2001),
        strokesJson: '[]', bbox: { x: 0, y: 0, w: 10, h: 10 }, imagePath: 'x',
        status: 'open', taskId: null, createdAt: 1, updatedAt: 1, resolvedAt: null,
      }).success,
    ).toBe(false)
  })
})

describe('playbook entity', () => {
  it('parses the standard four stages', () => {
    const playbook = Playbook.parse({
      id: 'standard-delivery',
      version: 1,
      label: '标准交付',
      stages: [
        { key: 'requirement', label: '需求', skill: 'requirement-grooming', gate: 'human', produces: [{ kind: 'spec', name: 'spec.md', required: true }] },
        { key: 'design', label: '设计', skill: 'hi-fi-design', gate: 'human', produces: [{ kind: 'prototype', name: 'prototype.html' }] },
        { key: 'build', label: '开发', skill: 'implement', gate: 'auto', produces: [{ kind: 'report', name: 'build-report.md' }] },
        { key: 'acceptance', label: '验收', skill: 'acceptance', gate: 'human', produces: [{ kind: 'report', name: 'acceptance.md' }] },
      ],
    })
    expect(playbook.stages).toHaveLength(4)
    expect(playbook.stages[0]?.acceptance.verify).toBe(true)
  })

  it('rejects unknown gate', () => {
    expect(
      Playbook.safeParse({
        id: 'x', version: 1, label: 'x',
        stages: [{ key: 'a', label: 'A', gate: 'auto-magic' }],
      }).success,
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @baton/protocol test -- delivery-entities`
Expected: FAIL，`Artifact` / `Annotation` / `Playbook` 未导出。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/protocol/src/entities/artifact.ts
import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const ArtifactKind = z.enum([
  'spec', 'prototype', 'design', 'drawing', 'report', 'screenshot', 'annotation', 'other',
])
export type ArtifactKind = z.infer<typeof ArtifactKind>

export const ArtifactStatus = z.enum(['draft', 'ready', 'accepted', 'rejected'])
export type ArtifactStatus = z.infer<typeof ArtifactStatus>

export const Artifact = z.object({
  id: Id,
  workspaceId: Id,
  deliveryId: Id,
  stageKey: z.string().min(1).max(32),
  taskId: Id.nullable(),
  kind: ArtifactKind,
  name: z.string().min(1).max(120),
  path: z.string().min(1).max(1024),
  sourcePath: z.string().min(1).max(1024).nullable(),
  svgPath: z.string().min(1).max(1024).nullable(),
  mime: z.string().min(1).max(200).nullable(),
  size: z.number().int().nonnegative(),
  sha256: z.string().min(1).max(128),
  version: z.number().int().positive(),
  status: ArtifactStatus,
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Artifact = z.infer<typeof Artifact>
```

```ts
// packages/protocol/src/entities/annotation.ts
import { z } from 'zod'
import { Id, Timestamp } from '../common.js'

export const AnnotationStatus = z.enum(['open', 'resolved', 'dismissed'])
export type AnnotationStatus = z.infer<typeof AnnotationStatus>

export const AnnotationBBox = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
})
export type AnnotationBBox = z.infer<typeof AnnotationBBox>

export const Annotation = z.object({
  id: Id,
  workspaceId: Id,
  deliveryId: Id,
  stageKey: z.string().min(1).max(32),
  targetNodeIds: z.array(Id).max(20),
  targetArtifactId: Id.nullable(),
  note: z.string().max(2000),
  strokesJson: z.string().max(2_000_000),
  bbox: AnnotationBBox,
  imagePath: z.string().min(1).max(1024),
  status: AnnotationStatus,
  taskId: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
})
export type Annotation = z.infer<typeof Annotation>

export const AnnotationSummary = Annotation.pick({
  id: true,
  deliveryId: true,
  stageKey: true,
  targetNodeIds: true,
  targetArtifactId: true,
  note: true,
  bbox: true,
  imagePath: true,
  status: true,
  taskId: true,
  createdAt: true,
})
export type AnnotationSummary = z.infer<typeof AnnotationSummary>
```

```ts
// packages/protocol/src/entities/playbook.ts
import { z } from 'zod'
import { ArtifactKind } from './artifact.js'

export const PlaybookStage = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  label: z.string().min(1).max(40),
  skill: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).nullable().default(null),
  gate: z.enum(['human', 'auto']),
  produces: z
    .array(
      z.object({
        kind: ArtifactKind,
        name: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),
        required: z.boolean().default(false),
      }),
    )
    .max(8)
    .default([]),
  acceptance: z
    .object({
      checklist: z.array(z.string().min(1).max(200)).max(8).default([]),
      verify: z.boolean().default(true),
    })
    .default({ checklist: [], verify: true }),
})
export type PlaybookStage = z.infer<typeof PlaybookStage>

export const Playbook = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  version: z.number().int().positive(),
  label: z.string().min(1).max(40),
  description: z.string().max(500).optional(),
  stages: z.array(PlaybookStage).min(1).max(8),
})
export type Playbook = z.infer<typeof Playbook>
```

在 `packages/protocol/src/entities/index.ts` 追加：

```ts
export * from './artifact.js'
export * from './annotation.js'
export * from './playbook.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @baton/protocol test -- delivery-entities`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/entities/artifact.ts packages/protocol/src/entities/annotation.ts packages/protocol/src/entities/playbook.ts packages/protocol/src/entities/index.ts packages/protocol/test/delivery-entities.test.ts
git commit -m "feat(protocol): add artifact annotation playbook entities"
```

---

### Task 2: Protocol 加 delivery / stage、node 类型、task 字段与详情响应

Blocking: Task 1
Slice type: tracer-bullet
Seam: `Delivery.parse` / `StageSummary.parse` / `Node.parse` / `TaskDetail.parse` / `TaskCreateInput.parse`

**Files:**
- Create: `packages/protocol/src/entities/delivery.ts`
- Modify: `packages/protocol/src/entities/index.ts`
- Modify: `packages/protocol/src/entities/node.ts`
- Modify: `packages/protocol/src/entities/task.ts`
- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/api.ts`
- Test: `packages/protocol/test/delivery.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Artifact`、`AnnotationSummary`、`Playbook`；`Attention`/`TaskStatus` from `enums.ts`。
- Produces: `DeliveryStatus`、`StageStatus`、`StageSummary`、`Delivery`、`DeliverySummary`、`DeliveryDetail`；`ArtifactNode`、`DrawingNode`；`Task.deliveryId/stageKey`、`TaskDetail.annotationIds`；`TaskCreateInput.annotationIds`；`TaskDetailResponse.annotations/delivery`。

- [ ] **Step 1: Write the failing tests**

```ts
// packages/protocol/test/delivery.test.ts
import { describe, expect, it } from 'vitest'
import {
  ArtifactNode,
  DeliveryDetail,
  DeliverySummary,
  DrawingNode,
  GroupNode,
  TaskCreateInput,
  TaskDetail,
} from '../src/index.js'

const stage = {
  key: 'design',
  label: '设计',
  ordinal: 2,
  gate: 'human' as const,
  status: 'waiting_person' as const,
  taskId: 't1',
  taskStatus: 'review' as const,
  attention: 'needs_review' as const,
  waitingSince: 10,
  artifactCount: 2,
  openAnnotationCount: 1,
  skillId: 'hi-fi-design',
  skillStatus: 'ok' as const,
}

describe('delivery entities', () => {
  it('parses a delivery summary', () => {
    const summary = DeliverySummary.parse({
      id: 'd1', workspaceId: 'w1', canvasId: 'c1', title: '优惠券领取页',
      goal: '做一个领取页', playbookId: 'standard-delivery', playbookVersion: 1,
      status: 'waiting_person', currentStageKey: 'design',
      stageProgress: { done: 1, total: 4 }, attention: 'needs_review',
      waitingSince: 10, openAnnotationCount: 1, createdAt: 1, updatedAt: 2,
      cancelledAt: null,
    })
    expect(summary.currentStageKey).toBe('design')
  })

  it('parses a delivery detail with stages/artifacts/annotations', () => {
    const detail = DeliveryDetail.parse({
      id: 'd1', workspaceId: 'w1', canvasId: 'c1', title: '优惠券领取页',
      goal: '做一个领取页', playbookId: 'standard-delivery', playbookVersion: 1,
      status: 'waiting_person', currentStageKey: 'design',
      stageProgress: { done: 1, total: 4 }, attention: 'needs_review',
      waitingSince: 10, openAnnotationCount: 1, createdAt: 1, updatedAt: 2,
      cancelledAt: null,
      playbook: {
        id: 'standard-delivery', version: 1, label: '标准交付',
        stages: [{ key: 'design', label: '设计', gate: 'human' }],
      },
      stages: [stage],
      artifacts: [],
      annotations: [],
    })
    expect(detail.stages[0]?.status).toBe('waiting_person')
  })
})

describe('node additions', () => {
  it('parses artifact and drawing nodes', () => {
    const base = {
      id: 'n1', canvasId: 'c1', x: 0, y: 0, w: 320, h: 200,
      groupId: null, createdAt: 1, updatedAt: 1,
    }
    expect(
      ArtifactNode.parse({
        ...base,
        type: 'artifact',
        data: {
          artifactId: 'a1', kind: 'spec', title: '需求 spec',
          path: '.baton/deliveries/d1/requirement/spec.md', status: 'ready',
        },
      }).data.title,
    ).toBe('需求 spec')
    expect(
      DrawingNode.parse({
        ...base,
        type: 'drawing',
        data: { artifactId: 'a2', title: '线框图', status: 'ready' },
      }).data.title,
    ).toBe('线框图')
    expect(
      GroupNode.parse({ ...base, type: 'group', data: { label: '② 设计', stageKey: 'design' } }).data.stageKey,
    ).toBe('design')
  })
})

describe('task additions', () => {
  it('parses delivery/stage fields and annotation ids', () => {
    const task = TaskDetail.parse({
      id: 't1', workspaceId: 'w1', nodeId: 'n1', title: '设计', prompt: 'p',
      status: 'review', waitingReason: null, engine: 'claude-sdk', workspaceMode: 'main',
      branch: null, worktreePath: null, verifyCommand: null, retryCount: 0,
      dangerouslySkipPermissions: false, budgetUsd: null, enqueuedAt: null,
      createdAt: 1, updatedAt: 1, context: null, origin: null,
      deliveryId: 'd1', stageKey: 'design', annotationIds: ['a1'],
    })
    expect(task.annotationIds).toEqual(['a1'])
  })

  it('accepts annotationIds on task create input', () => {
    const input = TaskCreateInput.parse({
      workspaceId: 'w1', nodeId: 'n1', title: '改设计', prompt: '按标注改',
      contextNodeIds: [], engine: 'claude-sdk', annotationIds: ['a1'],
    })
    expect(input.annotationIds).toEqual(['a1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @baton/protocol test -- delivery.test`
Expected: FAIL，`DeliverySummary` 等未导出。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/protocol/src/entities/delivery.ts
import { z } from 'zod'
import { Id, Timestamp } from '../common.js'
import { Attention, TaskStatus } from '../enums.js'
import { AnnotationSummary } from './annotation.js'
import { Artifact } from './artifact.js'
import { Playbook } from './playbook.js'

export const DeliveryStatus = z.enum([
  'draft', 'running', 'waiting_person', 'blocked', 'done', 'cancelled',
])
export type DeliveryStatus = z.infer<typeof DeliveryStatus>

export const StageStatus = z.enum([
  'pending', 'running', 'waiting_person', 'done', 'failed', 'cancelled',
])
export type StageStatus = z.infer<typeof StageStatus>

export const StageSummary = z.object({
  key: z.string().min(1).max(32),
  label: z.string().min(1).max(40),
  ordinal: z.number().int().positive(),
  gate: z.enum(['human', 'auto']),
  status: StageStatus,
  taskId: Id.nullable(),
  taskStatus: TaskStatus.nullable(),
  attention: Attention,
  waitingSince: Timestamp.nullable(),
  artifactCount: z.number().int().nonnegative(),
  openAnnotationCount: z.number().int().nonnegative(),
  skillId: z.string().nullable(),
  skillStatus: z.enum(['ok', 'missing', 'disabled_untrusted']).nullable(),
})
export type StageSummary = z.infer<typeof StageSummary>

export const Delivery = z.object({
  id: Id,
  workspaceId: Id,
  canvasId: Id,
  title: z.string().min(1).max(200),
  goal: z.string().max(2000),
  playbookId: z.string().min(1).max(64),
  playbookVersion: z.number().int().positive(),
  playbookJson: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  cancelledAt: Timestamp.nullable(),
})
export type Delivery = z.infer<typeof Delivery>

export const DeliverySummary = z.object({
  id: Id,
  workspaceId: Id,
  canvasId: Id,
  title: z.string().min(1).max(200),
  goal: z.string().max(2000),
  playbookId: z.string().min(1).max(64),
  playbookVersion: z.number().int().positive(),
  status: DeliveryStatus,
  currentStageKey: z.string().nullable(),
  stageProgress: z.object({
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  attention: Attention,
  waitingSince: Timestamp.nullable(),
  openAnnotationCount: z.number().int().nonnegative(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  cancelledAt: Timestamp.nullable(),
})
export type DeliverySummary = z.infer<typeof DeliverySummary>

export const DeliveryDetail = DeliverySummary.extend({
  playbook: Playbook,
  stages: z.array(StageSummary),
  artifacts: z.array(Artifact),
  annotations: z.array(AnnotationSummary),
})
export type DeliveryDetail = z.infer<typeof DeliveryDetail>
```

在 `entities/index.ts` 追加 `export * from './delivery.js'`。

`node.ts` 追加：

```ts
import { ArtifactKind, ArtifactStatus } from './artifact.js'

export const ArtifactNode = NodeBase.extend({
  type: z.literal('artifact'),
  data: z.object({
    artifactId: Id,
    kind: ArtifactKind,
    title: z.string().min(1).max(120),
    path: z.string().min(1).max(1024),
    thumbnailPath: z.string().min(1).max(1024).nullable().optional(),
    status: ArtifactStatus,
  }),
})

export const DrawingNode = NodeBase.extend({
  type: z.literal('drawing'),
  data: z.object({
    artifactId: Id,
    title: z.string().min(1).max(120),
    thumbnailPath: z.string().min(1).max(1024).nullable().optional(),
    status: ArtifactStatus,
  }),
})
```

`GroupNode.data` 增加：

```ts
stageKey: z.string().min(1).max(32).optional(),
```

`Node` union 追加 `ArtifactNode, DrawingNode`。

`task.ts`：

```ts
deliveryId: Id.nullable().default(null),
stageKey: z.string().min(1).max(32).nullable().default(null),
```

`TaskDetail` 追加：

```ts
annotationIds: z.array(Id).default([]),
```

`commands.ts` 的 `TaskCreateInput` 追加：

```ts
deliveryId: Id.optional(),
stageKey: z.string().min(1).max(32).optional(),
annotationIds: z.array(Id).max(20).optional(),
```

`api.ts` 的 `TaskDetailResponse` 追加：

```ts
annotations: z.array(AnnotationSummary).default([]),
delivery: DeliverySummary.nullable().default(null),
```

并在 `api.ts` 的 import 中加 `AnnotationSummary`、`DeliverySummary`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @baton/protocol test -- delivery`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/entities/delivery.ts packages/protocol/src/entities/index.ts packages/protocol/src/entities/node.ts packages/protocol/src/entities/task.ts packages/protocol/src/commands.ts packages/protocol/src/api.ts packages/protocol/test/delivery.test.ts
git commit -m "feat(protocol): add delivery stage node and task fields"
```

---

### Task 3: 新 node / task 字段的编译兼容（core / daemon / web）

Blocking: Task 2
Slice type: refactor
Seam: `pnpm typecheck` + 现有测试；新增 `canvas-summary` / 节点卡测试

**Files:**
- Modify: `packages/core/src/context/assemble.ts`（`nodeTitle`）
- Modify: `apps/daemon/src/supervisor/canvas-summary.ts`（`nodeTitle` / `nodeSummary`）
- Modify: `apps/daemon/src/db/repositories.ts`（`toTask` / `insertTask` / `getTaskDetail`）
- Modify: `apps/web/src/features/canvas/model.ts`（`toFlowNodes`）
- Modify: `apps/web/src/features/canvas/CanvasPanel.tsx`（`nodeTypes`）
- Create: `apps/web/src/features/canvas/nodes/ArtifactNode.tsx`
- Create: `apps/web/src/features/canvas/nodes/DrawingNode.tsx`
- Test: `apps/daemon/test/canvas-summary.test.ts`
- Test: `apps/web/src/features/canvas/nodes/nodes.test.tsx`（补最小渲染断言）

**Interfaces:**
- Consumes: Task 2 的 `ArtifactNode` / `DrawingNode` / `Task.deliveryId/stageKey` / `TaskDetail.annotationIds`。
- Produces: 编译通过的新节点摘要与最小卡片；`insertTask` 接受可选 `deliveryId/stageKey/annotationIds`；`toTask` 返回新字段。

- [ ] **Step 1: Write the failing tests**

```ts
// apps/daemon/test/canvas-summary.test.ts
import { describe, expect, it } from 'vitest'
import { canvasOverviewXml, nodeSummary, nodeTitle } from '../src/supervisor/canvas-summary.js'

const artifact = {
  id: 'n1', canvasId: 'c1', type: 'artifact' as const,
  x: 0, y: 0, w: 320, h: 200, groupId: null, createdAt: 1, updatedAt: 1,
  data: { artifactId: 'a1', kind: 'spec' as const, title: '需求 spec', path: '.baton/deliveries/d1/requirement/spec.md', status: 'ready' as const },
}
const drawing = {
  id: 'n2', canvasId: 'c1', type: 'drawing' as const,
  x: 0, y: 0, w: 320, h: 200, groupId: null, createdAt: 1, updatedAt: 1,
  data: { artifactId: 'a2', title: '线框图', status: 'ready' as const },
}

describe('canvas summary new node types', () => {
  it('titles artifact and drawing nodes', () => {
    expect(nodeTitle(artifact)).toBe('需求 spec')
    expect(nodeTitle(drawing)).toBe('线框图')
  })
  it('summarizes artifact without reading file content', () => {
    expect(nodeSummary(artifact)).toMatchObject({ type: 'artifact', title: '需求 spec' })
    expect(nodeSummary(artifact)).not.toHaveProperty('content')
  })
  it('renders overview without throwing', () => {
    expect(canvasOverviewXml([artifact, drawing], 1)).toContain('type="artifact"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evanfang0054/baton test -- canvas-summary`
Expected: FAIL，`nodeTitle` 不处理 `artifact` / `drawing`。

- [ ] **Step 3: Implement compatibility**

`packages/core/src/context/assemble.ts` 的 `nodeTitle` switch 追加：

```ts
case 'artifact':
  return node.data.title
case 'drawing':
  return node.data.title
```

`apps/daemon/src/supervisor/canvas-summary.ts` 两个 switch 追加：

```ts
case 'artifact':
  return { ...base, artifactId: node.data.artifactId, kind: node.data.kind, status: node.data.status }
case 'drawing':
  return { ...base, artifactId: node.data.artifactId, status: node.data.status }
```

`nodeTitle`：`artifact`/`drawing` 返回 `node.data.title`。

`apps/daemon/src/db/repositories.ts`：

- `toTask` 追加 `deliveryId: row.deliveryId ?? null`、`stageKey: row.stageKey ?? null`。
- `insertTask` 输入改为：

```ts
input: Omit<Task, 'enqueuedAt' | 'budgetUsd' | 'deliveryId' | 'stageKey'> & {
  enqueuedAt?: number | null
  budgetUsd?: number | null
  deliveryId?: string | null
  stageKey?: string | null
  annotationIds?: string[]
},
```

- `.values` 追加：

```ts
deliveryId: input.deliveryId ?? null,
stageKey: input.stageKey ?? null,
annotationIdsJson: input.annotationIds?.length ? JSON.stringify(input.annotationIds) : null,
```

- `getTaskDetail` 解析 `annotationIdsJson`：

```ts
let annotationIds: string[] = []
if (row.annotationIdsJson) {
  try {
    const parsed = JSON.parse(row.annotationIdsJson) as unknown
    if (Array.isArray(parsed)) annotationIds = parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    annotationIds = []
  }
}
```

返回 `task: { ...base, context, origin, annotationIds }`。

`apps/web/src/features/canvas/model.ts` 的 `toFlowNodes` 为 `artifact` / `drawing` 各加一个 case：宽 320、高 240，`data: { node }`；`groupId` 继续传入。`CanvasPanel.tsx` 的 `nodeTypes` 追加：

```ts
artifact: ArtifactNode,
drawing: DrawingNode,
```

最小卡片：

```tsx
// apps/web/src/features/canvas/nodes/ArtifactNode.tsx
import { FileText } from 'lucide-react'
import { NodeShell, type CanvasFlowNodeProps } from './NodeShell'

export function ArtifactNode({ data, selected }: CanvasFlowNodeProps) {
  const node = data.node.type === 'artifact' ? data.node : null
  return (
    <NodeShell selected={selected} injected={data.injected}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <FileText size={14} />
        产物
      </div>
      <p className="mt-2 truncate text-sm font-medium text-foreground">{node?.data.title ?? ''}</p>
      <p className="mt-1 truncate font-mono text-xs text-muted">{node?.data.path ?? ''}</p>
    </NodeShell>
  )
}
```

`DrawingNode.tsx`：

```tsx
// apps/web/src/features/canvas/nodes/DrawingNode.tsx
import { PenLine } from 'lucide-react'
import { NodeShell, type CanvasFlowNodeProps } from './NodeShell'

export function DrawingNode({ data, selected }: CanvasFlowNodeProps) {
  const node = data.node.type === 'drawing' ? data.node : null
  return (
    <NodeShell selected={selected} injected={data.injected}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <PenLine size={14} />
        画板
      </div>
      <p className="mt-2 truncate text-sm font-medium text-foreground">{node?.data.title ?? ''}</p>
    </NodeShell>
  )
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- canvas-summary
pnpm --filter @baton/web test -- nodes
pnpm typecheck
```

Expected: PASS；typecheck 不再报 exhaustive switch。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/assemble.ts apps/daemon/src/supervisor/canvas-summary.ts apps/daemon/src/db/repositories.ts apps/web/src/features/canvas/model.ts apps/web/src/features/canvas/CanvasPanel.tsx apps/web/src/features/canvas/nodes/ArtifactNode.tsx apps/web/src/features/canvas/nodes/DrawingNode.tsx apps/daemon/test/canvas-summary.test.ts apps/web/src/features/canvas/nodes/nodes.test.tsx
git commit -m "fix(protocol): handle artifact and drawing nodes across layers"
```

---

### Task 4: Core playbook 解析、校验与导航

Blocking: Task 1
Slice type: tracer-bullet
Seam: `parsePlaybook(input)` / `nextStage(playbook, key)`

**Files:**
- Create: `packages/core/src/playbook/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/playbook.test.ts`

**Interfaces:**
- Consumes: `Playbook` from `@baton/protocol`。
- Produces: `PlaybookIssue`、`PlaybookParseResult`、`validatePlaybook`、`parsePlaybook`、`stageByKey`、`nextStage`、`stageOrdinal`。

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/playbook.test.ts
import { describe, expect, it } from 'vitest'
import { nextStage, parsePlaybook, stageByKey, validatePlaybook } from '../src/playbook/index.js'

const standard = {
  id: 'standard-delivery',
  version: 1,
  label: '标准交付',
  stages: [
    { key: 'requirement', label: '需求', gate: 'human', produces: [{ kind: 'spec', name: 'spec.md', required: true }] },
    { key: 'design', label: '设计', gate: 'human', produces: [{ kind: 'prototype', name: 'prototype.html' }] },
    { key: 'build', label: '开发', gate: 'auto', produces: [{ kind: 'report', name: 'build-report.md' }] },
    { key: 'acceptance', label: '验收', gate: 'human', produces: [{ kind: 'report', name: 'acceptance.md' }] },
  ],
}

describe('playbook', () => {
  it('accepts the standard four stages', () => {
    const result = parsePlaybook(standard)
    expect(result.ok).toBe(true)
    if (result.ok) expect(nextStage(result.playbook, 'design')?.key).toBe('build')
  })

  it('rejects duplicate stage keys', () => {
    const result = parsePlaybook({ ...standard, stages: [standard.stages[0], standard.stages[0]] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((issue) => issue.path === 'stages')).toBe(true)
  })

  it('requires the last stage to be human', () => {
    const result = parsePlaybook({
      ...standard,
      stages: standard.stages.map((stage, index) => (index === 3 ? { ...stage, gate: 'auto' } : stage)),
    })
    expect(result.ok).toBe(false)
  })

  it('rejects unsafe artifact names', () => {
    const result = parsePlaybook({
      ...standard,
      stages: [{ key: 'a', label: 'A', gate: 'human', produces: [{ kind: 'other', name: '../x' }] }, standard.stages[3]],
    })
    expect(result.ok).toBe(false)
  })

  it('navigates stages by key', () => {
    const result = parsePlaybook(standard)
    if (!result.ok) throw new Error('expected ok')
    expect(stageByKey(result.playbook, 'build')?.label).toBe('开发')
    expect(nextStage(result.playbook, 'acceptance')).toBeNull()
    expect(validatePlaybook(result.playbook)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @baton/core test -- playbook`
Expected: FAIL，`../src/playbook/index.js` 不存在。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/playbook/index.ts
import { Playbook, type PlaybookStage } from '@baton/protocol'

export interface PlaybookIssue {
  path: string
  message: string
}

export type PlaybookParseResult =
  | { ok: true; playbook: Playbook }
  | { ok: false; issues: PlaybookIssue[] }

const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/

export function validatePlaybook(playbook: Playbook): PlaybookIssue[] {
  const issues: PlaybookIssue[] = []
  const keys = new Set<string>()
  for (const stage of playbook.stages) {
    if (keys.has(stage.key)) issues.push({ path: 'stages', message: `duplicate stage key: ${stage.key}` })
    keys.add(stage.key)
    const names = new Set<string>()
    for (const artifact of stage.produces) {
      if (!SAFE_NAME.test(artifact.name)) {
        issues.push({ path: `stages.${stage.key}.produces`, message: `unsafe artifact name: ${artifact.name}` })
      }
      if (names.has(artifact.name)) {
        issues.push({ path: `stages.${stage.key}.produces`, message: `duplicate artifact name: ${artifact.name}` })
      }
      names.add(artifact.name)
    }
  }
  const last = playbook.stages.at(-1)
  if (last && last.gate !== 'human') {
    issues.push({ path: 'stages', message: 'the last stage must be human' })
  }
  return issues
}

export function parsePlaybook(input: unknown): PlaybookParseResult {
  const parsed = Playbook.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'playbook',
        message: issue.message,
      })),
    }
  }
  const issues = validatePlaybook(parsed.data)
  return issues.length > 0 ? { ok: false, issues } : { ok: true, playbook: parsed.data }
}

export function stageByKey(playbook: Playbook, key: string): PlaybookStage | null {
  return playbook.stages.find((stage) => stage.key === key) ?? null
}

export function stageOrdinal(playbook: Playbook, key: string): number {
  const index = playbook.stages.findIndex((stage) => stage.key === key)
  return index < 0 ? 0 : index + 1
}

export function nextStage(playbook: Playbook, key: string): PlaybookStage | null {
  const index = playbook.stages.findIndex((stage) => stage.key === key)
  return index < 0 ? null : playbook.stages[index + 1] ?? null
}
```

在 `packages/core/src/index.ts` 追加 `export * from './playbook/index.js'`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @baton/core test -- playbook`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/playbook/index.ts packages/core/src/index.ts packages/core/test/playbook.test.ts
git commit -m "feat(core): add playbook parse and validation"
```

---

### Task 5: Core 阶段/交付状态推导

Blocking: Task 2
Slice type: tracer-bullet
Seam: `deriveStageStatus` / `deriveDeliveryStatus`

**Files:**
- Create: `packages/core/src/delivery/status.ts`
- Create: `packages/core/src/delivery/index.ts`（re-export）
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/delivery-status.test.ts`

**Interfaces:**
- Consumes: `DeliveryStatus`、`StageStatus`、`TaskStatus` from `@baton/protocol`。
- Produces: `deriveStageStatus`、`deriveDeliveryStatus`、`deriveCurrentStageKey`。

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/delivery-status.test.ts
import { describe, expect, it } from 'vitest'
import { deriveCurrentStageKey, deriveDeliveryStatus, deriveStageStatus } from '../src/delivery/status.js'

describe('deriveStageStatus', () => {
  it.each([
    [null, 'pending'],
    ['todo', 'pending'],
    ['queued', 'running'],
    ['running', 'running'],
    ['verifying', 'running'],
    ['waiting_input', 'waiting_person'],
    ['review', 'waiting_person'],
    ['done', 'done'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
  ] as const)('%s -> %s', (taskStatus, expected) => {
    expect(deriveStageStatus(taskStatus)).toBe(expected)
  })
})

describe('deriveDeliveryStatus', () => {
  const stages = (...statuses: Array<'pending' | 'running' | 'waiting_person' | 'done' | 'failed' | 'cancelled'>) =>
    statuses.map((status, index) => ({ key: `s${index}`, status }))

  it('derives the priority order', () => {
    expect(deriveDeliveryStatus({ cancelled: true, stages: stages('done') })).toBe('cancelled')
    expect(deriveDeliveryStatus({ cancelled: false, stages: stages('done', 'done') })).toBe('done')
    expect(deriveDeliveryStatus({ cancelled: false, stages: stages('done', 'waiting_person') })).toBe('waiting_person')
    expect(deriveDeliveryStatus({ cancelled: false, stages: stages('done', 'pending') })).toBe('waiting_person')
    expect(deriveDeliveryStatus({ cancelled: false, stages: stages('running', 'pending') })).toBe('running')
    expect(deriveDeliveryStatus({ cancelled: false, stages: stages('failed', 'pending') })).toBe('blocked')
    expect(deriveDeliveryStatus({ cancelled: false, stages: stages('pending', 'pending') })).toBe('draft')
  })

  it('derives the current stage and skips done/cancelled', () => {
    expect(deriveCurrentStageKey(stages('done', 'running', 'pending'))).toBe('s1')
    expect(deriveCurrentStageKey(stages('done', 'done'))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @baton/core test -- delivery-status`
Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/delivery/status.ts
import type { DeliveryStatus, StageStatus, TaskStatus } from '@baton/protocol'

export function deriveStageStatus(taskStatus: TaskStatus | null): StageStatus {
  if (taskStatus === null || taskStatus === 'todo') return 'pending'
  if (taskStatus === 'queued' || taskStatus === 'running' || taskStatus === 'verifying') return 'running'
  if (taskStatus === 'waiting_input' || taskStatus === 'review') return 'waiting_person'
  if (taskStatus === 'done') return 'done'
  if (taskStatus === 'failed') return 'failed'
  return 'cancelled'
}

export function deriveDeliveryStatus(input: {
  cancelled: boolean
  stages: Array<{ key: string; status: StageStatus }>
}): DeliveryStatus {
  if (input.cancelled) return 'cancelled'
  const statuses = input.stages.map((stage) => stage.status)
  if (statuses.length > 0 && statuses.every((status) => status === 'done')) return 'done'
  if (statuses.some((status) => status === 'waiting_person')) return 'waiting_person'
  if (statuses.some((status, index) => status === 'pending' && index > 0 && statuses[index - 1] === 'done')) {
    return 'waiting_person'
  }
  if (statuses.some((status) => status === 'running')) return 'running'
  if (statuses.some((status) => status === 'failed')) return 'blocked'
  if (statuses.every((status) => status === 'pending')) return 'draft'
  return 'running'
}

export function deriveCurrentStageKey(
  stages: Array<{ key: string; status: StageStatus }>,
): string | null {
  return stages.find((stage) => stage.status !== 'done' && stage.status !== 'cancelled')?.key ?? null
}
```

`packages/core/src/delivery/index.ts`:

```ts
export * from './status.js'
export * from './prompt.js'
```

（`prompt.ts` 在 Task 6 创建；本 task 先只 export status，Task 6 再补 prompt。若希望一次创建，可先写 `export * from './status.js'`。）

在 `packages/core/src/index.ts` 追加 `export * from './delivery/index.js'`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @baton/core test -- delivery-status`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/delivery/status.ts packages/core/src/delivery/index.ts packages/core/src/index.ts packages/core/test/delivery-status.test.ts
git commit -m "feat(core): derive delivery and stage status"
```

---

### Task 6: Core stage prompt 与 annotation block

Blocking: Task 4、Task 5
Slice type: tracer-bullet
Seam: `buildStagePrompt(input)` / `buildAnnotationBlock(annotations)`

**Files:**
- Create: `packages/core/src/delivery/prompt.ts`
- Create: `packages/core/src/annotation/block.ts`
- Modify: `packages/core/src/delivery/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/stage-prompt.test.ts`

**Interfaces:**
- Consumes: `PlaybookStage`、`AnnotationSummary`、`ArtifactKind` from `@baton/protocol`；`escapeAttr` from `../context/assemble.js`。
- Produces: `StagePromptInput`、`buildStagePrompt`、`AnnotationContext`、`buildAnnotationBlock`。

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/stage-prompt.test.ts
import { describe, expect, it } from 'vitest'
import { buildAnnotationBlock } from '../src/annotation/block.js'
import { buildStagePrompt } from '../src/delivery/prompt.js'

const annotation = {
  id: 'an1',
  deliveryId: 'd1',
  stageKey: 'design',
  targetNodeIds: ['n1'],
  targetArtifactId: null,
  note: '按钮右对齐 & 保留间距',
  bbox: { x: 10, y: 20, w: 100, h: 40 },
  imagePath: '.baton/deliveries/d1/design/annotations/an1.png',
  status: 'open' as const,
  taskId: null,
  createdAt: 1,
}

describe('buildAnnotationBlock', () => {
  it('escapes note and keeps image path', () => {
    const block = buildAnnotationBlock([annotation])
    expect(block).toContain('按钮右对齐 &amp; 保留间距')
    expect(block).toContain('<image src=".baton/deliveries/d1/design/annotations/an1.png"/>')
    expect(block).not.toContain('strokes')
  })
})

describe('buildStagePrompt', () => {
  it('renders delivery, stage, produces, previous, skill and annotations', () => {
    const prompt = buildStagePrompt({
      delivery: { id: 'd1', title: '优惠券领取页', goal: '做一个领取页' },
      stage: { key: 'design', label: '设计', gate: 'human', ordinal: 2 },
      produces: [{ kind: 'prototype', name: 'prototype.html', path: '.baton/deliveries/d1/design/prototype.html', required: true }],
      acceptance: { checklist: ['按钮右对齐'], verify: true },
      previous: [{ stageKey: 'requirement', artifacts: [{ kind: 'spec', name: 'spec.md', path: '.baton/deliveries/d1/requirement/spec.md', required: true }] }],
      skill: { id: 'hi-fi-design', path: '.baton/skills/hi-fi-design/SKILL.md', summary: '高保真设计' },
      annotations: [annotation],
    })
    expect(prompt).toContain('<delivery id="d1" title="优惠券领取页">')
    expect(prompt).toContain('<stage key="design"')
    expect(prompt).toContain('<skill id="hi-fi-design"')
    expect(prompt).toContain('<annotation id="an1"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @baton/core test -- stage-prompt`
Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/annotation/block.ts
import type { AnnotationSummary } from '@baton/protocol'
import { escapeAttr } from '../context/assemble.js'

export type AnnotationContext = Pick<
  AnnotationSummary,
  'id' | 'note' | 'targetNodeIds' | 'targetArtifactId' | 'bbox' | 'imagePath'
> & { targetTitle?: string }

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function buildAnnotationBlock(annotations: AnnotationContext[]): string {
  if (annotations.length === 0) return ''
  const lines = annotations.map((annotation) => {
    const target =
      annotation.targetTitle ??
      annotation.targetArtifactId ??
      (annotation.targetNodeIds.length > 0 ? annotation.targetNodeIds.join(',') : 'stage')
    const bbox = `${annotation.bbox.x},${annotation.bbox.y},${annotation.bbox.w},${annotation.bbox.h}`
    return [
      `  <annotation id="${escapeAttr(annotation.id)}" note="${escapeAttr(annotation.note)}"`,
      ` target="${escapeAttr(target)}" bbox="${escapeAttr(bbox)}">`,
      `    <image src="${escapeAttr(annotation.imagePath)}"/>`,
      '  </annotation>',
    ].join('')
  })
  return ['<annotations>', ...lines, '</annotations>'].join('\n')
}
```

```ts
// packages/core/src/delivery/prompt.ts
import type { ArtifactKind } from '@baton/protocol'
import { buildAnnotationBlock, type AnnotationContext } from '../annotation/block.js'
import { escapeAttr } from '../context/assemble.js'

export interface StagePromptArtifact {
  kind: ArtifactKind
  name: string
  path: string
  required: boolean
}

export interface StagePromptInput {
  delivery: { id: string; title: string; goal: string }
  stage: { key: string; label: string; gate: 'human' | 'auto'; ordinal: number }
  produces: StagePromptArtifact[]
  acceptance: { checklist: string[]; verify: boolean }
  previous: Array<{ stageKey: string; artifacts: StagePromptArtifact[] }>
  skill: { id: string; path: string; summary: string } | null
  annotations: AnnotationContext[]
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function artifactLine(artifact: StagePromptArtifact, indent = '    '): string {
  const required = artifact.required ? ' required="true"' : ''
  return `${indent}<artifact kind="${artifact.kind}" name="${escapeAttr(artifact.name)}" path="${escapeAttr(artifact.path)}"${required}/>`
}

export function buildStagePrompt(input: StagePromptInput): string {
  const lines: string[] = [
    `<delivery id="${escapeAttr(input.delivery.id)}" title="${escapeAttr(input.delivery.title)}">`,
    `  <goal>${escapeText(input.delivery.goal)}</goal>`,
    '</delivery>',
    `<stage key="${escapeAttr(input.stage.key)}" label="${escapeAttr(input.stage.label)}" gate="${input.stage.gate}" ordinal="${input.stage.ordinal}">`,
    '  <produces>',
    ...input.produces.map((artifact) => artifactLine(artifact)),
    '  </produces>',
    `  <acceptance verify="${input.acceptance.verify ? 'true' : 'false'}">`,
    ...input.acceptance.checklist.map((item) => `    <item>${escapeText(item)}</item>`),
    '  </acceptance>',
  ]
  for (const previous of input.previous) {
    lines.push(`  <previous stage="${escapeAttr(previous.stageKey)}">`)
    lines.push(...previous.artifacts.map((artifact) => artifactLine(artifact, '    ')))
    lines.push('  </previous>')
  }
  if (input.skill) {
    lines.push(
      `  <skill id="${escapeAttr(input.skill.id)}" path="${escapeAttr(input.skill.path)}" summary="${escapeAttr(input.skill.summary)}"/>`,
    )
  }
  const annotations = buildAnnotationBlock(input.annotations)
  if (annotations) lines.push(annotations)
  lines.push('</stage>')
  return lines.join('\n')
}
```

`packages/core/src/delivery/index.ts` 追加 `export * from './prompt.js'`；`packages/core/src/index.ts` 追加 `export * from './annotation/block.js'`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @baton/core test -- stage-prompt`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/annotation/block.ts packages/core/src/delivery/prompt.ts packages/core/src/delivery/index.ts packages/core/src/index.ts packages/core/test/stage-prompt.test.ts
git commit -m "feat(core): build stage prompt and annotation block"
```

---

### Task 7: Core artifact 路径、delivery guards 与 annotation 结算

Blocking: Task 4、Task 5
Slice type: tracer-bullet
Seam: `artifactPath` / `canEnqueueDelivery` / `resolveAnnotationsOnApprove`

**Files:**
- Create: `packages/core/src/artifact/path.ts`
- Create: `packages/core/src/delivery/guards.ts`
- Create: `packages/core/src/annotation/resolve.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/delivery-guards.test.ts`

**Interfaces:**
- Consumes: `TaskStatus` from `@baton/protocol`。
- Produces: `artifactPath`、`canEnqueueDelivery`、`canCancelDelivery`、`validateAnnotationTargets`、`resolveAnnotationsOnApprove`。

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/delivery-guards.test.ts
import { describe, expect, it } from 'vitest'
import { resolveAnnotationsOnApprove, validateAnnotationTargets } from '../src/annotation/resolve.js'
import { artifactPath } from '../src/artifact/path.js'
import { canCancelDelivery, canEnqueueDelivery } from '../src/delivery/guards.js'

describe('artifactPath', () => {
  it('builds a safe workspace-relative path', () => {
    expect(artifactPath({ deliveryId: 'd1', stageKey: 'design', name: 'spec.md' })).toBe(
      '.baton/deliveries/d1/design/spec.md',
    )
  })

  it('rejects traversal and unsafe names', () => {
    expect(artifactPath({ deliveryId: '../d1', stageKey: 'design', name: 'spec.md' })).toBeNull()
    expect(artifactPath({ deliveryId: 'd1', stageKey: 'Design', name: 'spec.md' })).toBeNull()
    expect(artifactPath({ deliveryId: 'd1', stageKey: 'design', name: '../spec.md' })).toBeNull()
  })
})

describe('delivery guards', () => {
  it('enqueues only the current todo stage', () => {
    expect(
      canEnqueueDelivery({
        cancelledAt: null,
        stages: [{ key: 'requirement', taskStatus: 'done' }, { key: 'design', taskStatus: 'todo' }],
      }),
    ).toEqual({ ok: true, stageKey: 'design' })
    expect(
      canEnqueueDelivery({
        cancelledAt: null,
        stages: [{ key: 'requirement', taskStatus: 'running' }],
      }),
    ).toEqual({ ok: false, reason: 'not_todo' })
  })

  it('does not cancel a cancelled or completed delivery', () => {
    expect(canCancelDelivery({ cancelledAt: 1, statuses: ['done'] })).toEqual({
      ok: false,
      reason: 'cancelled',
    })
    expect(canCancelDelivery({ cancelledAt: null, statuses: ['done', 'done'] })).toEqual({
      ok: false,
      reason: 'done',
    })
    expect(canCancelDelivery({ cancelledAt: null, statuses: ['running', 'pending'] })).toEqual({
      ok: true,
    })
  })
})

describe('annotation resolution', () => {
  const annotations = [
    { id: 'a1', status: 'open' as const, taskId: 't1' },
    { id: 'a2', status: 'open' as const, taskId: 't2' },
    { id: 'a3', status: 'resolved' as const, taskId: 't1' },
  ]

  it('validates node and artifact targets', () => {
    expect(
      validateAnnotationTargets({
        targetNodeIds: ['n1', 'n2'],
        targetArtifactId: 'a1',
        nodeIds: new Set(['n1']),
        artifactIds: new Set(['a1']),
      }),
    ).toEqual(['node_not_found:n2'])
  })

  it('resolves only open annotations for the approved task', () => {
    expect(resolveAnnotationsOnApprove(annotations, 't1')).toEqual(['a1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @baton/core test -- delivery-guards`
Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/artifact/path.ts
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const SAFE_STAGE = /^[a-z][a-z0-9-]{0,31}$/
const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/

export function artifactPath(input: {
  deliveryId: string
  stageKey: string
  name: string
}): string | null {
  if (!SAFE_ID.test(input.deliveryId)) return null
  if (!SAFE_STAGE.test(input.stageKey)) return null
  if (!SAFE_NAME.test(input.name) || input.name.includes('..')) return null
  return `.baton/deliveries/${input.deliveryId}/${input.stageKey}/${input.name}`
}
```

```ts
// packages/core/src/delivery/guards.ts
import type { TaskStatus } from '@baton/protocol'

export type EnqueueGuard =
  | { ok: true; stageKey: string }
  | { ok: false; reason: 'cancelled' | 'no_stage' | 'not_todo' }

export function canEnqueueDelivery(input: {
  cancelledAt: number | null
  stages: Array<{ key: string; taskStatus: TaskStatus | null }>
}): EnqueueGuard {
  if (input.cancelledAt !== null) return { ok: false, reason: 'cancelled' }
  const stage = input.stages.find(
    (item) => item.taskStatus !== 'done' && item.taskStatus !== 'cancelled',
  )
  if (!stage) return { ok: false, reason: 'no_stage' }
  if (stage.taskStatus !== 'todo') return { ok: false, reason: 'not_todo' }
  return { ok: true, stageKey: stage.key }
}

export type CancelGuard =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'done' }

export function canCancelDelivery(input: {
  cancelledAt: number | null
  statuses: TaskStatus[]
}): CancelGuard {
  if (input.cancelledAt !== null) return { ok: false, reason: 'cancelled' }
  if (input.statuses.length > 0 && input.statuses.every((status) => status === 'done')) {
    return { ok: false, reason: 'done' }
  }
  return { ok: true }
}
```

```ts
// packages/core/src/annotation/resolve.ts
export type AnnotationResolveFacts = {
  id: string
  status: 'open' | 'resolved' | 'dismissed'
  taskId: string | null
}

export function validateAnnotationTargets(input: {
  targetNodeIds: string[]
  targetArtifactId: string | null
  nodeIds: ReadonlySet<string>
  artifactIds: ReadonlySet<string>
}): string[] {
  const issues = input.targetNodeIds
    .filter((id) => !input.nodeIds.has(id))
    .map((id) => `node_not_found:${id}`)
  if (input.targetArtifactId && !input.artifactIds.has(input.targetArtifactId)) {
    issues.push(`artifact_not_found:${input.targetArtifactId}`)
  }
  return issues
}

export function resolveAnnotationsOnApprove(
  annotations: AnnotationResolveFacts[],
  taskId: string,
): string[] {
  return annotations
    .filter((annotation) => annotation.status === 'open' && annotation.taskId === taskId)
    .map((annotation) => annotation.id)
}
```

在 `packages/core/src/index.ts` 追加：

```ts
export * from './artifact/path.js'
export * from './delivery/guards.js'
export * from './annotation/resolve.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @baton/core test -- delivery-guards`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/artifact/path.ts packages/core/src/delivery/guards.ts packages/core/src/annotation/resolve.ts packages/core/src/index.ts packages/core/test/delivery-guards.test.ts
git commit -m "feat(core): add artifact path delivery guards and annotation resolution"
```

---

### Task 8: Core 交付画布阶段布局

Blocking: Task 2
Slice type: tracer-bullet
Seam: `arrangeDeliveryCanvas(input)`

**Files:**
- Create: `packages/core/src/canvas/delivery-layout.ts`
- Modify: `packages/core/src/canvas/index.ts`
- Test: `packages/core/test/delivery-layout.test.ts`

**Interfaces:**
- Consumes: `Node` from `@baton/protocol`。
- Produces: `CanvasNodeMove`（复用现有类型）、`arrangeDeliveryCanvas({ stages, nodes })`。

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/delivery-layout.test.ts
import type { Node } from '@baton/protocol'
import { describe, expect, it } from 'vitest'
import { arrangeDeliveryCanvas } from '../src/canvas/delivery-layout.js'

function group(id: string, stageKey: string, x: number, y: number): Node {
  return {
    id, canvasId: 'c1', type: 'group', x, y, w: 480, h: 360, groupId: null,
    createdAt: 1, updatedAt: 1, data: { label: stageKey, collapsed: false, stageKey },
  }
}
function child(id: string, groupId: string, x: number, y: number): Node {
  return {
    id, canvasId: 'c1', type: 'text', x, y, w: 320, h: 200, groupId,
    createdAt: 1, updatedAt: 1, data: { content: id },
  }
}

describe('arrangeDeliveryCanvas', () => {
  it('lays stages left-to-right and keeps children relative', () => {
    const nodes = [
      group('g1', 'requirement', 10, 10),
      child('c1', 'g1', 50, 80),
      group('g2', 'design', 600, 10),
      child('c2', 'g2', 640, 80),
    ]
    const moves = arrangeDeliveryCanvas({
      stages: [{ key: 'requirement', ordinal: 1 }, { key: 'design', ordinal: 2 }],
      nodes,
    })
    expect(moves).toContainEqual({ nodeId: 'g1', x: 80, y: 160 })
    expect(moves).toContainEqual({ nodeId: 'c1', x: 120, y: 240 })
    expect(moves).toContainEqual({ nodeId: 'g2', x: 620, y: 160 })
    expect(moves).toContainEqual({ nodeId: 'c2', x: 660, y: 240 })
  })

  it('ignores nodes without a matching stage group', () => {
    const moves = arrangeDeliveryCanvas({
      stages: [{ key: 'requirement', ordinal: 1 }],
      nodes: [group('g1', 'requirement', 10, 10), child('orphan', 'missing', 0, 0)],
    })
    expect(moves.some((move) => move.nodeId === 'orphan')).toBe(false)
  })

  it('does not mutate input', () => {
    const g = group('g1', 'requirement', 10, 10)
    arrangeDeliveryCanvas({ stages: [{ key: 'requirement', ordinal: 1 }], nodes: [g] })
    expect(g.x).toBe(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @baton/core test -- delivery-layout`
Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/canvas/delivery-layout.ts
import type { Node } from '@baton/protocol'
import type { CanvasNodeMove } from './layout.js'

const ORIGIN_X = 80
const ORIGIN_Y = 160
const STAGE_GAP_X = 540
const CHILD_OFFSET_X = 40
const CHILD_OFFSET_Y = 80
const CHILD_GAP_Y = 240
const CHILD_PER_ROW = 1

export function arrangeDeliveryCanvas(input: {
  stages: Array<{ key: string; ordinal: number }>
  nodes: Node[]
}): CanvasNodeMove[] {
  const moves: CanvasNodeMove[] = []
  const groupByStage = new Map<string, Node>()
  for (const node of input.nodes) {
    if (node.type === 'group' && node.data.stageKey) {
      groupByStage.set(node.data.stageKey, node)
    }
  }

  for (const stage of input.stages) {
    const group = groupByStage.get(stage.key)
    if (!group) continue
    const targetX = ORIGIN_X + (stage.ordinal - 1) * STAGE_GAP_X
    const targetY = ORIGIN_Y
    if (group.x !== targetX || group.y !== targetY) {
      moves.push({ nodeId: group.id, x: targetX, y: targetY })
    }
    const children = input.nodes.filter((node) => node.groupId === group.id)
    children.forEach((child, index) => {
      const x = targetX + CHILD_OFFSET_X + (index % CHILD_PER_ROW) * 360
      const y = targetY + CHILD_OFFSET_Y + Math.floor(index / CHILD_PER_ROW) * CHILD_GAP_Y
      if (child.x !== x || child.y !== y) moves.push({ nodeId: child.id, x, y })
    })
  }
  return moves
}
```

在 `packages/core/src/canvas/index.ts` 追加 `export * from './delivery-layout.js'`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @baton/core test -- delivery-layout`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/canvas/delivery-layout.ts packages/core/src/canvas/index.ts packages/core/test/delivery-layout.test.ts
git commit -m "feat(core): add delivery canvas stage layout"
```

---

### Task 9: Daemon schema 与 migration 0015

Blocking: Task 2
Slice type: tracer-bullet
Seam: `migrateDb` on fresh/old DB

**Files:**
- Modify: `apps/daemon/src/db/schema.ts`
- Create: `apps/daemon/migrations/0015_m7_delivery_playbook.sql`（由 drizzle-kit 生成，文件名以生成为准）
- Modify: `apps/daemon/test/migrate.test.ts`
- Create: `apps/daemon/test/migrate-m7.test.ts`

**Interfaces:**
- Consumes: Task 2 的实体字段。
- Produces: `delivery`、`artifact`、`annotation` 表；`canvas.deliveryId`；`task.deliveryId/stageKey/annotationIdsJson`。

- [ ] **Step 1: Write the failing migration test**

```ts
// apps/daemon/test/migrate-m7.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateDb, openDb } from '../src/db/index.js'

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

function tables(db: ReturnType<typeof openDb>): string[] {
  return (db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name <> '__drizzle_migrations' order by name").all() as Array<{ name: string }>)
    .map((row) => row.name)
}

describe('migration 0015', () => {
  it('creates delivery/artifact/annotation and nullable columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-m7-'))
    dirs.push(dir)
    const db = openDb(join(dir, 'baton.db'))
    migrateDb(db)
    const names = tables(db)
    expect(names).toEqual(expect.arrayContaining(['delivery', 'artifact', 'annotation']))
    const canvasColumns = db.prepare('pragma table_info(canvas)').all() as Array<{ name: string; notnull: number }>
    expect(canvasColumns.find((column) => column.name === 'delivery_id')?.notnull).toBe(0)
    const taskColumns = db.prepare('pragma table_info(task)').all() as Array<{ name: string; notnull: number }>
    expect(taskColumns.find((column) => column.name === 'delivery_id')?.notnull).toBe(0)
    expect(taskColumns.find((column) => column.name === 'stage_key')?.notnull).toBe(0)
    expect(taskColumns.find((column) => column.name === 'annotation_ids_json')?.notnull).toBe(0)
    db.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evanfang0054/baton test -- migrate-m7`
Expected: FAIL，表/列不存在。

- [ ] **Step 3: Update schema and generate migration**

`apps/daemon/src/db/schema.ts`：

- `canvas` 加 `deliveryId: text('delivery_id')`，索引 `uniqueIndex('canvas_delivery_idx').on(t.deliveryId)`。
- `task` 加 `deliveryId: text('delivery_id')`、`stageKey: text('stage_key')`、`annotationIdsJson: text('annotation_ids_json')`，索引 `index('task_delivery_idx').on(t.deliveryId, t.stageKey)`。
- 新增 `delivery`、`artifact`、`annotation` 表（字段与 spec §7.1 一致）。

```ts
export const delivery = sqliteTable(
  'delivery',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id),
    canvasId: text('canvas_id').notNull().references(() => canvas.id),
    title: text('title').notNull(),
    goal: text('goal').notNull(),
    playbookId: text('playbook_id').notNull(),
    playbookVersion: integer('playbook_version').notNull(),
    playbookJson: text('playbook_json').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    cancelledAt: integer('cancelled_at'),
  },
  (t) => [
    uniqueIndex('delivery_canvas_idx').on(t.canvasId),
    index('delivery_workspace_idx').on(t.workspaceId, t.createdAt),
  ],
)

export const artifact = sqliteTable(
  'artifact',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id),
    deliveryId: text('delivery_id').notNull().references(() => delivery.id),
    stageKey: text('stage_key').notNull(),
    taskId: text('task_id').references(() => task.id),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    sourcePath: text('source_path'),
    svgPath: text('svg_path'),
    mime: text('mime'),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    version: integer('version').notNull().default(1),
    status: text('status').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('artifact_name_idx').on(t.deliveryId, t.stageKey, t.name),
    index('artifact_delivery_idx').on(t.deliveryId, t.stageKey, t.createdAt),
  ],
)

export const annotation = sqliteTable(
  'annotation',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id),
    deliveryId: text('delivery_id').notNull().references(() => delivery.id),
    stageKey: text('stage_key').notNull(),
    targetNodeIdsJson: text('target_node_ids_json').notNull().default('[]'),
    targetArtifactId: text('target_artifact_id').references(() => artifact.id),
    note: text('note').notNull().default(''),
    strokesJson: text('strokes_json').notNull(),
    bboxJson: text('bbox_json').notNull(),
    imagePath: text('image_path').notNull(),
    status: text('status').notNull(),
    taskId: text('task_id').references(() => task.id),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    index('annotation_delivery_idx').on(t.deliveryId, t.stageKey, t.status, t.createdAt),
    index('annotation_task_idx').on(t.taskId),
  ],
)
```

生成迁移：

```bash
cd apps/daemon
pnpm exec drizzle-kit generate --name m7_delivery_playbook
```

- 确认生成的文件是下一个序号（期望 `0015_m7_delivery_playbook.sql`）；若 drizzle-kit 使用随机名，保留生成 tag 并更新本计划/ADR 中的文件名引用。
- 检查 SQL 只包含新增表/列/索引，没有 drop/alter 旧列。
- 把 `_journal.json` 的新条目保留。

- [ ] **Step 4: Run migration tests and update exact schema assertions**

Run:

```bash
pnpm --filter @evanfang0054/baton test -- migrate-m7
pnpm --filter @evanfang0054/baton test -- migrate
```

`apps/daemon/test/migrate.test.ts` 的精确断言会因新增表/索引失败；按生成 SQL 更新：

- 表数量 `21` → `24`。
- 索引列表追加：`annotation_delivery_idx`、`annotation_task_idx`、`artifact_delivery_idx`、`artifact_name_idx`、`canvas_delivery_idx`、`delivery_canvas_idx`、`delivery_workspace_idx`、`task_delivery_idx`。
- 追加列断言：`canvas.delivery_id`、`task.delivery_id`、`task.stage_key`、`task.annotation_ids_json` 均 `notnull=0`。
- 旧库升级测试仍通过：旧 canvas/task 的 `delivery_id` 为 null。

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/db/schema.ts apps/daemon/migrations apps/daemon/test/migrate.test.ts apps/daemon/test/migrate-m7.test.ts
git commit -m "feat(daemon): add delivery artifact annotation schema and migration 0015"
```

---

### Task 10: 全量验证、文档索引与计划收口

Blocking: Task 1-9
Slice type: verification
Seam: `pnpm verify` + plan status

**Files:**
- Modify: `docs/README.md`（现行 plan 加 M7-1）
- Modify: `docs/plans/2026-11-22-m7-1-protocol-core-migration.md`（status）
- Test: 无新增；跑全量

- [ ] **Step 1: Update docs index**

在 `docs/README.md` 的“现行 plan”末尾追加：

```md
- [M7 交付工作台执行图](plans/2026-11-22-m7-0-execution-map.md)
- [M7-1 protocol + core + migration 0015 实施计划](plans/2026-11-22-m7-1-protocol-core-migration.md)
```

- [ ] **Step 2: Run package tests**

```bash
pnpm --filter @baton/protocol test
pnpm --filter @baton/core test
pnpm --filter @evanfang0054/baton test
```

Expected: 全绿。

- [ ] **Step 3: Run full verification**

```bash
pnpm verify
```

Expected: typecheck / lint / format / boundaries / protocol / tests / build 全绿。若 format 失败，先 `pnpm exec prettier --write` 本次改动文件。

- [ ] **Step 4: Update plan status**

把本文件 frontmatter 的 `status: active` 改为 `status: completed`；`docs/plans/2026-11-22-m7-0-execution-map.md` 的“当前状态”改为“M7-1 已完成，M7-2 待创建”。

- [ ] **Step 5: Commit**

```bash
git add docs/README.md docs/plans/2026-11-22-m7-1-protocol-core-migration.md docs/plans/2026-11-22-m7-0-execution-map.md
git commit -m "docs(plan): complete M7-1 protocol core migration"
```

---

## Plan 收口检查

- [ ] `pnpm verify` 真实输出已贴到执行记录。
- [ ] 新增 protocol/core 测试覆盖 DoD 1/4/5/6/7/8/9/20。
- [ ] migration 0015 在空库与旧库上均可升级；旧 canvas/task `delivery_id=null`。
- [ ] 新 node 类型不触发 exhaustive switch 错误；core/daemon/web typecheck 通过。
- [ ] 没有 TODO/FIXME；没有越界实现 daemon service/web 画布对象（留给 Plan 2/3）。
