---
spec_topic: canvas-drawing-scope
decision_summary: "画布收敛为需求画布：多项目树按项目挂需求，工具栏以画板为主，画板缩略图与自动保存闭环，总管读写并完整编辑画板，画板内容进入总管与任务上下文"
design_approved: true
user_approved_at: 2026-11-24T17:10:52+08:00
gates: [design-approved]
spec_ref: 2026-11-22-m7-delivery-playbook-design.md
domain_terms: [project, requirement, delivery-canvas, drawing, drawing-thumbnail, canvas-scope, drawing-content, attention-inbox, drawing-agent]
---

# 画布与画板收敛设计

> 子 spec。回链 M7 交付工作台：`docs/specs/2026-11-22-m7-delivery-playbook-design.md`，以及 M2 总管：`docs/specs/2026-11-18-m2-supervisor-design.md`。
> 本 spec 覆盖 M7 中与画板缩略图、画布归属、总管画布可见性相关的实现偏差；不修改已锁定的 M7 决策原文。
> 本 spec 不引入数据库迁移：现有数据均为测试数据，按第 10 节重置后从新模型开始。

## 1. 背景

当前产品在画布与画板上有六个具体问题：

1. **工具栏职责重叠**：`apps/web/src/features/canvas/CanvasToolbar.tsx` 同时提供文本、文件、图片、分组、Agent、整理、投喂、标注；用户实际用画板承载文案、图片与圈画，文本/图片按钮成为噪声。
2. **上传入口分散**：画布拖拽上传文件/图片与工具栏并存，和"内容进画板"的方向冲突。
3. **画板只显示空框**：`apps/web/src/features/canvas/nodes/DrawingNode.tsx` 只渲染标题；`thumbnailPath` 从创建起恒为 `null`，后端保存时明确跳过 drawing 节点同步（`apps/daemon/src/artifact/service.ts:89-92`、`:316`）。
4. **画板会丢内容**：关闭遮罩一定触发保存（`apps/web/src/features/drawings/DrawingEditor.tsx:87`）；加载失败被静默吞掉（`apps/web/src/features/drawings/DrawingEditor.tsx:44-46`），编辑器以空场景打开，关闭时把空场景写回；没有自动保存、脏状态和未保存提示。
5. **总管看不到需求画布、也不能写画板**：总管硬编码读取项目画布（`apps/daemon/src/supervisor/service.ts:1047` 使用 `getCanvasByWorkspace`），`supervisor.send` 没有 `deliveryId`（`packages/protocol/src/supervisor.ts:134-144`）；需求画布与画板内容完全不进总管上下文，更无法创建/修改画板。
6. **信息架构混乱**：左栏是交付列表，顶栏是项目切换器，主区在项目画布/需求画布/看板之间切换；"项目"与"需求"的归属关系在界面上不可见。

## 2. 决策

### D1 多项目树：项目是根，需求挂在项目下

左栏结构：

```
通知 N
项目 +
▾ 项目 A
    需求看板
    • 需求 A-1
    • 需求 A-2
    + 新建需求
▸ 项目 B
```

- 点项目名或箭头：只展开/收起，不导航。
- 项目下显式子项：需求看板、需求列表、新建需求。
- 移除「全部项目」入口。
- 需求按项目懒加载：项目首次展开时才请求该项目的需求列表。
- 通知是跨项目收件箱：待审批、待回复、待验收、失败等；点击条目自动切项目、切需求、开任务现场；空态为「没有需要你处理的」。

### D2 唯一画布类型 = 需求画布

- 项目只是需求容器，**没有项目画布**。
- 每个需求一张画布（沿用 ADR 0011 `delivery-owned-canvas`）。
- 未选中需求时，主区显示空态「选择一个需求，或新建需求」；总管只做项目级问答与建需求，不读写画布。
- 项目级 `canvas.delivery_id IS NULL` 不再进入新 UI；后端保留空行以兼容旧代码，不删除、不迁移。
- **不新增 workspace 级 artifact**：画板只存在于需求画布，仍按 `deliveryId + stageKey` 存储。

### D3 UI 术语统一为「项目 / 需求」

- 用户可见文案：`工作区 → 项目`、`交付 → 需求`。
- 代码标识符、协议、数据库、文档内部仍使用 `workspace` / `delivery`。
- 顶部移除项目切换器；主区改为只读面包屑「项目 A / 需求 A-1」。

### D4 工具栏与内容入口收敛

- 固定按钮：画板、文件、分组、Agent、整理画布、投喂给任务、快速标注、适应视图/放大/缩小。
- 移除「添加文本」「添加图片」按钮与图片对话框。
- **移除画布拖拽上传**：删除 `handleDrop` 与 drop/dragOver 处理；画布不再接受拖入文件/图片。
- 「文件」按钮保留：它只添加文件引用节点，不是上传。
- 图片内容只在画板内插入（Excalidraw 自带图片能力）。
- **文本节点类型保留，但只由总管/系统创建**：`create_text`、任务结果节点、任务交接节点继续可用；用户内容一律进画板。
- `CanvasAddType` 改为 `drawing | file | agent | group`；`CanvasPanel` 增加 `onCreateDrawing` 回调。
- 若 `uploadWorkspaceFile` 与上传路由在移除拖拽后无调用方，一并删除并更新测试。
- 需求浮层保留标题/目标/阶段条/进度/等待/验收矩阵/停止交付/快速标注/标注 N；移除「新建画板」（移到工具栏）。

### D5 画板节点与缩略图

- `drawing` 节点继续引用 `artifact`（Excalidraw `.excalidraw` + PNG 预览 + SVG）。
- 保存时后端在同一事务内同步 drawing 节点：
  - `data.status = 'ready'`；
  - `data.thumbnailPath = artifact.path`（PNG）；
  - `data.previewStale`：有预览时为 `false`，仅写源文件时为 `true`；
  - `node.updatedAt = now`。
- 前端 `model.ts` 为 drawing 节点注入预览 URL，`DrawingNode` 渲染缩略图：
  - 顶部：图标 +「画板」+ 状态；
  - 主体：`object-contain` 缩略图，背景用 `bg-surface`；
  - 底部：标题 +「双击编辑」；
  - 无预览或加载失败时显示占位；`previewStale` 时显示「画板已更新，缩略图刷新中」。
- 新建画板节点尺寸 360×260；标题默认「画板 N」。
- 预览 URL 带 `v=node.updatedAt` 做缓存失效；保存后前端失效 `artifacts + deliveryCanvas` 查询。

### D6 画板编辑器数据安全

- 编辑器三态：`loading / ready / error`。
  - 加载 404（还没保存过）→ 空画板；
  - 网络或 JSON 解析失败 → error 态，显示错误与重试，**禁止保存**；
  - 未进入 ready 不挂 Excalidraw、不产生 api，关闭不写盘。
- 自动保存：
  - `onChange` 标记 dirty + 2s debounce，以 `mode='source'` 只写 `.excalidraw` 源文件；
  - 不生成 PNG/SVG、不写审计、不广播 `artifact.updated`；
  - 单飞队列：保存中再次变更只标记 pending，完成后补一次；
  - 失败显示「自动保存失败 + 重试」，保留编辑内容。
- 显式保存 / 关闭：
  - 以 `mode='full'` 生成 source + PNG + SVG 三件套，写审计、`status=ready`、同步节点、广播 `artifact.updated`；
  - 关闭前 flush；失败不关闭，提供「重试」与「放弃并关闭（二次确认）」；
  - dirty 时 `beforeunload` 提示。
- 画板 overlay `closeOnEscape=false`，避免编辑文字时按 Esc 误关；X 按钮走统一 `requestClose`。
- 不使用 localStorage/IndexedDB 存画板内容；状态只存内存。
- 单文件上限沿用 10MB；超限提示减少图片/笔迹。

### D7 画板内容抽取与 `get_drawing`

- 新增 `packages/core/src/drawing/scene.ts` 纯函数：
  - `extractDrawingContent(scene)` 返回全部文字元素（id、完整文本、位置、尺寸、绑定关系）与全部图形元素的紧凑结构 `{id,type,x,y,w,h,text?}`；
  - 跳过 `isDeleted`；按 `y → x → index` 稳定排序；
  - 返回 `bounds`（画板内容包围盒）与 `counts`；
  - 图片只返回 id/数量/MIME/尺寸，不读取 `files` 的 base64；
  - 不返回 `appState`、绝对路径；
  - 默认返回全部内容；只有超过硬上限（5000 元素或 200k 文本字符）才返回 `truncated` 并提供分页。
- 总管 `get_drawing` 工具返回全部可读内容与元素 id，便于后续 `update_drawing` 引用。
- `list_canvas` 与 `<canvas_overview>` 仍是轻量摘要：文本预览、画板标题/摘要/计数；需要全文时用 `get_drawing`。

### D8 总管读写跟随当前需求

- 协议：`SupervisorSendInput` 增加可选 `deliveryId`、`stageKey`（必须成对）；`SupervisorMessageMeta` 持久化同字段，重试保持作用域。
- daemon `ToolContext` 增加 `deliveryId/stageKey`；`createTargetResolver.canvasFor` 使用当前需求画布，不再回退项目画布。
- 写工具（`create_text`、`create_agent`、`create_task`、`create_tasks`、`plan_tasks`、`batch_tasks`、`handoff_task`、`create_edge`、`update_node`、`arrange_canvas`、`create_drawing`、`update_drawing`）全部落在当前需求画布；新建任务绑定当前 `deliveryId + stageKey`；跨画布建边拒绝。
- 读工具：
  - `<canvas_overview>` = 当前需求画布，带 `scope="delivery"`、`delivery`、`stage` 属性；
  - `list_canvas` 默认当前需求，支持 `scope='delivery' + deliveryId` 读同项目其他需求；
  - `get_drawing` 按节点/产物读取任意同 workspace 画板；
  - 输出确定性截断并带 `truncated` 标记。
- 没有选中需求时：总管只做项目级问答与建需求（`create_delivery`），画布工具返回明确错误「先选择一个需求」。
- prompt：工具清单 29→32；新增作用域规则、画板文字是反馈、读画板用 `get_drawing`、画板写入用 `create_drawing/update_drawing`、不要传图片 base64、不要抓取远程图片。

### D9 画板进入任务上下文

- `packages/protocol/src/enums.ts` 的 `NodeType` 补齐 `artifact | drawing`，消除 `as NodeType` 不安全强转。
- `packages/core/src/context/assemble.ts`：
  - `isContentNode` 加入 `drawing`；
  - `renderContent(drawing)` 输出画板文字；无内容时输出 `[画板] <title>`；
  - 画板文字参与现有 48k/16k 预算与 truncated。
- daemon `buildContextContent` 增加 drawing 预读：通过 artifact service 读取 `.excalidraw`，用 core 抽取文字；读取失败输出「画板内容不可读」，不静默丢。
- 投喂白名单全部加入 `drawing`：`CanvasPanel` 可投喂节点、`InjectContextDialog`、`inject_context` 工具、`apps/daemon/src/supervisor/target.ts` 的 `CONTENT_TYPES`。
- 快照测试新增 drawing 场景；现有文本/文件快照除 NodeType 枚举新增值外不应变化。

### D10 标注系统保持现状（需求级）

- 需求级标注完全不变：不退役、不删表、不改 API、不改任务 `annotationIds`、不改验收自动 `resolved`。
- 工作区级标注：项目画布移除后失去 UI 入口；`annotation` 表、API、图片文件全部保留，不删除、不迁移；本 spec 不新增工作区标注入口。
- 画板文字/图形是新的反馈载体，与标注并存；画板节点可作为标注目标。
- 除「随项目画布移除工作区标注入口」外，本 spec 不修改标注逻辑。

### D11 旧数据：重置，不做迁移

- 当前全部为测试数据，用户明确同意直接重置。
- **不写破坏性 migration、不加归档字段、不自动删除旧数据**。
- 旧 `workspace canvas` 与未绑定需求的任务不进入新 UI；如未重置，任务看板与总管只展示 `deliveryId` 非空的任务。
- 本地重置 runbook（不自动执行）：
  1. 停止 daemon；
  2. 备份后删除 `~/.baton/baton.db`（以及需要清理的各工作区 `.baton/` 产物目录）；
  3. 重新启动，按新模型创建项目与需求。
- 新的 `createWorkspace` 仍会创建一行 workspace canvas（兼容旧代码），但 UI 不再查询；后续单独清理。

### D12 全局通知

- 新增只读 `GET /api/attention?limit=20`：跨项目聚合需要人处理的任务与需求（待审批/待回复/待验收/失败/等待），返回 `{ workspaceId, workspaceName, deliveryId, deliveryTitle, stageKey, taskId, title, kind, waitingSince }`；按等待时间升序，上限 50。
- 左栏「通知 N」使用该接口；有通知的项目在项目行显示圆点。
- 不做通知已读/未读状态；不新增表。

### D13 总管完整编辑画板

总管新增两个写工具：

- `create_drawing({ title?, operations? })`：在当前需求画布创建 drawing 节点与 artifact；可带初始操作，避免多轮往返。
- `update_drawing({ nodeId | artifactId, operations })`：对已有画板批量应用操作。

操作集（`packages/protocol/src/drawing.ts` 定义 zod，`packages/core/src/drawing/scene.ts` 实现）：

- `add_text`：文本、位置、字号、颜色、对齐。
- `add_shape`：矩形/椭圆/菱形，位置/尺寸/颜色/填充，可带标签（自动绑定 text 元素）。
- `add_arrow`：起点/终点/折点，可带标签。
- `add_line`：折线/直线。
- `add_freedraw`：自由笔迹点集。
- `add_image`：从**工作区相对路径**插入图片（png/jpeg/webp/gif/svg），生成 Excalidraw `fileId` + image 元素；禁止远程 URL。
- `update_text`：修改已有文字元素。
- `move_element` / `resize_element` / `delete_elements`：移动/缩放/软删除。
- `set_style`：颜色、线宽、字号、填充、透明度。
- `set_title`：重命名画板。

约束：

- 单次最多 50 个操作；单画板最多 500 个元素；单条文字最多 10k 字符；单画板最多 20 张图片。
- 单图片 ≤5MB；画板源文件 ≤10MB；超出返回明确错误。
- 图片路径必须过路径 jail 与敏感路径检查；只读，不写工作区。
- 写入只允许当前需求画布；读任意同 workspace 画板。
- 每个 artifact 一个串行队列，避免并发写覆盖；审计 `drawing.update`。
- 写入后 `artifact.updated` 带 `previewStale=true`；不生成 PNG/SVG。
- 与人类同时编辑同一画板时最后写入生效；前端提供冲突提示（见 D14）。

### D14 缩略图后台刷新与冲突提示

- 服务端不引入 Excalidraw 渲染器；PNG 预览由浏览器生成。
- 新增 `apps/web/src/features/drawings/preview-renderer.ts`：
  - 懒加载 `@excalidraw/excalidraw` 的 `exportToBlob`（不挂载编辑器 React 组件）；
  - 队列去重、并发 1；读取 `.excalidraw` 源文件 → `exportToBlob` → 以 `mode='preview'` 保存 PNG；
  - 跳过正在编辑的画板；失败保留 `previewStale` 并显示「缩略图待刷新」；
  - 页面加载时扫描当前画布上 `previewStale=true` 的 drawing 节点并补渲染。
- `artifact.updated` 增加 `previewStale?: boolean`；`DrawingNode.data.previewStale` 持久化在节点 JSON 中（无 DB migration）。
- 若 `exportToBlob` 直接调用在浏览器中不可用，回退为隐藏的 Excalidraw 实例导出；实现时以真实浏览器验证。
- 冲突提示：前端维护「正在编辑的 artifactId」集合；收到同一画板的 `previewStale` 更新时显示横幅「总管已更新此画板。加载最新会丢弃本地未保存修改。」提供「加载最新 / 保留本地」；自动保存仍按最后写入生效。
- 预览保存不写审计、不改源文件、不触发新的 `previewStale`；完成后清除节点 stale 标记并刷新缩略图。

## 3. 协议与 API 变更

### 3.1 协议

- `packages/protocol/src/enums.ts`：`NodeType` 增加 `artifact`、`drawing`。
- `packages/protocol/src/entities/node.ts`：`DrawingNode.data` 增加 `previewStale?: boolean`。
- `packages/protocol/src/supervisor.ts`：
  - `SupervisorSendInput` 增加 `deliveryId?: Id`、`stageKey?: string(1..32)`；
  - `SupervisorMessageMeta` 增加 `deliveryId: Id.nullable().default(null)`、`stageKey: string.nullable().default(null)`。
- `packages/protocol/src/drawing.ts`：新增画板操作 zod schema 与类型。
- `packages/protocol/src/api.ts`：
  - `ArtifactSaveInput` 增加 `mode: 'full' | 'source' | 'preview' = 'full'`；
  - 其余字段语义不变。
- `packages/protocol/src/events.ts`：`artifact.updated` 增加 `previewStale?: boolean`。
- `apps/daemon/src/supervisor/tools.ts`：
  - `listCanvasInput` 增加 `scope?: 'current' | 'delivery'`、`deliveryId?: Id`；
  - 新增 `create_drawing`、`update_drawing`、`get_drawing`。
- 无数据库 schema 变更。

### 3.2 REST

- `GET /api/attention?limit=20`：跨项目注意力聚合，只读。
- 其余沿用现有接口：
  - 需求/画布：`GET /api/canvas?workspaceId&deliveryId`；
  - 产物：现有 delivery 级创建/保存/内容路由；保存支持 `mode`；
  - 总管：WS `supervisor.send`。

### 3.3 总管工具

- `get_drawing({ nodeId?, artifactId?, offset?, limit? })`
- `create_drawing({ title?, operations? })`
- `update_drawing({ nodeId?, artifactId?, operations })`
- `list_canvas({ limit?, scope?, deliveryId? })`
- `<canvas_overview scope="delivery" delivery="..." stage="..." total shown truncated>`
- 工具总数 32；prompt 同步更新。

## 4. 后端实现

### 4.1 画板保存与节点同步

- `apps/daemon/src/artifact/service.ts`：
  - `saveArtifactContent` 按 `mode` 分支：
    - `mode='source'`：只写 source，不写审计、不广播、不 bump version、不改 status；用于编辑器自动保存。
    - `mode='full'`：写三件套、审计、`status='ready'`、广播、同步 drawing 节点、`previewStale=false`。
    - `mode='preview'`：只写 preview，不写审计、不改 source、不 bump version；`status='ready'`；广播 `artifact.updated`；同步节点 `previewStale=false`。
  - `syncDrawingNode(tx, artifact, { previewStale })`：按 `artifactId` 找到 delivery canvas 上的 drawing 节点，更新 `status/thumbnailPath/previewStale/updatedAt`。
- `apps/web` 预览 URL 使用现有 `artifactContentUrl(deliveryId, artifactId, 'preview')` + `v=updatedAt`。
- `RealtimeProvider` 在 `artifact.updated` 时失效当前 `deliveryCanvas + artifacts` 查询，并按 `previewStale` 入队预览渲染。

### 4.2 总管作用域

- `apps/daemon/src/supervisor/service.ts`：从 `SupervisorSendInput` 取 `deliveryId/stageKey`，校验同 workspace；写入 `ToolContext` 与消息 meta。
- `apps/daemon/src/supervisor/target.ts`：`canvasFor` 优先 `getCanvasByDelivery`；无需求时抛 `canvas_not_found`，错误信息带「先选择一个需求」。
- 任务创建路径：`create_task/create_tasks/plan_tasks/batch_tasks/handoff_task` 在需求作用域下写入 `deliveryId/stageKey`。
- `list_canvas`：`scope='current'` 用当前需求；`scope='delivery'` 按 `deliveryId` 读取并校验 workspace；无当前需求且未指定 scope 时返回 `canvas_not_found`。
- `get_drawing`：解析 node/artifact → artifact service 读 source → core 抽取 → 分页返回。
- prompt 更新：工具清单、作用域规则、画板写规则、图片路径规则。

### 4.3 任务上下文

- `apps/daemon/src/workspace/context.ts`：新增 drawing 预读回调，读取 artifact source 并调用 core 抽取。
- `packages/core/src/context/assemble.ts`：`isContentNode`/`renderContent` 支持 drawing。
- `inject_context` 与目标解析的节点类型白名单加入 drawing。

### 4.4 注意力聚合

- 新增 `apps/daemon/src/attention/service.ts`（或 supervisor 内复用）：
  - 跨 workspace 读取任务与需求，复用 core `needsPerson/attentionFor`；
  - 只返回 `deliveryId` 非空的任务；
  - 输出确定性排序（waitingSince → updatedAt → id）；
  - 上限 50，`limit` 默认 20。

### 4.5 画板写入服务

- 新增 `apps/daemon/src/artifact/drawing-service.ts`：
  - `createDrawing({ deliveryId, stageKey, title?, operations? })`：创建 draft artifact + 空 scene source + drawing 节点；应用初始操作。
  - `mutateDrawing({ artifactId, operations })`：读取 source → `applyDrawingOperations` → 校验/写回 → 更新 artifact 元数据 → 审计 → 广播 `artifact.updated`（`previewStale=true`）。
  - `addImage`：工作区相对路径 → `resolveWithin` + `isSensitivePath` + MIME/大小校验 → base64 dataURL → scene `files` + image 元素。
  - 每个 artifact 一个串行队列；同一需求画布内串行执行。
  - 失败返回明确错误：`drawing_too_large`、`drawing_too_many_elements`、`image_too_large`、`image_type_unsupported`、`image_path_invalid`、`drawing_operation_invalid`。
- `packages/core/src/drawing/scene.ts`：
  - `createEmptyScene()`、`applyDrawingOperations(scene, ops, { newId, now })`、`extractDrawingContent(scene)`、`drawingSummary(scene)`。
  - 元素结构与 Excalidraw 0.18 对齐（version、versionNonce、seed、updated、index、boundElements 等）；用真实编辑器打开做兼容性验证。
  - 形状标签使用 Excalidraw 绑定（shape.boundElements ↔ text.containerId）。
  - 删除使用 `isDeleted=true` 软删除。

## 5. 前端实现

### 5.1 应用壳

- `apps/web/src/App.tsx`：
  - 移除 `showWorkspace`、`hasNoDeliveries`、`workspaceCanvas` 查询与项目画布分支；
  - 当前选择 = `activeWorkspaceId + activeDeliveryId`；无 delivery 时主区空态；
  - 顶部移除 workspace 切换器，保留任务看板、自动化、信任、设置；
  - 主区顶部增加面包屑。
- 新增 `ProjectTree`（替换 `DeliveryRail`）：
  - 使用 `listWorkspaces` 渲染项目；
  - 展开时按项目查询 `listDeliveries(workspaceId)`；
  - 项目行展开/收起 + 通知圆点；
  - 子项：需求看板、需求列表、新建需求；
  - 通知区使用 `GET /api/attention`。
- 需求看板/任务看板按当前项目过滤；未绑定需求的旧任务不展示。
- 移动端：本次不做画布/画板适配；保留看板与总管，隐藏依赖 workspace canvas 的节点管理入口。

### 5.2 画布与画板

- `CanvasToolbar`：删除文本/图片按钮与 `CreateImageNodeDialog`；新增画板按钮。
- `CanvasPanel`：删除 `handleDrop` 与拖拽处理；新增 `onCreateDrawing`；可选节点加入 drawing；投喂提示更新。
- `createDrawing`：沿用当前 `App.tsx` 的需求阶段逻辑；节点标题「画板 N」。
- `DrawingEditor`：按 D6 重写加载/自动保存/关闭逻辑；增加保存状态与错误 UI；自动保存使用 `mode='source'`。
- `DrawingNode`：按 D5 渲染缩略图、`previewStale` 徽标与占位。
- `model.ts`：`CanvasNodeData` 增加 `previewUrl`；`toFlowNodes` 为 drawing 节点生成预览 URL；`CanvasRenderOptions` 增加 `deliveryId`。
- `apps/web/src/features/drawings/preview-renderer.ts`：按 D14 实现队列、`exportToBlob`、`mode='preview'` 保存、失败重试与页面加载补渲染。
- 正在编辑的 artifactId 注册表：用于跳过后台渲染与显示冲突横幅。

### 5.3 总管

- `SupervisorPanel`/`SupervisorComposer` 接收 `deliveryId/stageKey`，随 `supervisor.send` 发送；消息 meta 保存作用域用于重试。
- 作用域芯片显示「项目 / 需求 · 阶段」。
- 无需求时输入框保留，提示「选择一个需求后可读写画板」。
- `create_drawing`/`update_drawing` 的工具结果渲染为画板卡片：显示标题、元素数、缩略图，提供「打开画板」；点击后切换到对应需求并打开编辑器。
- 收到 `previewStale` 且该画板正在编辑时，显示冲突横幅与「加载最新 / 保留本地」。

### 5.4 文案

- 左栏、看板、创建对话框、阶段卡、提示语、e2e 选择器统一 `项目/需求`。
- 代码、协议、文档内部不改名。

## 6. 验收标准

1. 左栏是「通知 + 项目树」：无「全部项目」、无「项目画布」；项目展开显示需求看板、需求、新建需求。
2. 未选需求时主区为空态；选中需求后进入需求画布；顶部是面包屑，无项目切换器。
3. 工具栏只有画板、文件、分组、Agent、整理、投喂、标注、视口；无文本/图片按钮；画布不接受拖拽上传。
4. 新建画板 → 编辑 → 关闭 → 画布节点显示缩略图；重开与刷新内容不丢。
5. 画板加载失败显示错误与重试，不以空场景覆盖；关闭失败不丢编辑内容；无未保存静默关闭。
6. 总管在需求画布上读写跟随当前需求；无需求时明确提示；`get_drawing` 返回画板全部可读内容与元素 id；`list_canvas` 可读其他需求。
7. 总管能 `create_drawing` 并 `update_drawing`：写文字、画矩形/箭头/线/自由笔迹、插入工作区图片、移动/缩放/删除/改样式；画布出现对应节点与内容。
8. 总管写画板后，浏览器后台自动生成新缩略图；失败时显示「缩略图待刷新」，人打开画板后恢复。
9. 人类正在编辑的画板被总管更新时，出现冲突横幅；选择「加载最新」能看到总管内容。
10. 画板可投喂任务，任务上下文包含画板文字；文本/文件行为不变。
11. 需求级标注行为与现有测试完全一致；工作区级标注随项目画布隐藏，表/API/图片保留。
12. 全局通知能跨项目聚合，点击跳到对应任务现场；它使用注意力项，不复用总管 digest 通知。
13. `pnpm verify`、`pnpm verify:full` 通过；UI 改动附 ego-lite 截图（工具栏、缩略图、重开内容、项目-需求切换、总管画板卡片）。

## 7. 非目标

- 不做项目画布。
- 不做「全部项目」页面。
- 不做旧数据迁移/归档/自动删除；测试数据按 runbook 重置。
- 不退役标注系统；工作区级标注暂不迁移、不新增入口，后续单独决策。
- 不做画板多人协作、实时同步、多标签冲突合并（最后写入生效 + 冲突提示）。
- 不做画板模板。
- 不做移动端画板编辑。
- 不做总管删除画板节点（元素级删除可用；节点删除仍由人操作）。
- 不做远程图片 URL 抓取；图片只从工作区文件插入。
- 不做服务端 PNG 渲染；缩略图由浏览器后台生成。
- 不做画板内图片 OCR/多模态理解。
- 不做看板重构。

## 8. 测试

- core：`extractDrawingContent` 单测（纯文字、图文、排序、损坏 JSON、硬上限）；`applyDrawingOperations` 单测（每种操作、标签绑定、删除、样式）；`assembleContext` drawing 快照；`NodeType` 变更。
- daemon：artifact `mode` 分支（source/full/preview）；drawing 节点同步与 `previewStale`；`create_drawing`/`update_drawing` 操作与限制；图片插入（路径 jail、MIME、大小）；`get_drawing` 分页与截断；`list_canvas` 作用域；总管读写作用域；attention 聚合排序；投喂 drawing。
- web：ProjectTree 展开/懒加载/通知跳转；DrawingEditor 三态、自动保存 debounce、关闭 flush、放弃确认；DrawingNode 缩略图与 stale 徽标；预览渲染队列；冲突横幅；工具栏。
- e2e：项目 → 需求 → 画板完整链路；刷新持久化；总管创建/编辑画板（可用 mock 模型）；缩略图自动刷新；旧 workspace canvas 不出现在 UI。
- 兼容性：用真实 Excalidraw 编辑器打开总管生成的场景，验证文字/形状/箭头/图片/标签渲染正常。
- 回归：标注、交付阶段、验收、打包检查。

## 9. 实施计划

1. **P1 项目-需求树与需求画布壳**：App 壳、ProjectTree、顶部/面包屑、空态、需求看板/任务看板过滤、文案统一、`GET /api/attention` 与通知区。
2. **P2 工具栏与内容入口**：工具栏收敛、`CanvasAddType`、`onCreateDrawing`、文本/图片按钮移除、拖拽上传移除、文件按钮保留、投喂文案。
3. **P3 画板编辑器、缩略图与内容抽取**：core 抽取函数、DrawingEditor 三态/自动保存/关闭保护、`mode` 分支、drawing 节点同步、DrawingNode 缩略图、预览 URL、Realtime 失效。
4. **P4 总管作用域与读取**：协议字段、消息 meta、ToolContext/resolver、overview、`list_canvas`、`get_drawing`、prompt。
5. **P5 总管画板写入与后台预览**：`create_drawing`/`update_drawing`、scene mutation、图片插入、限制/审计/串行队列、`previewStale`、浏览器预览渲染、冲突横幅、工具结果卡片。
6. **P6 画板进任务上下文**：NodeType、assembleContext、drawing 预读、投喂白名单、快照与集成测试。

P1/P2 可并行；P4 依赖 P1 作用域与 P3 抽取；P5 依赖 P3/P4；P6 依赖 P3/P5。

## 10. 数据重置 runbook（不自动执行）

当前数据均为测试数据，升级前由用户手动执行：

1. 停止 daemon 与 web。
2. 备份后删除 `~/.baton/baton.db`；如需彻底清理，删除各工作区 `.baton/` 产物目录。
3. 重新启动，创建项目与需求。
4. 旧 workspace canvas 与未绑定任务不再进入新 UI；不做破坏性 migration。

## 11. 风险

- Excalidraw 场景 JSON 版本漂移：服务端 mutation 必须用真实编辑器验证；元素字段以当前 0.18 为准。
- 总管生成的坐标/尺寸可能重叠或出界；依赖 `get_drawing` 的 bounds 与 prompt 约束，必要时人工整理画布。
- 画板内嵌图片可能触及 10MB 上限；需要明确错误提示与数量上限。
- 浏览器后台 `exportToBlob` 可能受字体/DOM 影响；需要真实浏览器验证，失败时保留 stale 徽标。
- 多标签页/人与总管同时编辑时最后写入生效；需要冲突横幅，无法完全避免覆盖。
- 项目很多时左栏需求查询增多；按项目懒加载。
- 总管作用域需要随消息重试持久化，否则会串画布。
- 旧数据未重置时会出现不可见但残留的 workspace canvas 与未绑定任务；runbook 要求重置。
- 移动端暂不支持画布/画板，保留看板与总管。

## 12. 文档与后续

- 新增 ADR：`docs/adr/0012-requirement-only-canvas.md`，记录「取消项目画布、需求画布唯一、总管作用域跟随需求、总管拥有画板写权限」四项决定，回链 ADR 0011。
- 更新 `docs/README.md` 的 spec/ADR 索引。
- 不修改 `DESIGN.md`（缩略图/工具卡使用现有 `surface/separator/muted/foreground` token）。
- 无新增依赖，`THIRD_PARTY_NOTICES.md` 不变。
- 标注系统、验收、状态机除总管画板工具外不在本次改动范围。
