---
spec_topic: canvas-drawing-scope
decision_summary: "画布收敛为需求画布：多项目树按项目挂需求，工具栏以画板为主，画板缩略图与自动保存闭环，总管读写跟随当前需求，画板内容进入总管与任务上下文"
design_approved: true
user_approved_at: 2026-11-24T17:10:52+08:00
gates: [design-approved]
spec_ref: 2026-11-22-m7-delivery-playbook-design.md
domain_terms: [project, requirement, delivery-canvas, drawing, drawing-thumbnail, canvas-scope, drawing-content, attention-inbox]
---

# 画布与画板收敛设计

> 子 spec。回链 M7 交付工作台：`docs/specs/2026-11-22-m7-delivery-playbook-design.md`，以及 M2 总管：`docs/specs/2026-11-18-m2-supervisor-design.md`。
> 本 spec 覆盖 M7 中与画板缩略图、画布归属、总管画布可见性相关的实现偏差；不修改已锁定的 M7 决策原文。
> 本 spec 不引入数据库迁移：现有数据均为测试数据，按第 10 节重置后从新模型开始。

## 1. 背景

当前产品在画布与画板上有四个具体问题：

1. **工具栏职责重叠**：`apps/web/src/features/canvas/CanvasToolbar.tsx` 同时提供文本、文件、图片、分组、Agent、整理、投喂、标注；用户实际用画板承载文案、图片与圈画，文本/图片按钮成为噪声。
2. **画板只显示空框**：`apps/web/src/features/canvas/nodes/DrawingNode.tsx` 只渲染标题；`thumbnailPath` 从创建起恒为 `null`，后端保存时明确跳过 drawing 节点同步（`apps/daemon/src/artifact/service.ts:89-92`、`:316`）。
3. **画板会丢内容**：关闭遮罩一定触发保存（`apps/web/src/features/drawings/DrawingEditor.tsx:87`）；加载失败被静默吞掉（`apps/web/src/features/drawings/DrawingEditor.tsx:44-46`），编辑器以空场景打开，关闭时把空场景写回；没有自动保存、脏状态和未保存提示。
4. **总管看不到需求画布**：总管硬编码读取项目画布（`apps/daemon/src/supervisor/service.ts:1047` 使用 `getCanvasByWorkspace`），`supervisor.send` 没有 `deliveryId`（`packages/protocol/src/supervisor.ts:134-144`）；需求画布与画板内容完全不进总管上下文。
5. **信息架构混乱**：左栏是交付列表，顶栏是项目切换器，主区在项目画布/需求画布/看板之间切换；"项目"与"需求"的归属关系在界面上不可见。

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
- 未选中需求时，主区显示空态「选择一个需求，或新建需求」；总管只做项目级问答，不读写画布。
- 项目级 `canvas.delivery_id IS NULL` 不再进入新 UI；后端保留空行以兼容旧代码，不删除、不迁移。
- **不新增 workspace 级 artifact**：画板只存在于需求画布，仍按 `deliveryId + stageKey` 存储。

### D3 UI 术语统一为「项目 / 需求」

- 用户可见文案：`工作区 → 项目`、`交付 → 需求`。
- 代码标识符、协议、数据库、文档内部仍使用 `workspace` / `delivery`。
- 顶部移除项目切换器；主区改为只读面包屑「项目 A / 需求 A-1」。

### D4 工具栏收敛

- 固定按钮：画板、文件、分组、Agent、整理画布、投喂给任务、快速标注、适应视图/放大/缩小。
- 移除「添加文本」「添加图片」按钮与图片对话框。
- 拖拽上传文件/图片保留，仍生成 file/image 节点。
- 文本节点模型保留：总管 `create_text`、任务结果节点、任务交接节点继续可用，只是工具栏不再手动新建。
- `CanvasAddType` 改为 `drawing | file | agent | group`；`CanvasPanel` 增加 `onCreateDrawing` 回调。
- 需求浮层保留标题/目标/阶段条/进度/等待/验收矩阵/停止交付/快速标注/标注 N；移除「新建画板」（移到工具栏）。

### D5 画板节点与缩略图

- `drawing` 节点继续引用 `artifact`（Excalidraw `.excalidraw` + PNG 预览 + SVG）。
- 保存时后端在同一事务内同步 drawing 节点：
  - `data.status = 'ready'`；
  - `data.thumbnailPath = artifact.path`（PNG）；
  - `node.updatedAt = now`。
- 前端 `model.ts` 为 drawing 节点注入预览 URL，`DrawingNode` 渲染缩略图：
  - 顶部：图标 +「画板」+ 状态；
  - 主体：`object-contain` 缩略图，背景用 `bg-surface`；
  - 底部：标题 +「双击编辑」；
  - 无预览或加载失败时显示占位。
- 新建画板节点尺寸 360×260；标题默认「画板 N」。
- 预览 URL 带 `v=node.updatedAt` 做缓存失效；保存后前端失效 `artifacts + deliveryCanvas` 查询。

### D6 画板编辑器数据安全

- 编辑器三态：`loading / ready / error`。
  - 加载 404（还没保存过）→ 空画板；
  - 网络或 JSON 解析失败 → error 态，显示错误与重试，**禁止保存**；
  - 未进入 ready 不挂 Excalidraw、不产生 api，关闭不写盘。
- 自动保存：
  - `onChange` 标记 dirty + 2s debounce，只写 `.excalidraw` 源文件（`autosave: true`）；
  - 不生成 PNG/SVG、不写审计、不广播 `artifact.updated`；
  - 单飞队列：保存中再次变更只标记 pending，完成后补一次；
  - 失败显示「自动保存失败 + 重试」，保留编辑内容。
- 显式保存 / 关闭：
  - 生成 source + PNG + SVG 三件套（`autosave: false`），写审计、`status=ready`、同步节点、广播 `artifact.updated`；
  - 关闭前 flush；失败不关闭，提供「重试」与「放弃并关闭（二次确认）」；
  - dirty 时 `beforeunload` 提示。
- 画板 overlay `closeOnEscape=false`，避免编辑文字时按 Esc 误关；X 按钮走统一 `requestClose`。
- 不使用 localStorage/IndexedDB 存画板内容；状态只存内存。
- 单文件上限沿用 10MB；超限提示减少图片/笔迹。

### D7 画板内容抽取与 `get_drawing`

- 新增 `packages/core/src/drawing/scene.ts` 纯函数：
  - `extractDrawingContent(scene)` 返回全部文字元素（完整文本、位置、尺寸、绑定关系）与全部图形元素的紧凑结构 `{type,x,y,w,h,text?}`；
  - 跳过 `isDeleted`；按 `y → x → index` 稳定排序；
  - 图片只统计数量与 MIME，不读取 `files` 的 base64；
  - 不返回 `appState`、绝对路径；
  - 默认返回全部内容；只有超过硬上限（5000 元素或 200k 文本字符）才返回 `truncated` 并提供分页。
- 总管新增 `get_drawing` 工具：
  - 入参 `{ nodeId?, artifactId?, offset?, limit? }`，二选一；
  - 返回 `{ title, updatedAt, texts, elements, counts, totalTexts, totalElements, truncated, nextOffset? }`；
  - 校验节点/产物属于当前 workspace；不返回二进制。
- `list_canvas` 与 `<canvas_overview>` 仍是轻量摘要：文本预览、画板标题/摘要/计数；需要全文时用 `get_drawing`。

### D8 总管读写跟随当前需求

- 协议：`SupervisorSendInput` 增加可选 `deliveryId`、`stageKey`（必须成对）；`SupervisorMessageMeta` 持久化同字段，重试保持作用域。
- daemon `ToolContext` 增加 `deliveryId/stageKey`；`createTargetResolver.canvasFor` 使用当前需求画布，不再回退项目画布。
- 写工具（`create_text`、`create_agent`、`create_task`、`create_tasks`、`plan_tasks`、`batch_tasks`、`handoff_task`、`create_edge`、`update_node`、`arrange_canvas`）全部落在当前需求画布；新建任务绑定当前 `deliveryId + stageKey`；跨画布建边拒绝。
- 读工具：
  - `<canvas_overview>` = 当前需求画布，带 `scope="delivery"`、`delivery`、`stage` 属性；
  - `list_canvas` 默认当前需求，支持 `scope='delivery' + deliveryId` 读同项目其他需求；
  - `get_drawing` 按节点/产物读取任意同 workspace 画板；
  - 输出确定性截断并带 `truncated` 标记。
- 没有选中需求时：总管只做项目级问答与建需求（`create_delivery`），画布工具返回明确错误「先选择一个需求」。
- prompt：工具清单 29→30；新增作用域规则、画板文字是反馈、读画板用 `get_drawing`、不要读图片 base64。

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
  2. 备份后删除 `~/.baton/baton.db`（以及需要清理的 `.baton/deliveries` 产物目录）；
  3. 重新启动，按新模型创建项目与需求。
- 新的 `createWorkspace` 仍会创建一行 workspace canvas（兼容旧代码），但 UI 不再查询；后续单独清理。

### D12 全局通知

- 新增只读 `GET /api/attention?limit=20`：跨项目聚合需要人处理的任务与需求（待审批/待回复/待验收/失败/等待），返回 `{ workspaceId, workspaceName, deliveryId, deliveryTitle, stageKey, taskId, title, kind, waitingSince }`；按等待时间升序，上限 50。
- 左栏「通知 N」使用该接口；有通知的项目在项目行显示圆点。
- 不做通知已读/未读状态；不新增表。

## 3. 协议与 API 变更

### 3.1 协议

- `packages/protocol/src/enums.ts`：`NodeType` 增加 `artifact`、`drawing`。
- `packages/protocol/src/supervisor.ts`：
  - `SupervisorSendInput` 增加 `deliveryId?: Id`、`stageKey?: string(1..32)`；
  - `SupervisorMessageMeta` 增加 `deliveryId: Id.nullable().default(null)`、`stageKey: string.nullable().default(null)`。
- `apps/daemon/src/supervisor/tools.ts`：
  - `listCanvasInput` 增加 `scope?: 'current' | 'delivery'`、`deliveryId?: Id`；
  - 新增 `getDrawingInput`、`get_drawing` 工具。
- `ArtifactSaveInput` 增加 `autosave: boolean = false`（不改变现有字段语义）。
- 无数据库 schema 变更。

### 3.2 REST

- `GET /api/attention?limit=20`：跨项目注意力聚合，只读。
- 其余沿用现有接口：
  - 需求/画布：`GET /api/canvas?workspaceId&deliveryId`；
  - 产物：现有 delivery 级创建/保存/内容路由；
  - 总管：WS `supervisor.send`。

### 3.3 总管工具

- `get_drawing({ nodeId?, artifactId?, offset?, limit? })`
- `list_canvas({ limit?, scope?, deliveryId? })`
- `<canvas_overview scope="delivery" delivery="..." stage="..." total shown truncated>`
- 工具总数 30；prompt 同步更新。

## 4. 后端实现

### 4.1 画板保存与节点同步

- `apps/daemon/src/artifact/service.ts`：
  - `saveArtifactContent` 接收 `autosave`；
  - `autosave=true`：只写 source，不写审计、不广播、不 bump version、不改 status；
  - `autosave=false`：写三件套、审计、`status='ready'`、广播、同步 drawing 节点；
  - 新增 `syncDrawingNode(tx, artifact)`：按 `artifactId` 找到 delivery canvas 上的 drawing 节点，更新 `status/thumbnailPath/updatedAt`。
- `DrawingNode` 预览 URL 使用现有 `artifactContentUrl(deliveryId, artifactId, 'preview')` + `v=updatedAt`。
- `RealtimeProvider` 在 `artifact.updated` 时失效当前 `deliveryCanvas + artifacts` 查询（如尚未失效）。

### 4.2 总管作用域

- `apps/daemon/src/supervisor/service.ts`：从 `SupervisorSendInput` 取 `deliveryId/stageKey`，校验同 workspace；写入 `ToolContext` 与消息 meta。
- `apps/daemon/src/supervisor/target.ts`：`canvasFor` 优先 `getCanvasByDelivery`；无需求时抛 `canvas_not_found`，错误信息带「先选择一个需求」。
- 任务创建路径：`create_task/create_tasks/plan_tasks/batch_tasks/handoff_task` 在需求作用域下写入 `deliveryId/stageKey`。
- `list_canvas`：`scope='current'` 用当前需求；`scope='delivery'` 按 `deliveryId` 读取并校验 workspace；无当前需求且未指定 scope 时返回 `canvas_not_found`。
- `get_drawing`：解析 node/artifact → artifact service 读 source → core 抽取 → 分页返回。
- prompt 更新：工具清单、作用域规则、画板规则。

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
- `CanvasPanel`：新增 `onCreateDrawing`；可选节点加入 drawing；投喂提示更新。
- `createDrawing`：沿用当前 `App.tsx` 的需求阶段逻辑；节点标题「画板 N」。
- `DrawingEditor`：按 D6 重写加载/自动保存/关闭逻辑；增加保存状态与错误 UI。
- `DrawingNode`：按 D5 渲染缩略图与占位。
- `model.ts`：`CanvasNodeData` 增加 `previewUrl`；`toFlowNodes` 为 drawing 节点生成预览 URL；`CanvasRenderOptions` 增加 `deliveryId`。

### 5.3 总管

- `SupervisorPanel`/`SupervisorComposer` 接收 `deliveryId/stageKey`，随 `supervisor.send` 发送；消息 meta 保存作用域用于重试。
- 作用域芯片显示「项目 / 需求 · 阶段」。
- 无需求时输入框保留，提示「选择一个需求后可读写画布」。

### 5.4 文案

- 左栏、看板、创建对话框、阶段卡、提示语、e2e 选择器统一 `项目/需求`。
- 代码、协议、文档内部不改名。

## 6. 验收标准

1. 左栏是「通知 + 项目树」：无「全部项目」、无「项目画布」；项目展开显示需求看板、需求、新建需求。
2. 未选需求时主区为空态；选中需求后进入需求画布；顶部是面包屑，无项目切换器。
3. 工具栏只有画板、文件、分组、Agent、整理、投喂、标注、视口；无文本/图片按钮；拖拽上传仍可用。
4. 新建画板 → 编辑 → 关闭 → 画布节点显示缩略图；重开与刷新内容不丢。
5. 画板加载失败显示错误与重试，不以空场景覆盖；关闭失败不丢编辑内容；无未保存静默关闭。
6. 总管在需求画布上读写跟随当前需求；无需求时明确提示；`get_drawing` 返回画板全部可读内容；`list_canvas` 可读其他需求。
7. 画板可投喂任务，任务上下文包含画板文字；文本/文件/图片行为不变。
8. 需求级标注行为与现有测试完全一致；工作区级标注随项目画布隐藏，表/API/图片保留。
9. 全局通知能跨项目聚合，点击跳到对应任务现场；它使用注意力项，不复用总管 digest 通知。
10. `pnpm verify`、`pnpm verify:full` 通过；UI 改动附 ego-lite 截图（工具栏、缩略图、重开内容、项目-需求切换）。

## 7. 非目标

- 不做项目画布。
- 不做「全部项目」页面。
- 不做旧数据迁移/归档/自动删除；测试数据按 runbook 重置。
- 不退役标注系统；工作区级标注暂不迁移、不新增入口，后续单独决策。
- 不做画板多人协作、实时同步、多标签冲突合并（最后写入生效）。
- 不做画板重命名与模板。
- 不做移动端画板编辑。
- 不做总管写画板内容。
- 不做画板内图片 OCR/多模态理解；图片只给数量与 MIME。
- 不做看板重构。

## 8. 测试

- core：`extractDrawingContent` 单测（纯文字、图文、排序、损坏 JSON、硬上限）；`assembleContext` drawing 快照；`NodeType` 变更。
- daemon：artifact autosave/manual 行为；drawing 节点同步；`get_drawing` 分页与截断；`list_canvas` 作用域；总管读写作用域；attention 聚合排序；投喂 drawing。
- web：ProjectTree 展开/懒加载/通知跳转；DrawingEditor 三态、自动保存 debounce、关闭 flush、放弃确认；DrawingNode 缩略图；工具栏。
- e2e：项目 → 需求 → 画板完整链路；刷新持久化；总管作用域（可用 mock 模型）；旧 workspace canvas 不出现在 UI。
- 回归：标注、交付阶段、验收、打包检查。

## 9. 实施计划

1. **P1 项目-需求树与需求画布壳**：App 壳、ProjectTree、顶部/面包屑、空态、需求看板/任务看板过滤、文案统一、`GET /api/attention` 与通知区。
2. **P2 工具栏与画板入口**：工具栏收敛、`CanvasAddType`、`onCreateDrawing`、文本/图片按钮移除、拖拽保留、投喂文案。
3. **P3 画板编辑器、缩略图与内容抽取**：core 抽取函数、DrawingEditor 三态/自动保存/关闭保护、`autosave`、drawing 节点同步、DrawingNode 缩略图、Realtime 失效。
4. **P4 总管作用域与读取**：协议字段、消息 meta、ToolContext/resolver、overview、`list_canvas`、`get_drawing`、prompt。
5. **P5 画板进任务上下文**：NodeType、assembleContext、drawing 预读、投喂白名单、快照与集成测试。

P1/P2 可并行；P4 依赖 P1 作用域与 P3 抽取；P5 依赖 P3/P4。

## 10. 数据重置 runbook（不自动执行）

当前数据均为测试数据，升级前由用户手动执行：

1. 停止 daemon 与 web。
2. 备份后删除 `~/.baton/baton.db`；如需彻底清理，删除 `.baton/deliveries` 等产物目录。
3. 重新启动，创建项目与需求。
4. 旧 workspace canvas 与未绑定任务不再进入新 UI；不做破坏性 migration。

## 11. 风险

- Excalidraw `onChange` 频繁触发；自动保存必须 debounce + 单飞，避免写放大。
- 画板内嵌图片可能触及 10MB 上限；需要明确错误提示。
- 多标签页编辑同一画板时最后写入生效；本 spec 不做锁。
- 项目很多时左栏需求查询增多；按项目懒加载。
- 总管作用域需要随消息重试持久化，否则会串画布。
- 旧数据未重置时会出现不可见但残留的 workspace canvas 与未绑定任务；runbook 要求重置。
- 移动端暂不支持画布/画板，保留看板与总管。

## 12. 文档与后续

- 新增 ADR：`docs/adr/0012-requirement-only-canvas.md`，记录「取消项目画布、需求画布唯一、总管作用域跟随需求」三项决定，回链 ADR 0011。
- 更新 `docs/README.md` 的 spec/ADR 索引。
- 不修改 `DESIGN.md`（缩略图使用现有 `surface/separator/muted/foreground` token）。
- 无新增依赖，`THIRD_PARTY_NOTICES.md` 不变。
- 标注系统、验收、状态机不在本次改动范围。
