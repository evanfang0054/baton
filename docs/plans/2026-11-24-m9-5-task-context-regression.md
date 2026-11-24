---
spec_ref: ../specs/2026-11-24-canvas-drawing-scope-design.md
spec_topic: canvas-drawing-scope
task_count: 4
estimated_phases: [tests, implementation, verification]
dod: "画板可投喂并进入任务上下文；20 条 contract DoD 逐条核对；legacy e2e 全部迁移；pnpm verify:full 通过；ego-lite 证据落盘"
status: completed
depends_on: 2026-11-24-m9-2-drawing-editor-thumbnail.md, 2026-11-24-m9-4-supervisor-drawing-write.md
---

# M9-5 任务上下文与契约回归实施计划

**Goal:** 把画板接进任务上下文与投喂链路，迁移全部 legacy 画布 e2e，并用真实浏览器证据和 20 条 contract DoD 收口。

**Architecture:** `NodeType` 补齐 `artifact|drawing`；core `assembleContext` 渲染 drawing 文字；daemon `buildContextContent` 注入画板预读；web 投喂白名单加入 drawing；e2e 用需求画布与 `mockDelivery` 迁移；ego-lite 验证真实缩略图与编辑器渲染。

---

### Task 1: NodeType 与画板上下文

Blocking: none  
Slice type: tracer-bullet  
Seam: `NodeType` + `assembleContext` + `buildContextContent`

**Files:**
- Modify: `packages/protocol/src/enums.ts`
- Modify: `packages/core/src/context/assemble.ts`
- Modify: `apps/daemon/src/workspace/context.ts`
- Modify: `apps/daemon/src/runtime/task-service.ts`
- Modify: `apps/daemon/src/runtime/context-service.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `apps/daemon/src/supervisor/target.ts`
- Modify: `apps/web/src/stores/app.ts`
- Modify: `apps/web/src/features/canvas/CanvasPanel.tsx`
- Modify: `apps/web/src/features/tasks/ReviewCard.tsx`
- Modify: `apps/web/src/features/tasks/ContextSnapshotCard.tsx`
- Test: `packages/core/test/context.test.ts`
- Test: `apps/daemon/test/context-input.test.ts`
- Test: `apps/daemon/test/task-service.test.ts`
- Test: `apps/daemon/test/context-service.test.ts`

- [x] **Step 1: 写失败测试**

- drawing 节点进入 context 输出文字，空内容回退 `[画板] title`；source 不可读输出「画板内容不可读」；任务与注入都包含画板文字，投喂白名单包含 drawing。

- [x] **Step 2: 实现**

- `NodeType` 加 `artifact|drawing`；`isContentNode`/`renderContent` 支持 drawing。
- `buildContextContent` 增加 `readDrawingContent` 回调；runtime 用 artifact source + `extractDrawingContent`。
- web 投喂白名单（store/CanvasPanel/ReviewCard）加入 drawing。

- [x] **Step 3: 运行通过**

Run: `pnpm --filter @baton/core test && pnpm --filter @evanfang0054/baton exec vitest run test/context-input.test.ts test/task-service.test.ts test/context-service.test.ts`

---

### Task 2: 迁移 legacy 画布 e2e

Blocking: Task 1  
Slice type: verification  
Seam: `mockDelivery` + requirement deep link

**Files:**
- Modify: `apps/web/e2e/m6-helpers.ts`
- Modify: `apps/web/e2e/canvas-context.spec.ts`
- Modify: `apps/web/e2e/canvas-group.spec.ts`
- Modify: `apps/web/e2e/context-injection.spec.ts`
- Modify: `apps/web/e2e/handoff.spec.ts`
- Modify: `apps/web/e2e/task-scene.spec.ts`
- Modify: `apps/web/e2e/acceptance-evidence.spec.ts`
- Modify: `apps/web/e2e/automation.spec.ts`
- Modify: `apps/web/e2e/mobile-controls.spec.ts`
- Modify: `apps/web/src/features/deliveries/DeliveryCanvas.tsx`
- Modify: `apps/web/src/features/canvas/MobileNodeManager.tsx`

- [x] **Step 1: mock 需求数据**

- `mockWorkspace` 返回 delivery/detail/artifacts/attention；任务 fixture 带 `deliveryId/stageKey`；所有 legacy 画布 spec 使用 `?workspace=w1&delivery=d1`。

- [x] **Step 2: 修复交互差异**

- Agent 无任务时双击打开 NodePanel（有任务时打开任务）。
- 画布测试隐藏浮层需求卡，避免 fitView 后节点被遮挡。
- 移除移动端手动新建文本入口，测试改为断言入口不存在。

- [x] **Step 3: 运行通过**

Run: `pnpm exec playwright test apps/web/e2e/{canvas-context,canvas-group,context-injection,handoff,task-scene,acceptance-evidence,automation,mobile-controls}.spec.ts`

---

### Task 3: 画板端到端回归

Blocking: Task 2  
Slice type: verification  
Seam: `drawing.spec.ts`

**Files:**
- Create: `apps/web/e2e/drawing.spec.ts`

- [x] **Step 1: 覆盖关键链路**

- 项目 → 需求 → 画板缩略图 → 双击编辑器 → 保存关闭 → 刷新后仍在。
- 总管画板工具卡 → 打开画板。
- 编辑器收到 `artifact.updated(previewStale=true)` 显示冲突横幅，可保留本地。
- stale 节点触发浏览器 `exportToBlob` 并 `mode='preview'` 保存。

- [x] **Step 2: 运行通过**

Run: `pnpm exec playwright test apps/web/e2e/drawing.spec.ts`

---

### Task 4: 契约核对与证据

Blocking: Task 3

- [x] **Step 1: 20 条 contract DoD 逐条核对并勾选。**

- [x] **Step 2: `pnpm verify:full` 全绿。**

- [x] **Step 3: ego-lite 证据**

- 真实 daemon + 临时数据目录；项目树、画板缩略图、编辑器文字/形状/箭头/图片、保存关闭、刷新后缩略图。
- 证据落盘 `docs/evidence/2026-11-24-m9-5/`。
- 冲突横幅与总管画板卡由 Playwright `drawing.spec.ts` 覆盖。

- [x] **Step 4: 记录完成状态并提交。**

---

## 本 plan 完成标准

- 画板可投喂、进入任务上下文与注入记录。
- 全部 legacy 画布 e2e 迁移到需求画布并通过。
- 20 条 contract DoD 有测试或证据支撑。
- `pnpm verify:full` 通过；ego-lite 证据落盘。
