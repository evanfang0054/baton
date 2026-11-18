---
spec_topic: m1-6b-canvas-context
decision_summary: "M1-6b：画布上下文闭环——多选节点建任务、任意节点连线作为关系写入 prompt、任务创建时持久化上下文快照；不含运行中 context.inject 与语义化边类型"
design_approved: true
user_approved_at: 2026-11-18T18:17:10+08:00
gates: [user-review-passed]
spec_ref: 2026-11-16-baton-architecture-design.md
---

# M1-6b 画布上下文与关系设计

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：M1-6a 任务控制台（已合并）、M1-7a/7c 真实 Claude 与审批/提问（已合并）。
> 本文只锁定 M1-6b 的最小集：画布多选上下文 + 连线关系 + 任务上下文快照。
> 运行中 `context.inject`、语义化边类型、group/image/review 节点 UI、`canvas.patch`、向量召回、`task.reopen`、M1-7b 明确排除。

## 0. 文档信息

- **状态**：设计已获用户逐项确认，待 spec 评审与实施。
- **范围**：`packages/protocol/**`、`packages/core/src/context/**`、`apps/daemon/**`、`apps/web/**`、migration 与 lockfile、`docs/**`。
- **不在范围**：运行中 `context.inject`、边的 `depends_on/derives_from/references` 类型、group/image/review 节点的新增 UI、`canvas.patch` 多端同步、通知、移动端、worktree、总管、M1-7b。
- **文档位置**：spec 落 `docs/specs/`，contract 落 `docs/contracts/`，plan 落 `docs/plans/`。

## 1. 背景

M1 已全部合并（`main` `7449dac`）。当前闭环是：画布建 Agent 节点 → 建任务 → 立即开工 → 真实 Claude 执行 → 审批/提问 → verify → 人工验收。看板、详情、transcript、trust 与跳权限都已可用。

但「画布 = 共享内存」尚未成立：

- `apps/web/src/features/tasks/CreateTaskForm.tsx:92` 固定发送 `contextNodeIds: []`，画布上的需求、spec、设计稿不会进入 prompt。
- `edge` 只有 DB 表、协议实体与 `listEdges` 读取；没有 `edge.create/delete` 命令，也没有画布连线交互。
- `apps/daemon/src/runtime/task-service.ts:119` 已经调用 `assembleContext`，支持显式选择、目标 Agent 直接前驱、反向闭包、预算与敏感路径排除；缺的是入口与可解释性。
- `assembleContext` 只把边当作内容闭包，不把「节点之间的关系」写进 prompt；用户无法表达「A 依赖 B」并让 Agent 知道。

`baton.ai` 两份材料的核心是「任务 > session」「人只在闸门出现」。M1 已把任务注意力做实；M1-6b 要把「上下文从哪来、为什么是这些」做实，也是后续总管派活的前置。

## 2. 目标与非目标

**目标**

1. 建任务时把画布当前选中的内容节点作为显式上下文，提交真实的 `contextNodeIds`。
2. 支持任意节点类型之间创建/删除 `context` 边；关系本身以 XML 写入 prompt。
3. 任务创建时固化上下文快照（注入项、排除项、截断、敏感排除、关系），详情页可解释；旧任务不回溯。
4. 删节点时级联删除其边；被任务引用仍拦截。

**非目标**

- 运行中向活跃 session 注入上下文（`context.inject`）。
- 边的语义分类；本轮只有 `context`。
- 向量召回、跨画布引用、自动布局。
- 多端同时编辑的 `canvas.patch`；仍用「命令 ack 后重拉画布」。
- 修改任务 prompt 的既有内容预算（48k / 16k）。

## 3. 关键决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 方向 | M1-6b 最小集 | 后端装配已就绪，缺入口与可解释性；也是总管派活前置 |
| D2 | 范围 | 多选 + 连线 | 不做运行中投喂；不把风险扩到 session 生命周期 |
| D3 | 快照存储 | `task.context_json` 单列 | 一次写入、随详情返回；本轮没有跨任务分析需求 |
| D4 | 快照回溯 | 旧任务为 `null`，不回填 | 无法可靠重建历史选择与预算 |
| D5 | 连线交互 | 手动连线 + 选中删除 | 与现有画布一致；拖拽快速建边成本与误触更高 |
| D6 | 建任务入口 | Agent 节点面板自动带当前选中 | 不新增入口；用 chips 可增删 |
| D7 | 选择模型 | 粘性上下文选择 | 点 Agent 打开面板不应清空已选内容节点 |
| D8 | 边类型 | 仅 `context` | 避免本轮引入分类法与旧数据语义 |
| D9 | 关系范围 | 至少一端在 `included ∪ {target}` | 目标 Agent 是任务定义的一部分，直连关系必须解释 |
| D10 | 端点限制 | 任意节点类型 | 关系本身是上下文；Agent/Group 不提供内容但可参与关系 |
| D11 | 渲染格式 | XML `<relations>` | 与 `<task>/<context>` 一致，可快照测试、token 可控 |
| D12 | 边校验 | 禁自环/重复/跨画布 | 重复无新增信息，自环无意义，跨画布无效 |
| D13 | 删节点 | 级联删边，任务引用仍拦截 | 边是画布结构；避免「先删边再删节点」 |
| D14 | 关系预算 | 200 条 / 4k 字符，独立于内容预算 | 防止高度连通画布放大 prompt |
| D15 | 预览 | 不做额外 preview API | 创建后在详情核对，再点「立即开工」 |
| D16 | 验收 | 新增段 Playwright + ego-lite | 自动化回归 + 真实引擎证据 |

## 4. 协议增量

### 4.1 WS 命令

沿用 `node.create/update/delete` 的模式：命令 ack 成功后 web 重拉画布；不新增广播事件。

```ts
EdgeCreateInput = z.object({
  sourceId: Id,
  targetId: Id,
  type: EdgeType.default('context'),
})

EdgeDeleteInput = z.object({ edgeId: Id })
```

- `edge.create` ack：`{ edgeId }`。
- `edge.delete` ack：`{}`。
- 两个输入加入 `ClientCommand` discriminated union；daemon 命令 switch 增加对应 `case`。
- 不传 `canvasId`：daemon 从两端节点推导并校验同画布，避免入参与事实不一致。

**校验顺序**

1. source/target 节点存在，否则 `node_not_found`（details 带 `nodeIds`）。
2. 两端同画布，否则 `edge_cross_canvas`。
3. `sourceId !== targetId`，否则 `edge_self_loop`。
4. 同 `(canvasId, sourceId, targetId, type)` 不存在，否则 `edge_duplicate`。
5. 事务插入；唯一索引作为并发兜底。

**删除语义**

- `edge.delete` 只删边，不影响已创建任务的 `prompt` 与 `context_json`；历史不可变。
- 边不存在返回 `edge_not_found`。

### 4.2 上下文快照

新增 `packages/protocol/src/context.ts`：

```ts
DropReason = z.enum(['budget', 'sensitive', 'limit', 'not_found', 'target', 'empty'])

ContextNodeRef = z.object({
  id: Id,
  type: NodeType,
  title: z.string(),
  depth: z.number().int().nonnegative(),
  chars: z.number().int().nonnegative(),
})

ContextDropped = z.object({
  id: Id,
  reason: DropReason,
  title: z.string().optional(),
})

ContextRelation = z.object({
  from: Id,
  to: Id,
  type: EdgeType,
  fromTitle: z.string(),
  toTitle: z.string(),
  includedFrom: z.boolean(),
  includedTo: z.boolean(),
})

ContextSnapshot = z.object({
  included: z.array(ContextNodeRef),
  dropped: z.array(ContextDropped),
  truncated: z.boolean(),
  redactedPaths: z.array(z.string()),
  relations: z.array(ContextRelation),
  relationsTruncated: z.boolean(),
})
```

- `included` 增加 `title`，快照自包含：节点后续改名/删除仍可解释。
- `dropped.title` 可选：`not_found` 没有标题；其余尽量记录。
- `includedFrom/includedTo` 指内容是否进入 `<context>`；目标 Agent 为 `false`，UI 结合 `task.nodeId` 标记为「目标」。
- `DropReason` 从 core 上移到 protocol；core 改为 import 并 re-export，避免两套枚举。

### 4.3 TaskDetail

```ts
TaskDetail = Task.extend({ context: ContextSnapshot.nullable() })
```

- 新增 `TaskDetail`，不改现有 `TaskDetailResponse` 的字段名；`TaskDetailResponse.task` 的类型从 `Task` 改为 `TaskDetail`。
- `GET /api/tasks/:id` 的 `task` 字段返回 `TaskDetail`。
- `TaskSummary` 与 `GET /api/tasks` 不变，避免看板列表变重。
- 读库时 `JSON.parse` + `ContextSnapshot.safeParse`；失败返回 `null` 并记 `context_snapshot_invalid` 警告，不阻塞任务操作。

## 5. 数据模型与迁移

Drizzle 变更：

- `task.context_json text`（nullable）。
- `edge` 增加唯一索引 `(canvas_id, source_id, target_id, type)`。
- 迁移 `0005`：
  1. `ALTER TABLE task ADD COLUMN context_json text;`
  2. 去重兜底：`DELETE FROM edge WHERE id NOT IN (SELECT MIN(id) FROM edge GROUP BY canvas_id, source_id, target_id, type);`
  3. `CREATE UNIQUE INDEX edge_unique_idx ON edge (canvas_id, source_id, target_id, type);`

迁移在 fixture DB 上验证升级；旧任务 `context_json` 为 `NULL`。

**删除节点**

- `node.delete` 先检查 `hasTaskForNode`，命中返回 `node_in_use / task`。
- 移除 `hasEdgeForNode` 拦截；同一事务内 `deleteEdgesForNode(tx, nodeId)` 后 `deleteNode(tx, nodeId)`。
- 相关测试与提示文案同步更新；前端已有的通用错误提示不需要新增代码。

## 6. core 上下文装配

`packages/core/src/context/types.ts`：

```ts
interface AssembleContextResult {
  prompt: string
  included: ContextNodeRef[]
  dropped: ContextDropped[]
  truncated: boolean
  redactedPaths: string[]
  relations: ContextRelation[]
  relationsTruncated: boolean
}
```

**关系候选**

- `scope = new Set([...includedIds, input.targetNodeId])`。
- 保留 `scope.has(edge.sourceId) || scope.has(edge.targetId)` 的边。
- 两端节点在内存中不存在时跳过（DB 外键阻止，防御性处理）。

**标题**

- text：首个非空行，截 60 字符。
- file：`data.name`；image：`data.alt ?? 'image'`。
- agent：`data.title`；group：`data.label`；review：`review`。
- 全部 XML 转义。

**渲染**

在 `</context>` 之后追加：

```text
<relations truncated="true">
  <edge from="n1" to="n2" type="context" from_title="需求" to_title="接口设计"/>
</relations>
```

- 无关系时不输出 `<relations>`。
- 未截断时不写 `truncated` 属性。
- 属性顺序固定：`from`、`to`、`type`、`from_title`、`to_title`。

**排序与预算**

- 候选先按「两端都注入」优先，再按 `from`、`to`、`type` 升序。
- 逐条渲染，超过 200 条或 4k 字符即停止，`relationsTruncated = true`。
- 关系字符不占内容 48k 预算；快照记录实际渲染的关系。

**快照**

`task-service` 直接把本次 `assembleContext` 的返回值映射为 `ContextSnapshot` 并写入 `context_json`，不二次计算、不重新读画布。

## 7. daemon

- 新增 `apps/daemon/src/runtime/edge-service.ts`：`createEdge(deps, input)`、`deleteEdge(deps, input)`；校验、事务与错误码集中在 service，`runtime/index.ts` 只做 `case` 分发。
- `db/repositories.ts` 增加 `getEdge`、`findEdge`、`insertEdge`、`deleteEdge`、`deleteEdgesForNode`；`insertTask` 接受可选 `contextJson`。
- `task-service` 写入快照；`GET /api/tasks/:id` 返回 `TaskDetail`。
- `node.delete` 级联删边。
- 不新增 REST 端点；边只走 WS 命令，与节点一致。

## 8. web

### 8.1 选择模型

- React Flow 开启 Shift 框选 + Cmd/Ctrl 点击多选；默认拖拽仍用于平移，避免与框选冲突。
- Zustand 新增 `contextNodeIds: string[]` 与 `selectedNodeIds: string[]`：
  - `selectedNodeIds` 反映当前画布选择，用于 UI 高亮。
  - `contextNodeIds` 是**粘性上下文选择**：仅当当前选择包含至少一个内容节点（text/file/image/group）时更新；选择为空或只有 Agent/Review 时保留旧值；显式「清空」按钮重置。
- 这样从「选中 3 个内容节点」到「点击 Agent 打开面板」不会丢上下文。

### 8.2 连线

- `NodeShell` 增加 source/target `Handle`，悬停/聚焦可见；所有节点类型都可连接。
- `isValidConnection`：非自环、非重复（按当前 edges 判断）；类型只允许 `context`。
- `onConnect` 发送 `edge.create`，ack 后 `invalidateQueries` 重拉画布；失败 toast，不插入乐观边。
- 删除：`onEdgesDelete` 映射为 `edge.delete`；选中的边同时显示「删除连线」按钮，键盘 Delete/Backspace 可用。
- 节点删除级联由 daemon 处理，前端只刷新画布。

### 8.3 建任务

- `CreateTaskForm` 从 store 读取 `contextNodeIds`，过滤掉目标 Agent 自身，渲染 chips：
  - 类型图标 + 标题；可单个移除；显示「已选 N 个」。
  - 提示「连线依赖会自动包含，可在任务详情核对」。
- 提交时发送真实 `contextNodeIds`；成功后打开任务详情。
- 选中集为空时显示「按住 Shift 框选画布节点，或在节点面板打开前先多选」。

### 8.4 任务详情

新增「上下文快照」区：

- 概览：注入 N 个 / 排除 M 个 / 字符总数 / 是否截断。
- 注入项：类型 + 标题 + depth + chars。
- 排除项：标题/ID + 原因（预算、敏感、超限、目标、空、缺失）。
- 关系：`from_title → to_title`，徽标区分「两端注入 / 仅一端注入 / 目标」。
- 敏感路径：列出相对路径，标注「已排除」。
- 旧任务：显示「该任务创建于上下文快照上线前，未记录」。
- 快照解析失败：显示「上下文快照不可用」，其余详情照常。

### 8.5 无障碍与视觉

- 连线、chips、删除按钮均需键盘可达、焦点可见；状态用文字 + 图标，不只靠颜色。
- 颜色、间距、圆角一律使用 `DESIGN.md` token；不硬编码 hex。

## 9. 错误与边界

| 场景 | 行为 |
|---|---|
| 边两端不在同一画布 | `edge_cross_canvas`，toast，画布不变 |
| 自环 / 重复边 | `edge_self_loop` / `edge_duplicate`，toast |
| 删除不存在的边 | `edge_not_found` |
| 建任务时选中节点已被删 | `node_not_found`，toast + 刷新画布与选择 |
| 删边时任务已存在 | 允许；快照与 prompt 不变，提示「历史上下文不会改变」 |
| 删节点被任务引用 | `node_in_use / task`，保持现有拦截 |
| 快照 JSON 损坏 | 详情降级为「不可用」，记警告 |
| 关系超预算 | 确定性截断，`relationsTruncated=true`，UI 标「关系已截断」 |

## 10. 测试与验收

**单元 / 集成**

- protocol：`edge.create/delete` schema、`ContextSnapshot`、`TaskDetail`。
- core 快照：无连边、内容→Agent、内容→内容链、Agent/Group 端点、对端仅标题、排序、XML 转义、200 条/4k 截断、目标节点直连关系。
- daemon：edge-service 正常/自环/重复/跨画布/不存在；唯一索引兜底；node.delete 级联；task-service 快照写入；`GET /api/tasks/:id` 返回快照；旧任务 null；坏 JSON 降级。
- web：粘性选择、chips 增删、连线校验、删除动作、详情快照各分支。

**E2E**

- Playwright 新增段（route-mocked，沿用 `apps/web/e2e/journey.spec.ts` 风格）：框选两个文本节点 → 打开 Agent 面板 → 断言 chips → 建任务时 WS payload `contextNodeIds` 正确 → 详情渲染快照。
- `pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`check:boundaries`、`check:protocol`、`format:check` 全绿。

**真实链路**

- ego-lite + 真实 Claude：两个文本节点（约束 A/B）+ 一条关系 → 建任务“总结上下文中的约束与它们的关系” → 开工 → transcript 引用两个约束；详情快照显示 2 个注入、1 条关系。
- 截图与说明落 `docs/evidence/2026-11-18-m1-6b-canvas-context/`，截图前脱敏。

## 11. 性能与风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 高度连通画布放大 prompt | token 超预期 | 关系 200 条 / 4k 上限；内容预算不变 |
| prompt 格式变更 | 既有快照测试失败 | 只改 core 快照测试；已存任务 prompt 不受影响 |
| 唯一索引迁移失败 | 升级中断 | 迁移先去重再建索引 |
| 删节点行为变化 | 既有测试/提示不一致 | 更新测试与文案；任务引用仍拦截 |
| 粘性选择误留 | 用户以为没选 | chips 常显 + 清空按钮 + 数量提示 |
| 多端不同步 | 另一端看不到新边 | 单用户 v1；命令 ack 后本端重拉；`canvas.patch` 后置 |

## 12. 实施切片

1. **协议与 core**：`context.ts`、命令、TaskDetail、migration 0005、`assembleContext` 关系渲染与快照字段；core 快照测试。
2. **daemon**：edge-service/命令分发、仓储、node 级联、task 快照持久化、REST 详情；daemon 测试。
3. **web 画布**：多选与粘性选择、handles/连线/删除、chips；组件测试。
4. **web 详情与验收**：快照 UI、Playwright 新增段、ego-lite 真实链路与证据、文档索引。

每片结束跑 `pnpm verify`；第 4 片结束跑 `pnpm verify:full` 与 `pnpm pack:check`。

## 13. 评审记录

- 2026-11-18：用户逐项确认方向、范围、快照、连线、入口、关系语义与删节点边界；设计通过，进入 spec 评审。
