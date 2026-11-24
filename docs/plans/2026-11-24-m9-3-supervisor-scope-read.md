---
spec_ref: ../specs/2026-11-24-canvas-drawing-scope-design.md
spec_topic: canvas-drawing-scope
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: "supervisor.send 携带 deliveryId/stageKey；总管读写跟随当前需求；list_canvas 可读其他需求；get_drawing 返回画板全部可读内容；无需求时画布工具明确报错；pnpm verify 通过"
status: completed
depends_on: 2026-11-24-m9-2-drawing-editor-thumbnail.md
---

# M9-3 总管作用域与读取实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use `- [ ]` syntax for tracking.

**Goal:** 总管从“工作区画布助手”升级为“当前需求画布助手”：读写跟随当前需求，能读画板全部内容，也能按需读其他需求。

**Architecture:** 协议在 `supervisor.send`/消息 meta 上增加 `deliveryId/stageKey`；daemon 用交付画布解析目标与上下文，任务写入交付归属；新增 `get_drawing` 与 `list_canvas` scope；前端把当前需求作用域随消息发送并在重试时保留。

**Tech Stack:** Fastify 5、zod、Drizzle、React 19、TanStack Query、vitest。

---

### Task 1: 协议作用域 + 任务落库

Blocking: none  
Slice type: tracer-bullet  
Seam: `SupervisorSendInput` + TaskService delivery canvas

**Files:**
- Modify: `packages/protocol/src/supervisor.ts`
- Modify: `apps/daemon/src/runtime/task-service.ts`
- Test: `packages/protocol/test/delivery.test.ts`
- Test: `apps/daemon/test/task-service.test.ts`

**Interfaces:**
- `SupervisorSendInput` 增加 `deliveryId?: Id`、`stageKey?: string(1..32)`。
- `SupervisorMessageMeta` 增加 `deliveryId: Id.nullable().default(null)`、`stageKey: string.nullable().default(null)`。
- TaskService：目标节点所在画布作为 context 画布；任务行写入 `deliveryId/stageKey`。

- [x] **Step 1: 写失败测试**

- 协议：send input 可带 delivery/stage；消息 meta 旧数据缺字段时默认 null。
- 任务：在交付画布上创建 Agent 节点 + text 节点，createTask 指定 deliveryId/stageKey，任务落库且 context 节点来自交付画布。

- [x] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/protocol test && pnpm --filter @evanfang0054/baton exec vitest run test/task-service.test.ts`

- [x] **Step 3: 实现**

- TaskService 用 `getNode(input.nodeId)` 的画布取 nodes/edges，不再固定 workspace 画布。
- `insertTask` 写入 `deliveryId/stageKey`。
- 协议字段可选/默认，旧消息兼容。

- [x] **Step 4: 运行并确认通过**

Run: 同 Step 2。

- [x] **Step 5: 提交**

```bash
git add packages/protocol/src apps/daemon/src/runtime/task-service.ts packages/protocol/test apps/daemon/test
git commit -m "feat(protocol): scope supervisor sends and tasks to a requirement"
```

---

### Task 2: daemon 总管作用域与目标解析

Blocking: Task 1  
Slice type: tracer-bullet  
Seam: `ToolContext.deliveryId` + `createTargetResolver.canvasFor`

**Files:**
- Modify: `apps/daemon/src/supervisor/target.ts`
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Modify: `apps/daemon/src/supervisor/service.ts`
- Test: `apps/daemon/test/supervisor-tools.test.ts`
- Test: `apps/daemon/test/supervisor-delivery-tools.test.ts`

**Interfaces:**
- `TargetContext` / `ToolContext` 增加 `deliveryId: string | null`、`stageKey: string | null`、`allowWorkspaceCanvas?: boolean`。
- `canvasFor`：有 deliveryId 用交付画布；否则仅 `allowWorkspaceCanvas=true` 回退工作区画布，生产路径传 false → `canvas_not_found`「先选择一个需求」。
- `createTaskForTool` 与批量建任务写入 `deliveryId/stageKey`。
- 服务端校验 delivery 属于 workspace、stageKey 属于 playbook；候选卡增加 `<canvas_scope scope delivery stage />`。

- [x] **Step 1: 写失败测试**

- 无 deliveryId 且 `allowWorkspaceCanvas=false` 时 `create_text`/`list_canvas` 抛「先选择一个需求」。
- 有 deliveryId 时 `create_text` 落在交付画布；`create_task` 落库带 delivery/stage。
- 工具测试的 ctx 增加 `allowWorkspaceCanvas: true` 保持既有用例。

- [x] **Step 2: 运行并确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/supervisor-tools.test.ts test/supervisor-delivery-tools.test.ts`

- [x] **Step 3: 实现**

- 解析器只做画布选择；不要复制交付校验。
- 服务端从 `SupervisorSendInput` 读取作用域，写入 ToolContext 与候选卡。
- 任务创建 helper 统一注入 `ctx.deliveryId/stageKey`。

- [x] **Step 4: 运行并确认通过**

Run: 同 Step 2。

- [x] **Step 5: 提交**

```bash
git add apps/daemon/src/supervisor apps/daemon/test/supervisor-tools.test.ts apps/daemon/test/supervisor-delivery-tools.test.ts
git commit -m "feat(daemon): scope supervisor tools to the current requirement"
```

---

### Task 3: `list_canvas` 跨需求 + `get_drawing` + prompt

Blocking: Task 2  
Slice type: tracer-bullet  
Seam: `list_canvas(scope)` + `get_drawing`

**Files:**
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Modify: `apps/daemon/src/supervisor/canvas-summary.ts`
- Modify: `apps/daemon/src/supervisor/engine.ts`
- Modify: `apps/daemon/src/supervisor/prompt.ts`
- Modify: `apps/daemon/src/supervisor/service.ts`（传 artifacts）
- Modify: `apps/daemon/src/runtime/index.ts`（artifacts 注入）
- Test: `apps/daemon/test/supervisor-tools.test.ts`
- Test: `apps/daemon/test/supervisor-prompt.test.ts`

**Interfaces:**
- `list_canvas({ limit?, scope?: 'current'|'delivery', deliveryId? })`；默认当前；跨需求校验 workspace。
- `get_drawing({ nodeId?, artifactId?, offset?, limit? })` → `{ artifactId, title, updatedAt, texts, elements, counts, totalTexts, totalElements, bounds, truncated, nextOffset? }`；不含 base64。
- `nodeSummary` 文本增加 `content`（≤2000 字）；drawing 保留 artifactId/status。
- 工具总数 30；prompt 增加作用域/画板规则。

- [x] **Step 1: 写失败测试**

- `list_canvas` 当前交付只返回当前画布；指定 deliveryId 返回另一需求。
- `get_drawing` 读取 source → texts/elements/counts/bounds；无 source 返回 empty；不返回 base64。
- prompt/engine 包含 `get_drawing` 且工具数 30。

- [x] **Step 2: 运行并确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/supervisor-tools.test.ts test/supervisor-prompt.test.ts`

- [x] **Step 3: 实现**

- tools 增加 `deps.artifacts?: () => ArtifactService`，runtime 注入。
- `get_drawing` 用 `readArtifactContent` + `extractDrawingContent`。
- `list_canvas` 只读 scope 画布；文本 content 截断 2000。

- [x] **Step 4: 运行并确认通过**

Run: 同 Step 2。

- [x] **Step 5: 提交**

```bash
git add apps/daemon/src/supervisor apps/daemon/src/runtime/index.ts apps/daemon/test
git commit -m "feat(daemon): add scoped canvas reads and get_drawing"
```

---

### Task 4: Web 随消息发送作用域

Blocking: Task 1  
Slice type: tracer-bullet  
Seam: `SupervisorPanel`/`SupervisorComposer` payload + retry meta

**Files:**
- Modify: `apps/web/src/features/supervisor/SupervisorPanel.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorComposer.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/features/supervisor/SupervisorComposer.test.tsx`
- Test: `apps/web/src/features/supervisor/SupervisorPanel.test.tsx`

**Interfaces:**
- Panel/Composer props：`deliveryId?: string | null`、`stageKey?: string | null`、`scopeLabel: string`。
- `supervisor.send` 携带 delivery/stage；乐观 meta 与重试 meta 保留；作用域芯片显示「项目 / 需求 · 阶段」。
- App 传当前 `activeDeliveryId` 与 `delivery.data?.currentStageKey`；无需求显示项目作用域。

- [x] **Step 1: 写失败测试**

- Composer 发送时 payload 含 deliveryId/stageKey；无需求时不带。
- Panel 重试使用原消息 meta 的作用域；芯片显示标签。

- [x] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/supervisor/SupervisorComposer.test.tsx src/features/supervisor/SupervisorPanel.test.tsx`

- [x] **Step 3: 实现**

- 只在 deliveryId 存在时发送 delivery/stage；不得发送 half scope。
- 旧消息 meta 缺失时视为项目作用域。

- [x] **Step 4: 运行并确认通过**

Run: 同 Step 2。

- [x] **Step 5: 提交**

```bash
git add apps/web/src/features/supervisor apps/web/src/App.tsx
git commit -m "feat(web): send requirement scope with supervisor messages"
```

---

### Task 5: 回归

Blocking: Task 3 + 4  
Slice type: verification  
Seam: `pnpm verify` + supervisor e2e

- [x] **Step 1: 运行全量 verify**

Run: `pnpm verify`

- [x] **Step 2: 运行 supervisor/delivery e2e smoke**

Run: `pnpm exec playwright test apps/web/e2e/delivery.spec.ts apps/web/e2e/supervisor.spec.ts`

- [x] **Step 3: 记录完成状态并提交**

```bash
git add docs/plans/2026-11-24-m9-3-supervisor-scope-read.md docs/plans/2026-11-24-m9-0-execution-map.md
git commit -m "test: verify M9-3 supervisor scope and drawing reads"
```

---

## 本 plan 完成标准

- 总管读写跟随当前需求；无需求时画布工具明确报错。
- `list_canvas` 可读其他需求；`get_drawing` 返回画板全部可读内容。
- Web 消息与重试都保留作用域；芯片可见。
- `pnpm verify` 与定向 e2e 通过。
