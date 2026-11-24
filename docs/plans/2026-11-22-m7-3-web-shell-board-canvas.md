---
spec_ref: ../specs/2026-11-22-m7-delivery-playbook-design.md
spec_topic: m7-delivery-playbook
task_count: 6
estimated_phases: [api, shell, board, canvas, overlays, verification]
dod: "交付看板/画布/阶段分组/产物卡/闸门卡可用；右栏只留总管；任务详情、产物、标注改为覆盖层；深链可直达；web 测试与 pnpm verify 全绿"
status: completed
depends_on: 2026-11-22-m7-2-daemon-delivery-artifact-annotation.md
---

# M7 Plan 3：Web 交付工作台

> 依赖 M7-2 的 delivery/artifact/annotation REST 与事件。
> 对应 spec：`docs/specs/2026-11-22-m7-delivery-playbook-design.md` §8。
> 执行图：`docs/plans/2026-11-22-m7-0-execution-map.md`。

**Goal:** 用户打开 baton 先看到交付看板；点进一条交付进入独立画布，四个阶段、产物、闸门都在画布上；右栏只剩总管；任务详情/产物/标注用覆盖层承载。

**Architecture:** `apps/web/src/features/deliveries/` 新增看板与 rail；复用 `CanvasPanel` 渲染交付画布；`CanvasPanel` 增加 delivery 上下文（阶段分组状态、产物节点、双击覆盖层）；App 壳只做路由与查询装配。

**Tech Stack:** React 19、TanStack Query、Zustand、React Flow、HeroUI v3、Tailwind token、vitest/Testing Library。

**Design sync:** 不新增 token；状态用 `StatusChip`/文字 + 语义色；覆盖层用固定定位 + `role=dialog`，Esc 关闭；深链 `workspace/delivery/stage/artifact/annotation`。

**Commit strategy:** 每 task 一次 commit；分支 `feat/m7-3-web-shell-board-canvas`。

---

### Task 1: 交付 canvas 查询与 web API

**Files:**
- Modify: `packages/protocol/src/api.ts`
- Modify: `apps/daemon/src/http/canvas.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/query.ts`
- Test: `apps/daemon/test/delivery-rest.test.ts`、`apps/web/src/lib/api.test.ts`

- [x] `CanvasQuery` 增加可选 `deliveryId`；route 有 deliveryId 时返回交付画布并校验 workspace。
- [x] web API：`listDeliveries/getDelivery/createDelivery/enqueueDelivery/cancelDelivery/listArtifacts/fetchArtifactText/listAnnotations`。
- [x] queryKeys：deliveries/delivery/deliveryCanvas/artifacts/annotations。
- [x] commit `feat(web): add delivery api and canvas query`.

### Task 2: 主壳、URL 与右栏收敛

**Files:**
- Modify: `apps/web/src/stores/app.ts`
- Modify: `apps/web/src/lib/url.ts`
- Modify: `apps/web/src/features/right-panel/RightPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/features/right-panel/RightPanel.test.tsx`、`apps/web/src/App.test.tsx`

- [x] store 增加 `activeDeliveryId`、`deliveryView: 'canvas'|'board'`、`rightPanelCollapsed`、`overlay`；URL 增加 `delivery/stage/artifact/annotation`。
- [x] `RightPanel` 去掉任务/节点 tab，只渲染总管；支持折叠/恢复。
- [x] App 桌面壳：左栏交付 rail、中间交付看板/画布、右侧总管；任务视图作为辅助页签。
- [x] commit `feat(web): collapse right panel to supervisor only`.

### Task 3: 交付 rail 与看板

**Files:**
- Create: `apps/web/src/features/deliveries/DeliveryRail.tsx`
- Create: `apps/web/src/features/deliveries/DeliveryBoard.tsx`
- Create: `apps/web/src/features/deliveries/DeliveryCard.tsx`
- Create: `apps/web/src/features/deliveries/CreateDeliveryDialog.tsx`
- Test: `apps/web/src/features/deliveries/*.test.tsx`

- [x] rail：新建交付、按状态/需要我过滤；卡片显示阶段 chips、等待时长、标注数。
- [x] board：6 列（草稿/进行中/待我处理/已阻断/已交付/已取消）、搜索、按等待排序、stale 30 分钟。
- [x] 点击卡片进入交付画布；空状态引导“新建交付”。
- [x] commit `feat(web): add delivery rail and board`.

### Task 4: 交付画布

**Files:**
- Create: `apps/web/src/features/deliveries/DeliveryCanvas.tsx`
- Create: `apps/web/src/features/deliveries/DeliveryOverviewCard.tsx`
- Modify: `apps/web/src/features/canvas/CanvasPanel.tsx`
- Modify: `apps/web/src/features/canvas/model.ts`
- Modify: `apps/web/src/features/canvas/node-title.ts`
- Create/Modify: `ArtifactNode.tsx`、`DrawingNode.tsx`、`GroupNode` 阶段头
- Test: `apps/web/src/features/deliveries/DeliveryCanvas.test.tsx`

- [x] 画布加载交付 canvas；阶段分组头显示 `① 需求`、状态、产物数、标注数、等待时长。
- [x] 产物节点缩略图/kind/状态；双击打开产物查看器。
- [x] Agent 阶段卡双击打开阶段现场；review 卡显示闸门按钮占位（通过/打回在 M7-5 接线）。
- [x] 概览卡固定在视口左上：标题、goal、进度、当前阶段、标注数；阶段 chip 聚焦分组。
- [x] commit `feat(web): add delivery canvas`.

### Task 5: 覆盖层与产物查看器

**Files:**
- Create: `apps/web/src/features/overlays/Overlay.tsx`
- Create: `apps/web/src/features/overlays/StageSceneOverlay.tsx`
- Create: `apps/web/src/features/overlays/ArtifactViewerOverlay.tsx`
- Create: `apps/web/src/features/overlays/AnnotationListOverlay.tsx`
- Modify: `apps/web/package.json`（`react-markdown`、`remark-gfm`）
- Modify: `THIRD_PARTY_NOTICES.md`
- Test: `apps/web/src/features/overlays/*.test.tsx`

- [x] Overlay：`role=dialog`、`aria-modal`、Esc 关闭、焦点回到触发元素、关闭销毁。
- [x] StageScene：复用 TaskDetailPanel 内容（任务现场/验收/历史/diff）。
- [x] ArtifactViewer：Markdown/图片/HTML sandbox/PDF/未知类型；SVG 当图片。
- [x] AnnotationList：open/resolved 列表、定位目标、交给总管、标记忽略。
- [x] commit `feat(web): add delivery overlays and artifact viewer`.

### Task 6: 全量验证与收口

- [x] `pnpm verify` 全绿；web 测试覆盖 rail/board/canvas/overlay。
- [x] 更新执行图与 `docs/README.md`；记录截图/证据。
- [x] commit `docs(plan): complete M7-3 web delivery workbench`.

---

## 实施记录

- `GET /api/canvas` 支持 `deliveryId`，交付画布与 workspace inbox 画布分开加载。
- 右栏只剩精灵总管，可折叠；任务/节点不再占右栏，任务现场、产物、标注改为覆盖层。
- 交付 rail + 6 列看板 + 交付画布 + 阶段分组头 + 产物节点 + 概览卡已接线；旧 workspace 画布与任务看板保留为辅助视图。
- 偏离：覆盖层用固定定位 `role=dialog` + Esc/焦点回收，而不是 HeroUI Modal；验收矩阵卡与闸门通过/打回按钮留到 M7-5；移动端交付列表留到 M7-6。
- 证据：`pnpm verify` 通过；web 66 files / 301 tests，daemon 98 files / 442 tests。

---

## 收口检查

- [x] 右栏只有总管，无任务/节点/交付 tab。
- [x] 交付画布只读现有 REST；不新增 WS 命令。
- [x] 覆盖层 Esc 关闭、焦点可回、关闭销毁。
- [x] 旧 workspace 画布与旧独立任务仍可打开。
- [x] 没有 TODO/FIXME；没有 Excalidraw/标注绘制（M7-4）。
