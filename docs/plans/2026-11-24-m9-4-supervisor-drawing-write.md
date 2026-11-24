---
spec_ref: ../specs/2026-11-24-canvas-drawing-scope-design.md
spec_topic: canvas-drawing-scope
task_count: 4
estimated_phases: [tests, implementation, verification]
dod: "总管可创建/编辑画板、插入工作区图片、写限制生效；previewStale 驱动后台预览；编辑器冲突横幅可用；pnpm verify 通过"
status: completed
depends_on: 2026-11-24-m9-3-supervisor-scope-read.md
---

# M9-4 总管画板写入实施计划

**Goal:** 让总管拥有与用户一致的画板写能力，同时用 source-only 写入、previewStale 和浏览器后台渲染保证画板内容与缩略图不丢。

**Architecture:** `packages/core` 提供纯函数 `applyDrawingOperations`；daemon 新增 `drawing-service` 负责路径校验、图片解析、串行队列、审计和 `previewStale`；supervisor 增加 `create_drawing/update_drawing`；web 增加画板工具卡、后台预览队列和编辑器冲突横幅。

---

### Task 1: 场景写入纯函数 + 协议

Blocking: none  
Slice type: tracer-bullet  
Seam: `applyDrawingOperations` + `DrawingOperation`

**Files:**
- Modify: `packages/core/src/drawing/scene.ts`
- Create: `packages/protocol/src/drawing.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/core/test/drawing-scene.test.ts`

- [x] **Step 1: 写失败测试**

- 新增文字/矩形/椭圆/箭头/图片；矩形标签与箭头绑定；更新标签随形状移动；软删除；元素/文本上限。

- [x] **Step 2: 实现**

- `createEmptyScene()`、`applyDrawingOperations(scene, ops, {newId, now, limits})`；图片只通过注入的解析结果进入 scene，不在 core 读文件。
- `DrawingOperation` zod discriminated union；`SupervisorDrawingCard` 协议。
- 失败使用 `DrawingOperationError` 携带 `drawing_operation_invalid|drawing_too_many_elements|drawing_too_large`。

- [x] **Step 3: 运行通过**

Run: `pnpm --filter @baton/core test`

---

### Task 2: daemon 画板写入服务

Blocking: Task 1  
Slice type: tracer-bullet  
Seam: `createDrawingService`

**Files:**
- Create: `apps/daemon/src/artifact/drawing-service.ts`
- Modify: `apps/daemon/src/artifact/service.ts`
- Test: `apps/daemon/test/drawing-service.test.ts`

- [x] **Step 1: 写失败测试**

- 创建画板节点 + source + 审计 + `previewStale` 事件；并发 mutation 串行；工作区图片尺寸写入；拒绝绝对路径/越界/敏感文件/缺失/非图片；拒绝跨需求与未知阶段。

- [x] **Step 2: 实现**

- `createDrawing({deliveryId, stageKey, title?, operations?})`：draft artifact → 空/初始 scene source → 画布 drawing 节点 → `updateDrawingSource(previewStale=true)` → 审计。
- `mutateDrawing({artifactId, operations})`：按 artifact 串行；读 source → apply → 写回 → 审计。
- `addImage`：`resolveWithin` + `isSensitivePath` + MIME 白名单 + 5MB 上限；PNG/GIF/JPEG 读取尺寸，WebP 用默认尺寸。
- `ArtifactService.updateDrawingSource`：更新 `updatedAt`、同步节点 `previewStale`、广播 `artifact.updated(previewStale)`；不影响编辑器 source-only 自动保存。

- [x] **Step 3: 运行通过**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/drawing-service.test.ts`

---

### Task 3: 总管工具与 runtime

Blocking: Task 2  
Slice type: tracer-bullet  
Seam: `create_drawing/update_drawing`

**Files:**
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Modify: `apps/daemon/src/supervisor/service.ts`
- Modify: `apps/daemon/src/supervisor/engine.ts`
- Modify: `apps/daemon/src/supervisor/prompt.ts`
- Modify: `apps/daemon/src/runtime/index.ts`
- Modify: `packages/core/src/supervisor/policy.ts`
- Test: `apps/daemon/test/supervisor-scope-tools.test.ts`
- Test: `apps/daemon/test/supervisor-prompt.test.ts`

- [x] **Step 1: 写失败测试**

- 在需求作用域创建/更新画板；跨需求写拒绝；无需求拒绝；prompt 工具数 32。

- [x] **Step 2: 实现**

- `create_drawing` 要求当前 `deliveryId + stageKey`；`update_drawing` 只允许当前需求的节点/产物。
- 工具总数 32；prompt 增加画板写入与图片路径规则，长度仍 ≤ 3,840。
- runtime 注入 `drawingServiceHolder`；service/engine 暴露两个新工具。

- [x] **Step 3: 运行通过**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/supervisor-scope-tools.test.ts test/supervisor-prompt.test.ts`

---

### Task 4: web 预览与冲突

Blocking: Task 3  
Slice type: tracer-bullet  
Seam: `previewQueue` + `drawing-store` + 工具卡

**Files:**
- Create: `apps/web/src/features/drawings/preview-renderer.ts`
- Create: `apps/web/src/features/drawings/drawing-store.ts`
- Modify: `apps/web/src/features/drawings/DrawingEditor.tsx`
- Modify: `apps/web/src/features/realtime/RealtimeProvider.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/features/supervisor/SupervisorDrawingCard.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorMessage.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorMessageList.tsx`
- Modify: `apps/web/src/features/supervisor/SupervisorPanel.tsx`
- Test: `apps/web/src/features/drawings/preview-renderer.test.ts`
- Test: `apps/web/src/features/drawings/DrawingEditor.test.tsx`
- Test: `apps/web/src/features/supervisor/SupervisorDrawingCard.test.tsx`
- Test: `apps/web/src/features/supervisor/SupervisorMessage.test.tsx`

- [x] **Step 1: 写失败测试**

- 预览队列去重、跳过编辑中画板、失败重试；冲突横幅可保留本地或加载最新；画板工具卡显示计数并打开。

- [x] **Step 2: 实现**

- `previewQueue`：动态加载 Excalidraw，source → `exportToBlob` → `mode='preview'`；同 artifact 去重、最多重试 2 次、编辑中跳过。
- `RealtimeProvider` 在 `artifact.updated.previewStale` 时入队或标记冲突；App 加载需求画布时补渲染 stale 预览。
- `DrawingEditor` 注册编辑态；冲突横幅；`加载最新` 调 `updateScene`，`保留本地` 清冲突。
- 总管消息渲染画板卡，点击后切到对应需求并打开画板。

- [x] **Step 3: 运行通过**

Run: `pnpm --filter @baton/web exec vitest run src/features/drawings src/features/supervisor`

---

### Task 5: 回归

Blocking: Task 4

- [x] **Step 1: `pnpm verify` 全绿**

- [x] **Step 2: `delivery.spec` + `supervisor.spec` 通过**

- [x] **Step 3: 记录完成状态并提交**

---

## 本 plan 完成标准

- 总管可创建/编辑当前需求画板，图片只能来自工作区相对路径。
- 写入有元素/文本/图片大小限制，串行且带审计。
- `previewStale` 驱动浏览器后台预览；编辑器出现冲突横幅。
- `pnpm verify` 通过。
