---
spec_ref: ../specs/2026-11-24-canvas-drawing-scope-design.md
spec_topic: canvas-drawing-scope
task_count: 5
estimated_phases: [tests, implementation, verification]
dod: "画板加载失败不覆盖；source-only 自动保存；关闭 full save；drawing 节点显示缩略图；刷新/重开内容不丢；pnpm verify 通过"
status: active
depends_on: 2026-11-24-m9-1-canvas-shell-project-tree.md
---

# M9-2 画板编辑器与缩略图实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use `- [ ]` syntax for tracking.

**Goal:** 让画板成为可靠的内容载体：加载失败不覆盖、自动保存源文件、关闭生成缩略图、画布节点显示内容预览。

**Architecture:** 协议增加 artifact 保存 `mode` 与 drawing 节点 `previewStale`；core 增加纯函数画板内容抽取；daemon 按 mode 分派 source/full/preview 并同步 drawing 节点；前端重写编辑器的加载/自动保存/关闭逻辑，画布节点用预览 URL 渲染缩略图。

**Tech Stack:** Excalidraw 0.18、React 19、TanStack Query、Fastify 5、zod、vitest。

---

### Task 1: 协议字段与 core 内容抽取

Blocking: none  
Slice type: tracer-bullet  
Seam: `extractDrawingContent` + protocol schemas

**Files:**
- Modify: `packages/protocol/src/api.ts`（`ArtifactSaveInput.mode`）
- Modify: `packages/protocol/src/entities/node.ts`（`DrawingNode.data.previewStale`）
- Modify: `packages/protocol/src/events.ts`（`artifact.updated.previewStale`）
- Create: `packages/core/src/drawing/scene.ts`
- Modify: `packages/core/src/index.ts`（导出 drawing）
- Test: `packages/core/test/drawing-scene.test.ts`
- Test: `packages/protocol/test/delivery-entities.test.ts`（如已有 drawing 断言则更新）

**Interfaces:**
- `ArtifactSaveInput = { previewBase64?, sourceBase64?, svgBase64?, mode?: 'full' | 'source' | 'preview' }`，默认 `full`。
- `DrawingNode.data.previewStale?: boolean`。
- `ArtifactUpdatedEvent.payload.previewStale?: boolean`。
- `extractDrawingContent(scene: unknown, limits?: { maxElements?: number; maxTextChars?: number })` →
  `{ elements: Array<{ id, type, x, y, w, h, text? }>, texts: Array<{ id, text, x, y }>, counts: Record<string, number>, totalElements, totalTexts, bounds: { minX, minY, maxX, maxY } | null, truncated: boolean }`
- `drawingSummary(scene: unknown)` → `{ summary: string, textCount: number, imageCount: number }`

- [x] **Step 1: 写失败测试**

`drawing-scene.test.ts`：
- 文字、矩形、箭头、图片、freedraw 各一；断言 texts 顺序按 y→x，counts 正确，bounds 正确。
- `isDeleted: true` 的元素被忽略。
- 空/损坏 JSON 返回空内容且不抛错。
- 5001 个元素或超 200k 文本字符时 `truncated=true`。
- `drawingSummary` 取前 3 条文字、统计图片数量。

- [x] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/core exec vitest run test/drawing-scene.test.ts`

Expected: FAIL，模块不存在。

- [x] **Step 3: 实现协议与 core**

- `scene.ts` 不 import Node 内置模块；只做纯解析与排序。
- 过滤 `isDeleted`；`type==='text'` 才进 `texts`；所有元素进 `elements`（图片不含 base64）。
- 硬上限常量：`maxElements=5000`、`maxTextChars=200_000`。
- 协议字段保持可选/默认，旧客户端兼容。

- [x] **Step 4: 运行并确认通过**

Run: `pnpm --filter @baton/core exec vitest run test/drawing-scene.test.ts && pnpm --filter @baton/protocol test`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add packages/protocol/src packages/core/src packages/core/test packages/protocol/test
git commit -m "feat(core): extract drawing content and add artifact save modes"
```

---

### Task 2: daemon 保存 mode 与 drawing 节点同步

Blocking: Task 1  
Slice type: tracer-bullet  
Seam: `saveArtifactContent(mode)` + `syncDrawingNode`

**Files:**
- Modify: `apps/daemon/src/artifact/service.ts`
- Modify: `apps/daemon/src/http/deliveries.ts`（透传 mode）
- Test: `apps/daemon/test/artifact-service.test.ts`

**Interfaces:**
- `mode='source'`：只写 source；更新 `sourcePath/updatedAt`；不写审计、不广播、不改 status/version、不生成 preview。
- `mode='full'`：写三件套；审计；`status='ready'`；广播；同步节点 `previewStale=false`。
- `mode='preview'`：只写 preview；`status='ready'`；广播；同步节点 `previewStale=false`；不写审计、不改 source/version。
- `syncDrawingNode(tx, artifact, previewStale)`：找到 delivery canvas 上 `data.artifactId` 匹配的 drawing 节点，更新 `status/thumbnailPath/previewStale/updatedAt`。

- [x] **Step 1: 写失败测试**

在 `artifact-service.test.ts` 增加一个 delivery + drawing 节点 fixture：
- source 模式：sourcePath 写入，drawing 节点 `previewStale` 不变/无预览，无 audit、无 `artifact.updated`。
- full 模式：三件套写入，节点 `thumbnailPath` 与 `previewStale=false`，有 audit、有广播。
- preview 模式：只写 preview，节点 `previewStale=false`，source 不变，无 audit。

- [x] **Step 2: 运行并确认失败**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/artifact-service.test.ts`

- [x] **Step 3: 实现**

- `ArtifactSaveInput` 透传 `mode` 到 `saveArtifactContent`。
- 把写文件/upsert 放进同一事务；source 模式不触发 `syncArtifactNode`（非 drawing 产物的既有逻辑不变）。
- drawing 产物不进入 `syncArtifactNode` 的 artifact 节点分支，只走 `syncDrawingNode`。

- [x] **Step 4: 运行并确认通过**

Run: `pnpm --filter @evanfang0054/baton exec vitest run test/artifact-service.test.ts`

- [x] **Step 5: 提交**

```bash
git add apps/daemon/src/artifact apps/daemon/src/http/deliveries.ts apps/daemon/test/artifact-service.test.ts
git commit -m "feat(daemon): persist drawing save modes and sync drawing nodes"
```

---

### Task 3: DrawingEditor 三态、自动保存与关闭保护

Blocking: Task 2  
Slice type: tracer-bullet  
Seam: `DrawingEditor` load/save state

**Files:**
- Modify: `apps/web/src/features/drawings/DrawingEditor.tsx`
- Modify: `apps/web/src/features/overlays/Overlay.tsx`（`closeOnEscape?: boolean`）
- Test: `apps/web/src/features/drawings/DrawingEditor.test.tsx`

**Interfaces:**
- `loadState: 'loading' | 'ready' | 'error'`；404 → ready 空画板；其他错误/解析失败 → error + 重试，禁止保存。
- `onChange` dirty + 2s debounce → `saveArtifact(..., { mode:'source', sourceBase64 })`；单飞；失败提示。
- 显式保存/关闭 → `mode:'full'`；失败不关闭；「放弃并关闭」二次确认。
- `Overlay closeOnEscape={false}`；X 走 `requestClose`。
- `beforeunload` dirty 提示。

- [x] **Step 1: 写失败测试**

Mock `@excalidraw/excalidraw` 与 `../../lib/api`：
- 加载 404：显示空编辑器，允许保存。
- 加载 HTTP/解析失败：显示错误与重试，不渲染可保存的编辑器。
- 输入变化后 2s 触发一次 source 保存；保存中变化只补一次。
- 关闭时触发 full 保存；full 失败不调用 onClose；成功后 onClose。
- dirty 时放弃关闭需要二次确认。

- [x] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/drawings/DrawingEditor.test.tsx`

- [x] **Step 3: 实现**

- 用 `useRef` 保存 api/防抖计时器/单飞状态；不要用 localStorage。
- 加载失败时不挂载 Excalidraw，避免空场景覆盖。
- 自动保存只在 `loadState==='ready'` 且 api 存在时执行。
- 关闭流程：`requestClose()` → clean 直接关；dirty 先 full，失败留在编辑器。
- `Overlay` 增加 `closeOnEscape`，画板传 `false`。

- [x] **Step 4: 运行并确认通过**

Run: `pnpm --filter @baton/web exec vitest run src/features/drawings/DrawingEditor.test.tsx`

- [x] **Step 5: 提交**

```bash
git add apps/web/src/features/drawings apps/web/src/features/overlays/Overlay.tsx
git commit -m "feat(web): make drawing editor autosave and fail safe"
```

---

### Task 4: drawing 节点缩略图与查询刷新

Blocking: Task 3  
Slice type: tracer-bullet  
Seam: `DrawingNode` preview URL + query invalidation

**Files:**
- Modify: `apps/web/src/features/canvas/model.ts`
- Modify: `apps/web/src/features/canvas/CanvasPanel.tsx`
- Modify: `apps/web/src/features/canvas/nodes/DrawingNode.tsx`
- Modify: `apps/web/src/App.tsx`（drawing overlay `onSaved` 失效 deliveryCanvas）
- Modify: `apps/web/src/features/realtime/RealtimeProvider.tsx`（`artifact.updated` 失效 artifacts + deliveryCanvas）
- Test: `apps/web/src/features/canvas/canvas-model.test.ts`
- Test: `apps/web/src/features/canvas/nodes/nodes.test.tsx`

**Interfaces:**
- `CanvasNodeData.previewUrl?: string`。
- `toFlowNodes` 对 drawing 节点：`/api/deliveries/{deliveryId}/artifacts/{artifactId}/content?variant=preview&v={artifact.updatedAt}`。
- `DrawingNode`：顶部「画板 + 状态」；主体 `<img src=previewUrl>` `object-contain`；无 URL/失败显示占位；`previewStale` 显示「画板已更新，缩略图刷新中」。
- `artifact.updated` → 失效 `artifacts(deliveryId)` + `deliveryCanvas(workspaceId, deliveryId)`。

- [ ] **Step 1: 写失败测试**

- `toFlowNodes` 为 drawing 节点生成带 `v` 的 preview URL；无 deliveryId/artifact 时 `previewUrl` 为空。
- `DrawingNode` 渲染 `<img>`；`previewStale` 显示提示；无预览显示占位。
- `onSaved` 触发 `deliveryCanvas` 失效（App 测试或组件测试）。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @baton/web exec vitest run src/features/canvas/canvas-model.test.ts src/features/canvas/nodes/nodes.test.tsx`

- [ ] **Step 3: 实现**

- `CanvasPanel` 的 `toFlowNodes` 传入 `deliveryId`。
- `DrawingNode` 不引入 Excalidraw；只用 `<img>`。
- 缩略图使用 `object-contain` 与 `bg-surface`；状态用现有 `text-muted/foreground/warning` token。
- `RealtimeProvider` 的 `artifact.updated` 分支补 `artifacts`/`deliveryCanvas` 失效。

- [ ] **Step 4: 运行并确认通过**

Run: `pnpm --filter @baton/web test`

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/canvas apps/web/src/App.tsx apps/web/src/features/realtime/RealtimeProvider.tsx
git commit -m "feat(web): render drawing thumbnails and refresh saved boards"
```

---

### Task 5: 回归与验证

Blocking: Task 4  
Slice type: verification  
Seam: `pnpm verify` + drawing e2e smoke

**Files:**
- Modify: `apps/web/e2e/delivery.spec.ts`（如需断言缩略图/保存）
- Test: 全量

- [ ] **Step 1: 扩展 drawing e2e smoke**

在现有 `creates a drawing board from the delivery canvas` 后：
- 点击工具栏「画板」→ 编辑器出现；
- 点击「保存并关闭」→ 断言 PUT 调用/编辑器关闭；
- 画布节点出现 `<img>`（若 mock 返回 preview）。
不要求 Excalidraw 内画图；真实画图交互由 M9-5 ego-lite 证据覆盖。

- [ ] **Step 2: 运行定向 e2e**

Run: `pnpm exec playwright test apps/web/e2e/delivery.spec.ts`

- [ ] **Step 3: 全量 verify**

Run: `pnpm verify`

- [ ] **Step 4: 提交并更新 plan 状态**

```bash
git add docs/plans/2026-11-24-m9-2-drawing-editor-thumbnail.md apps/web/e2e/delivery.spec.ts
git commit -m "test(web): cover drawing save and thumbnail rendering"
```

---

## 本 plan 完成标准

- 画板加载失败不覆盖，自动保存只写 source，关闭生成 full 三件套。
- drawing 节点显示缩略图，保存后刷新；`previewStale` 有明确提示。
- `pnpm verify` 全绿；`delivery.spec` 通过。
- M9-3/M9-4 可复用 `extractDrawingContent` 与 `mode` 契约。
