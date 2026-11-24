---
spec_ref: ../specs/2026-11-24-canvas-drawing-scope-design.md
spec_topic: canvas-drawing-scope
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: "左栏为通知+项目树且无全部项目/项目画布；需求画布唯一；顶部无项目切换器；工具栏无文本/图片按钮且无拖拽上传；通知跨项目聚合；pnpm verify 通过"
status: active
---

# M9-1 画布壳与内容入口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use `- [ ]` syntax for tracking.

**Goal:** 把导航收敛为「通知 + 多项目树 → 需求画布」，并把画布内容入口收敛为画板；本 plan 不改画板编辑器与缩略图（M9-2）。

**Architecture:** 后端新增只读注意力聚合接口；前端新增 `ProjectTree` 取代 `DeliveryRail`，App 删除 workspace 画布与项目切换器，主区只渲染需求画布/需求看板/任务看板/空态。工具栏删除文本/图片与拖拽上传，新增画板按钮，沿用现有 `createDrawing`。

**Tech Stack:** React 19 + Zustand + TanStack Query + HeroUI v3 + Fastify 5 + Drizzle/SQLite + vitest。

---

### Task 1: 跨项目注意力聚合 API

Blocking: none  
Slice type: tracer-bullet  
Seam: `GET /api/attention`

**Files:**
- Create: `apps/daemon/src/attention/service.ts`
- Create: `apps/daemon/src/http/attention.ts`
- Modify: `apps/daemon/src/app.ts`（注册路由）
- Modify: `packages/protocol/src/api.ts`（`AttentionListResponse`）
- Test: `apps/daemon/test/attention-service.test.ts`
- Test: `apps/daemon/test/attention-rest.test.ts`

**Interfaces:**
- `AttentionInboxItem = { workspaceId, workspaceName, deliveryId, deliveryTitle, stageKey, taskId, title, kind, waitingSince }`
- `AttentionInboxResponse = { items: AttentionInboxItem[]; total: number }`
- `createAttentionService({ db, now })` → `list(limit: number): { items: AttentionInboxItem[]; total: number }`
- `GET /api/attention?limit=20`；`limit` 1..50，默认 20。

- [x] **Step 1: 写失败测试**

`attention-service.test.ts` 构造两个 workspace、若干 task：

```ts
// 只统计 deliveryId 非空、needsPerson 为真的任务
// 排序：waitingSince 升序 → updatedAt 降序 → id
// limit 生效；返回 workspaceName/deliveryTitle/stageKey
// deliveryId 为空的任务不出现
```

`attention-rest.test.ts` 断言 200、schema、limit 参数和非法 limit 的错误。

- [x] **Step 2: 运行并确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/attention-service.test.ts test/attention-rest.test.ts`

Expected: FAIL，`createAttentionService`/路由不存在。

- [x] **Step 3: 实现**

- `attention/service.ts`：`listWorkspaces` → 每个 workspace `listTasks` → 过滤 `task.deliveryId` → `attentionFor(task.status, task.waitingReason)` + `needsPerson` + `listAcceptanceSummaries`（fail>0 也算）→ `getDelivery`/`getWorkspace` 补标题 → 排序、截断。
- `http/attention.ts`：薄路由，`AttentionListResponse.parse`。
- `packages/protocol/src/api.ts` 增加 schema；`app.ts` 注册。
- 不新增表、不写事件、不做已读状态。

- [x] **Step 4: 运行并确认通过**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/attention-service.test.ts test/attention-rest.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add apps/daemon/src/attention apps/daemon/src/http/attention.ts apps/daemon/src/app.ts packages/protocol/src/api.ts apps/daemon/test/attention-service.test.ts apps/daemon/test/attention-rest.test.ts
git commit -m "feat(daemon): add cross-project attention endpoint"
```

---

### Task 2: ProjectTree 与通知区

Blocking: Task 1  
Slice type: tracer-bullet  
Seam: `ProjectTree` props + `listAttention`

**Files:**
- Create: `apps/web/src/features/projects/ProjectTree.tsx`
- Create: `apps/web/src/features/projects/ProjectTree.test.tsx`
- Modify: `apps/web/src/lib/api.ts`（`listAttention`）
- Modify: `apps/web/src/lib/query.ts`（`queryKeys.attention`）
- Modify: `apps/web/src/stores/app.ts`（`deliveryView` 默认 `canvas`；`setWorkspace` 不再强制 board）
- Modify: `apps/web/src/App.tsx`（用 ProjectTree 替换 DeliveryRail；传 attention）
- Delete: `apps/web/src/features/deliveries/DeliveryRail.tsx`（无独立测试文件）

**Interfaces:**
- `ProjectTree({ workspaces, attention, activeWorkspaceId, activeDeliveryId, deliveryView, onCreateProject, onCreateDelivery, onOpenBoard, onOpenDelivery, onOpenAttention })`
- 展开状态本地 `Set<string>`；`useQueries` 按 `queryKeys.deliveries(workspaceId)` 懒加载。
- 点项目名/箭头只 toggle 展开；点「需求看板」→ `onOpenBoard(workspaceId)`；点需求 → `onOpenDelivery(workspaceId, deliveryId)`；点「新建需求」→ `onCreateDelivery(workspaceId)`；点通知项 → `onOpenAttention(item)`。
- 项目行有通知时显示圆点；通知区空态「没有需要你处理的」。

- [ ] **Step 1: 写失败测试**

`ProjectTree.test.tsx`：

```ts
// 渲染「通知」「项目」；不存在「全部项目」「项目画布」
// 点项目名只展开，不触发 onOpenBoard/onOpenDelivery
// 展开后请求 listDeliveries(workspaceId)；收起后保留缓存但不重复请求
// 点需求触发 onOpenDelivery(workspaceId, deliveryId)
// 点需求看板触发 onOpenBoard(workspaceId)
// 通知项渲染标题与等待时长；点条目触发 onOpenAttention
// 无通知时显示「没有需要你处理的」
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/projects/ProjectTree.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现**

- `ProjectTree` 左侧固定 `w-72`，深色 token：`bg-surface`/`border-separator`/`text-muted`/`text-foreground`。
- 项目行：`aria-expanded`、chevron 旋转、`role="tree"`/`treeitem`。
- 需求行复用 `DeliveryCard` compact；选中态 `ring-1 ring-accent`。
- `queryKeys.attention = ['attention']`；`listAttention(limit=20)` 解析 `AttentionListResponse`。
- App 用 `useQuery({ queryKey: queryKeys.attention, queryFn: () => listAttention(20) })`，传给 ProjectTree。
- `deliveryView` 默认改为 `'canvas'`；`setWorkspace` 设为 `'canvas'`；选择需求看板时 `setWorkspace(id); setDeliveryView('board')`。
- 通知点击在 App 中处理：`setWorkspace(workspaceId); setDelivery(deliveryId); openStage(taskId)`。
- 删除 `DeliveryRail` 的引用；保留 `DeliveryCard`。

- [ ] **Step 4: 运行并确认通过**

Run: `pnpm --filter @baton/web exec vitest run src/features/projects/ProjectTree.test.tsx src/features/deliveries`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/projects apps/web/src/lib/api.ts apps/web/src/lib/query.ts apps/web/src/stores/app.ts apps/web/src/App.tsx apps/web/src/features/deliveries
git commit -m "feat(web): add multi-project tree with attention inbox"
```

---

### Task 3: 需求画布唯一 + 面包屑 + 空态

Blocking: Task 2  
Slice type: refactor  
Seam: App main-view conditions + breadcrumb

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/features/deliveries/DeliveryBoard.tsx`（如需按项目标题/空态）
- Modify: `apps/web/src/features/deliveries/CreateDeliveryDialog.tsx`（使用传入 workspaceId，文案「新建需求」）
- Modify: `apps/web/src/features/workspaces/CreateWorkspaceDialog.tsx`（文案「新建项目」）
- Modify: `apps/web/src/features/workspaces/WorkspaceTrustBadge.tsx` / `WorkspaceTrustDialog.tsx`（文案「项目」）
- Delete/停止引用: `apps/web/src/features/workspaces/WorkspaceSwitcher.tsx`（App 不再使用）
- Test: `apps/web/src/App.test.tsx`（已存在，更新）

**Interfaces:**
- 主区条件：
  - `showTasks` → `TaskBoard`
  - 否则 `deliveryView === 'canvas' && activeDeliveryId && delivery.data` → `DeliveryCanvas`
  - 否则 `deliveryView === 'board' && activeWorkspaceId` → `DeliveryBoard`
  - 否则空态「选择一个需求，或新建需求」
- 删除 `workspaceCanvas` 查询、`showWorkspace`、`hasNoDeliveries`。
- `canvasForContext = activeDeliveryId ? deliveryCanvas : null`；`canvasNodes = canvasForContext.data?.nodes ?? []`。
- 面包屑：项目名 / 需求名 / 需求看板；无项目时「选择一个项目」。
- `deliveryDialogWorkspaceId: string | null` 取代布尔 `deliveryDialogOpen`；ProjectTree 的「新建需求」传入 workspaceId。
- 移动端隐藏 `MobileNodeManager`、`MobileCreateTaskForm` 入口；保留看板与总管。

- [ ] **Step 1: 写失败测试**

`App.test.tsx`：

```ts
// 无 activeDeliveryId：主区显示空态，不渲染 CanvasPanel
// activeDeliveryId + deliveryView canvas：渲染 DeliveryCanvas
// deliveryView board：渲染 DeliveryBoard
// 顶部不出现 WorkspaceSwitcher（select aria-label=工作区）
// 面包屑显示项目/需求名称
// 点击需求看板后主区切到 DeliveryBoard
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/App.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 实现**

- 删除 `workspaceCanvas`/`showWorkspace`/`hasNoDeliveries` 分支；`canvasRef` 只绑定需求画布。
- `TaskBoard` 的 `agentNodes` 从当前需求画布的 agent 节点取；无画布时 `[]`。
- `CreateDeliveryDialog` 的 `workspaceId` 来自 `deliveryDialogWorkspaceId`；创建后 `setWorkspace(id); setDelivery(deliveryId)`。
- 顶部移除 `WorkspaceSwitcher`；项目创建入口在 ProjectTree 的「项目 +」。
- 空态用 `surface`/`separator`/`muted`，提供「新建需求」按钮。
- 移动端移除 workspace 画布相关入口，保留 `mobileTab` board/supervisor。

- [ ] **Step 4: 运行并确认通过**

Run: `pnpm --filter @baton/web exec vitest run src/App.test.tsx src/features/deliveries`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/features/deliveries apps/web/src/features/workspaces
git commit -m "refactor(web): make requirement canvas the only canvas shell"
```

---

### Task 4: 工具栏与内容入口收敛

Blocking: Task 3  
Slice type: feature  
Seam: `CanvasToolbar` buttons + `CanvasPanel` drag/drop

**Files:**
- Modify: `apps/web/src/features/canvas/CanvasToolbar.tsx`
- Modify: `apps/web/src/features/canvas/model.ts`
- Modify: `apps/web/src/features/canvas/CanvasPanel.tsx`
- Modify: `apps/web/src/features/deliveries/DeliveryCanvas.tsx`（画板按钮移到工具栏；移除浮动卡「新建画板」）
- Modify: `apps/web/src/App.tsx`（把 `createDrawing` 传给 DeliveryCanvas → CanvasPanel）
- Delete: `apps/web/src/features/canvas/CreateImageNodeDialog.tsx`
- Delete: `apps/web/src/features/canvas/CreateImageNodeDialog.test.tsx`
- Test: `apps/web/src/features/canvas/CanvasToolbar.test.tsx`（已存在，更新）
- Test: `apps/web/src/features/canvas/CanvasPanel.test.tsx`（已存在，更新拖拽与工具栏用例）

**Interfaces:**
- `CanvasAddType = 'drawing' | 'file' | 'agent' | 'group'`
- `CanvasToolbar`：按钮顺序「画板、文件、分组、Agent、整理画布、投喂、快速标注、视口」；`onAdd('drawing')` 或 `onCreateDrawing`。
- `CanvasPanel` 增加 `onCreateDrawing?: () => void`；工具栏画板按钮调用它。
- 删除 `handleDrop`、`dropActive`、`onDrop`/`onDragOver`；删除 `fileToBase64`/`uploadWorkspaceFile` 在 CanvasPanel 的 import。
- `CreateFileNodeDialog` 保留，继续使用 `uploadWorkspaceFile`；不得删除上传路由。
- 文本/图片按钮与 `CreateImageNodeDialog` 删除；image 节点类型与 `resolveImageUrl` 保留（上下文/兼容）。
- `DeliveryCanvas` 移除浮动卡「新建画板」，把 `onCreateDrawing` 透传给 `CanvasPanel`。

- [ ] **Step 1: 写失败测试**

```ts
// 工具栏渲染「画板」「文件」「分组」「Agent」；不渲染「添加文本」「添加图片」
// 点「画板」调用 onCreateDrawing 一次
// 点「文件」打开 CreateFileNodeDialog
// CanvasPanel 不响应 drop：fireEvent.drop 不产生 node.create/upload
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/canvas/CanvasToolbar.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 实现**

- `CanvasToolbar`：删除 `Type`/`ImageIcon` 按钮；新增 `PenLine`「画板」。
- `model.ts`：`CanvasAddType` 改为四值；`CUSTOM_TYPES` 不变。
- `CanvasPanel.addNode`：删除 `text`/`image` 分支；`drawing` 分支调用 `onCreateDrawing`。
- 删除 `handleDrop` 及其状态/事件绑定；删除未使用的 imports。
- 删除 `CanvasPanel` 中 `CreateImageNodeDialog` 的 import 与 JSX；删除图片对话框组件与测试。
- `DeliveryCanvas`：把 `onCreateDrawing` 传给 `CanvasPanel`；移除浮动卡按钮。
- 删除图片对话框与测试；`CreateFileNodeDialog` 不动。

- [ ] **Step 4: 运行并确认通过**

Run: `pnpm --filter @baton/web exec vitest run src/features/canvas`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/canvas apps/web/src/features/deliveries/DeliveryCanvas.tsx apps/web/src/App.tsx
git commit -m "feat(web): converge canvas toolbar and remove drag upload"
```

---

### Task 5: 文案、移动端降级与回归

Blocking: Task 4  
Slice type: verification  
Seam: UI copy + mobile entries + verify

**Files:**
- Modify（用户可见文案）：`apps/web/src/features/workspaces/WorkspaceTrustBadge.tsx`、`WorkspaceTrustDialog.tsx`、`CreateWorkspaceDialog.tsx`、`WorkspaceDirectoryPicker.tsx`
- Modify：`apps/web/src/features/deliveries/DeliveryBoard.tsx`、`DeliveryCard.tsx`、`CreateDeliveryDialog.tsx`、`DeliveryCanvas.tsx`、`delivery-labels.ts`
- Modify：`apps/web/src/features/canvas/CanvasPanel.tsx`、`CreateFileNodeDialog.tsx`、`MobileNodeManager.tsx`
- Modify：`apps/web/src/features/overlays/AnnotationListOverlay.tsx`
- Modify：`apps/web/src/features/supervisor/SupervisorEmptyState.tsx`
- Modify：`apps/web/src/features/shared/MobileMoreMenu.tsx`
- Modify：`apps/web/e2e/delivery.spec.ts` 与其它引用可见文案的 e2e
- Test：对应组件测试与 `apps/web/e2e/*`

**Interfaces:**
- 只改用户可见文案：`工作区 → 项目`、`交付 → 需求`；代码标识符、协议、文档不改。
- 移动端：保留看板与总管；隐藏依赖 workspace canvas 的节点管理入口。

- [ ] **Step 1: 列出待改文案**

Run: `rg -n "工作区|交付" apps/web/src apps/web/e2e`

把结果分为「用户可见」与「代码/注释/内部」；只改前者。至少覆盖上面 Files 列表。

- [ ] **Step 2: 更新文案与移动端入口**

- 创建项目/信任项目/项目目录/项目自动化等文案。
- 新建需求/需求看板/停止需求/需求状态等文案。
- `DeliveryCanvas` 的 `工作区 <id>` 改为 `项目 <id>` 或删除。
- 移动端隐藏 `MobileNodeManager`/`MobileCreateTaskForm` 的入口按钮；不删除组件本身。

- [ ] **Step 3: 更新测试**

Run: `pnpm --filter @baton/web exec vitest run`

修复因文案与入口变化失败的测试；e2e 选择器改为新文案。

- [ ] **Step 4: 全量验证**

Run: `pnpm verify`

Expected: typecheck + lint + test + build 全绿。

- [ ] **Step 5: 截图与提交**

用 ego-lite 或 Playwright 截图：左栏项目树、空态、需求画布、工具栏。截图放 PR/任务记录，不写本机路径。

```bash
git add apps/web/src apps/web/e2e
git commit -m "feat(web): converge canvas shell and project/requirement copy"
```

---

## 本 plan 完成标准

- 左栏无「全部项目」「项目画布」；项目树 + 通知可用。
- 主区只有需求画布/需求看板/任务看板/空态；顶部无项目切换器。
- 工具栏无文本/图片按钮，画布不接受拖拽上传；文件按钮仍可用。
- `GET /api/attention` 可用且通知区跨项目聚合。
- `pnpm verify` 全绿；截图证据落盘。
- 本 plan 不改画板编辑器、缩略图、总管读写与任务上下文（后续 plan）。
