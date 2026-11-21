---
spec_topic: m6-task-scene
decision_summary: 'M6-1 任务现场 v0：画布按任务上下文派生聚焦，补 image/group/review 节点与总管整理，先做站内注意力可见性'
design_approved: true
user_approved_at: '2026-11-21T08:51:06+08:00'
gates: [design-approved]
spec_ref: 2026-11-16-baton-architecture-design.md
domain_terms:
  [
    task-scene,
    canvas-focus,
    derived-projection,
    image-node,
    group-node,
    review-card,
    preliminary-verdict,
    stale-task,
    needs-person,
    move-many,
    group-create,
    attention,
  ]
---

# M6-1 任务现场 v0：画布聚焦、画布节点补全与注意力回收

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：M1-M5-3 已合并；`main` 最新提交 `f57dcae`（PR #28 任务现场之前的最后一个迭代）。
> 背景材料：`baton.ai` 三份讨论稿（`dsh-superagent-prototype-架构拆解.md`、`复刻CanvasAgents工作台.md`、`肝了一周…`），不进仓库，只作为产品方向参考。
> 相关 spec：`docs/specs/2026-11-18-m1-6b-canvas-context-design.md`（画布上下文）、`docs/specs/2026-11-19-m3-delivery-acceptance-design.md`（diff/worktree/历史）、`docs/specs/2026-11-20-m4-supervisor-secretary-design.md`（预验收）、`docs/specs/2026-11-20-m5-supervisor-aftersales-design.md`（总管售后与批量）、`docs/specs/2026-11-21-m5-3-context-handoff-design.md`（上下文交接）。

## 0. 文档信息

- **状态**：设计已获用户确认（2026-11-21），spec 待用户审阅；尚未实现。
- **范围**：`packages/protocol/**`、`packages/core/**`、`apps/daemon/**`、`apps/web/**`、数据库 migration 0010、测试与 `docs/**`。
- **预期不改**：任务状态机与转移语义；`task.status` 单写者；`assembleContext` 的预算、深度、敏感路径规则；`node`/`edge` 表结构不变；`review` 只加 nullable 列；现有上传接口行为。
- **不在范围**：AC 清单、cost/turn、自动验收/代验收、自动批准次数上限（M5-4）；外部 Source（M5-2）；DAG/任务依赖；运行中 `context.inject`；续已结束旧 session；任务级独立画布表；多用户；手机画布现场；系统推送/短信；向量检索；图片 OCR。
- **命名**：本迭代叫 M6-1；核心概念叫“任务现场”（task scene），是一种派生视图，不是新的持久化实体。
- **文档位置**：仓库没有 `docs/agent-harness/` 与 `scripts/validate-handoff.sh`，按既有约定落 `docs/specs/`、`docs/contracts/`、`docs/plans/`；验收用 `pnpm verify:full`，不伪造 agent-harness 结构。
- **ADR**：本迭代没有不可逆决定，不新增 ADR。全部协议变更都是增量；数据库只加 nullable 列。

## 1. 背景

M1-M5-3 已把“单任务闭环 + 总管任务管理”做实：画布上下文与关系、真实 Claude 执行、审批/提问、verify、diff、worktree、retry/reopen、任务历史、总管建节点/建任务/开工/售后/批量/预验收、上下文交接。

但对照 `baton.ai` 材料，当前画布仍只是“上下文输入区”，不是“任务现场”：

- 画布只渲染 `text/file/agent`；`image/group/review` 在协议里已经存在，但没有 UI 和创建路径。
- 任务创建时的 `context` 快照只出现在右侧详情；选中任务后，画布上看不出“哪些节点属于它、它吃了什么上下文、产出了什么”。
- 总管只能 `create_text/create_agent/create_edge`，不能移动或重命名节点；`list_canvas` 也不返回坐标，无法“整理画布”。
- 看板有 attention、等待时长、digest，但桌面看板没有“需要我”过滤、没有按等待时长排序、没有 30 分钟 stale 标记；总管不会主动把挂起任务顶回注意力。
- 验收有 verify/diff 和预验收结论，但预验收结论只存在于总管消息/审计里，没有结构化字段；画布上没有 review 卡。

`复刻CanvasAgents工作台.md` 的核心是“画布即共享内存、节点即上下文切片、看板是任务状态的投影、总管做动态路由”；`dsh-superagent-prototype-架构拆解.md` 的核心是“状态由事实推导、面板只显示需要人的事、计数=列表长度”。本迭代只做这两条在 baton 当前架构下最自然的下一步：

1. 让画布能按任务聚焦，并补上 image/group/review 三类节点；
2. 让总管能整理画布，并把挂起任务重新带回注意力。

## 2. 目标与非目标

**目标**

1. 用户可以从任务详情或看板任务卡显式进入“任务现场”；现场突出该任务的 Agent、上下文节点、origin 上下文、相关分组框和 review 卡，其余节点降暗。
2. 现场支持“回到全局”，恢复折叠/选中/视口；现场不写数据库、不自动抢视口。
3. 画布支持 `image` 节点：本地上传、https 外链、受保护读取、失败占位；图片内容进入上下文装配时只输出路径/URL，不转 base64。
4. 画布支持 `group` 节点：选中建组、拖入/拖出自动改 `groupId`、整组拖动、折叠；删组只解绑子节点，不删内容。
5. 画布支持派生 `review` 卡：任务进入 `review` 时出现，离开后消失；显示状态、verify、diff、等待时长和初步验收结论；只读，点击打开任务。
6. 总管新增 `update_node`：可以移动节点、重命名 Agent；不能删除节点、不能改文本内容、不能建组/建图片；所有动作写审计。
7. `list_canvas` 返回节点坐标、尺寸和 `groupId`，让总管能基于真实布局整理画布。
8. 桌面看板增加“需要我”过滤、标题搜索、按等待时长排序、30 分钟 stale 标记；rail 显示“需要我”计数，且计数与列表长度一致。
9. 预验收结论写入 `review` 结构化字段，review 卡和任务详情都能读到；最终通过/打回仍然只能由人决定。
10. 覆盖 core 单测、protocol 测试、daemon 集成、web 组件、Playwright 与 ego-lite + 真实 Claude 验收。

**非目标**

- 不做任务级画布表，不把“任务现场”变成第二套状态。
- 不做 `image/group/review` 之外的节点类型扩展。
- 不做 AC 清单、cost/turn、自动批准次数上限（M5-4）。
- 不做外部 Source、Trigger/Thread/Subscription/Admission 表（M5-2）。
- 不做 DAG/任务依赖、计划实体、运行中 `context.inject`、续已结束旧 session。
- 不做自动验收/代验收；总管仍然不能 approve/reject。
- 不做系统推送、短信、手机通知；stale 只在站内可见。
- 不做手机画布现场；手机只保留看板过滤、排序和 stale 标记。
- 不做图片 OCR、图片向量化、图片内容理解；图片只作为路径/URL 进入上下文。
- 不做多用户、跨 workspace 现场、跨 workspace 分组。

## 3. 关键决策

| #   | 决策                 | 结论                                                                                                                                 | 理由                                                                 |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| D1  | 现场形态             | 派生视图：由 `task.context` + `task.origin` + 当前 nodes/edges 计算，不建任务级画布表                                                | 状态不存、由事实推导；避免和 workspace canvas 形成第二真相源          |
| D2  | 现场入口             | 任务详情头部 + 看板任务卡动作；显式点击才进入                                                                                        | 避免自动抢视口；参考 CanvasAgents 的“视口控制权”警告                 |
| D3  | 现场范围             | 目标 Agent + `context.included` + `origin.contextNodeIds` + 相关 group 框 + review 卡；只保留相关节点之间的边；相关 group 临时展开  | 按任务快照收敛，不用整组扩散；现场可解释                             |
| D4  | 现场交互             | 现场只读聚焦：无关节点降暗且不可编辑；退出恢复折叠/视口；不写数据库                                                                  | 防止现场误操作；现场是“看”，编辑回全局                               |
| D5  | 图片存储             | 本地图片上传到 `.baton/uploads`，`ImageNode.src` 存 workspace 相对路径；外链存 `https://` URL                                        | 复用现有上传与 jail；本地路径对 Worker 可读；外链不落文件             |
| D6  | 图片读取             | 新增 `GET /api/workspaces/:id/uploads/:name`，只服务 `.baton/uploads`，auth + realpath jail + MIME 白名单                            | 不给通用文件读取面；图片只从受控目录出                             |
| D7  | 图片格式             | png/jpeg/webp/gif/svg，沿用 10MB；禁止 data URL、file URL、带凭据 URL、javascript URL；SVG 只在 `<img>` 渲染并加 CSP sandbox         | 满足“都要”，同时不给脚本执行/SSRF/凭据泄露面                         |
| D8  | 外链                 | 仅 https；daemon 不抓取、不代理；浏览器直接加载，`referrerPolicy="no-referrer"`                                                      | 避免 SSRF 与 daemon 侧网络面；隐私泄漏最小化                         |
| D9  | 分组创建             | 新增 `group.create`：新建 group + 批量设置子节点 `groupId`，同事务                                                                   | 避免逐节点 update 的部分失败                                         |
| D10 | 分组拖动             | 新增 `node.move_many`：group 与子节点绝对坐标一次提交，同事务                                                                        | 保持 x/y 绝对坐标语义；避免逐节点 update 与半更新                    |
| D11 | 分组成员             | 拖入/拖出按节点中心点判定；重叠取面积最小的 group；删 group 先把子节点 `groupId = null` 再删组，同事务                                | 交互直觉；删组不删内容                                               |
| D12 | 分组折叠             | 折叠只影响画布显示；`assembleContext` 仍展开 group 的内容节点                                                                        | 折叠是视觉整理，不是权限/上下文开关                                  |
| D13 | Review 卡            | 派生投影，不落库；`review` 时出现，离开后消失；只读；点击打开任务                                                                    | 不产生冗余节点；状态由 task/review 事实推导                          |
| D14 | 初步验收结论         | `review` 新增 `preliminary_verdict/reason/at` 三个 nullable 字段 + migration 0010；验收员写，缺失为 null                            | 避免从审计/验收员 transcript 猜；review 卡可直接读                   |
| D15 | 初步结论语义         | 只是建议，不等于人工通过；review 卡和详情都必须显示“最终由人决定”                                                                   | 延续 ADR 0009 的人工终审原则                                         |
| D16 | 总管画布操作         | 新增 `update_node`：移动任意节点、重命名 Agent；不删除、不改文本、不建组/图片；写审计                                                | 可逆、低风险；删除/建组仍由人操作                                    |
| D17 | 总管画布感知         | `list_canvas` 补 `x/y/w/h/groupId`                                                                                                   | 没有坐标就无法“整理画布”                                             |
| D18 | 注意力               | 复用 `needsPerson` 作为“需要我”口径；等待排序；30 分钟 stale 标记；rail 计数=列表长度；不新增通知                                   | 先做可见性，不制造噪音；与 dsh 面板原则一致                          |
| D19 | 移动端               | 现场只桌面/平板；手机保留看板过滤、排序、stale；手机不挂画布                                                                         | 触控画布成本高；手机的任务控制面已经存在                             |
| D20 | 证据深度             | 现场只做节点聚焦 + review 摘要；transcript/diff 正文留在任务详情                                                                     | 避免画布变成第二个详情页；信息密度可控                               |
| D21 | 协议变更             | 增量：`node.update` 增加 `groupId`、新增 `node.move_many`/`group.create`、`review` 新字段、`review.preliminary` 事件；不改 `NodeType` | 让类型错误暴露影响面；不破坏现有语义                                 |
| D22 | 数据库               | 只加 `review` 三列；不改 `node`/`edge`/`task` 表                                                                                     | 迁移最小；旧数据可空兼容                                             |

## 4. 领域模型与数据结构

### 4.1 任务现场（TaskScene）

```ts
export interface TaskScene {
  taskId: string
  relatedNodeIds: string[]
  relatedEdgeIds: string[]
  /** 需要临时展开的 group；现场退出后恢复原折叠状态。 */
  expandGroupIds: string[]
  /** context/origin 引用但当前画布已不存在的节点。 */
  missingNodeIds: string[]
  /** 是否显示派生 review 卡。 */
  showReviewCard: boolean
  /** review 卡固定位置；Agent 缺失时回退 (0, 0)。 */
  reviewCardPosition: { x: number; y: number }
}
```

`buildTaskScene(task: TaskDetail, nodes: Node[], edges: Edge[]): TaskScene` 规则：

1. `related = (task.nodeId ? {task.nodeId} : ∅) ∪ context.included[].id ∪ origin.contextNodeIds`。
2. `missingNodeIds = related - nodes.id`；`relatedNodeIds` 只保留当前存在的节点。
3. `expandGroupIds`：对每个相关节点，如果 `groupId` 非空且该 group 存在且 `collapsed=true`，加入展开集合；v0 不支持 group 嵌套，忽略 group 的 `groupId`。
4. `relatedEdgeIds`：只保留 source/target 都在 `relatedNodeIds` 的边。
5. `showReviewCard = task.status === 'review'`；位置优先用 Agent 节点右侧 `(x + w + 40, y)`，Agent 缺失时 `(0, 0)`。
6. 纯函数：不读时间、不读文件、不访问随机数；同一输入逐字节一致。

### 4.2 派生 Review 卡

- 节点 ID：`review:${taskId}`，只存在于 web 视图模型，不写入 `node` 表。
- 数据来源：`TaskSummary`（status/attention/waitingSince）+ 可选 `TaskDetail.review`（verifyExitCode/diffStat/preliminary）。
- 全局画布：对每个 `status === 'review'` 的任务显示简化卡（标题/状态/等待），不额外拉详情。
- 现场：当前任务详情已加载，卡片补充 verify/diff/初步结论。
- 交互：点击打开任务详情；不可拖动、不可删除、无通过/打回按钮。

### 4.3 分组（Group）

- 复用 `Node` 的 `group` 类型与 `NodeBase.groupId`；`group` 节点自身不能再有 `groupId`（v0 不支持嵌套）。
- `group.create` 输入：`canvasId`、`x/y/w/h`、`label`、`childIds[]`。
- 成员变更：`node.update` patch `groupId: Id | null`；daemon 校验目标 group 与节点同 canvas，且 group 不是节点自身、不是 group 节点。
- 建组来源：只允许当前选中且 `groupId === null` 的非 group 节点；有任一选中节点已在分组中时拒绝，避免隐式改组。
- 拖入/拖出：web 在 `onNodeDragStop` 用节点中心点与 group 边界判定；重叠时取面积最小的 group。
- 整组拖动：`node.move_many` 输入 `canvasId` + `moves: [{nodeId,x,y}]`；同事务校验所有节点属于该 canvas，然后逐条更新；任一失败回滚。
- 删除 group：`node.delete` 在 daemon 中识别 `type === 'group'`，先把 `groupId === group.id` 的子节点置空，再删 group；同事务。若 group 被任务引用？上下文快照只引用内容节点，不引用 group；无需额外 guard。

### 4.4 图片（Image）

- `ImageNode.data.src`：
  - 本地：`.baton/uploads/<server-file-name>`（workspace 相对路径）。
  - 外链：`https://...`。
- `alt`：默认文件名；NodePanel 可编辑。
- 本地读取：`GET /api/workspaces/:id/uploads/:name`；只服务 `.baton/uploads` 下、文件名与上传格式匹配的文件。
- 外链校验：`https:`、长度 ≤ 2048、无 `username/password`、无 `data:`/`file:`/`javascript:`；不校验域名可达性（daemon 不抓取）。
- `src` 落库校验：本地只允许 `.baton/uploads/<safe-name>`；外链只允许 https；daemon 在 `node.create`/`node.update` 对 image 节点执行同一套校验，拒绝非法 `src`。
- 上下文装配：`<image src="..." alt="..."/>`；本地保留相对路径，外链保留 URL；不转 base64。
- 失败：前端占位 + 文件名；不阻塞画布、不重试风暴。

### 4.5 预验收结论（Preliminary）

```ts
export const PreliminaryVerdict = z.enum(['pass', 'fail', 'unknown'])
```

`review` 新增：

- `preliminaryVerdict: PreliminaryVerdict | null`（默认 null）
- `preliminaryReason: string | null`（默认 null，最多 2000 字符）
- `preliminaryAt: Timestamp | null`（默认 null）

写入时机：验收员任务结束、`parsePreliminaryVerdict` 得出结论后，且目标仍处于同一轮 `review`（`target.status === 'review'` 且 `review.id === origin.reviewOfReviewId`）。目标已离开 review 时不写。

### 4.6 注意力

- 复用 `packages/core/src/tasks/board.ts` 的 `needsPerson`：`attention !== 'none' || status === 'waiting_input' || status === 'review'`。
- 新增 `isStale(waitingSince, now, thresholdMs = 30 * 60 * 1000)`；`waitingSince` 为 null 时 false。
- 新增 `sortByWaiting(tasks)`：有 `waitingSince` 的按升序（等最久优先），无等待的排后面，保持稳定排序。
- 看板筛选“需要我”= `needsPerson`；搜索标题大小写不敏感；排序在筛选后执行。
- rail“需要我”计数 = 当前筛选后列表长度；总任务计数保持全量。

## 5. 协议与 API 变更

### 5.1 Protocol

- `NodeUpdateInput.patch` 增加 `groupId: Id.nullable().optional()`。
- 新增 `NodeMoveManyInput`：

```ts
export const NodeMoveManyInput = z.object({
  canvasId: Id,
  moves: z
    .array(z.object({ nodeId: Id, x: z.number(), y: z.number() }).strict())
    .min(1)
    .max(200),
})
```

- 新增 `GroupCreateInput`：

```ts
export const GroupCreateInput = z.object({
  canvasId: Id,
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  label: z.string().min(1).max(120),
  childIds: z.array(Id).min(1).max(50),
})
```

- `ClientMessage` 增加 `node.move_many`、`group.create`。
- `node.move_many` 的 `moves` 去重后 `nodeId` 必须唯一；`x/y` 必须是有限数字；daemon 在事务内再校验一次。
- `Review` 增加三个 preliminary 字段；`ReviewView` 自动继承。
- 新增 server event `review.preliminary`，payload：

```ts
{ taskId: Id, reviewId: Id, verdict: PreliminaryVerdict, at: Timestamp }
```

- 不新增 `NodeType`；不修改 `Node` 联合类型。

### 5.2 REST / WS

- `GET /api/workspaces/:id/uploads/:name`：受保护图片读取。
  - 只允许 `.baton/uploads` 下的文件；文件名只允许上传生成的安全字符集。
  - `realpath` 后仍在 `.baton/uploads`；拒绝软链。
  - 扩展名白名单：`.png/.jpg/.jpeg/.webp/.gif/.svg`；Content-Type 对应设置。
  - 响应头：`X-Content-Type-Options: nosniff`、`Cache-Control: private, max-age=300`、SVG 追加 `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`。
  - 404 不暴露文件是否存在之外的信息；401 走现有 `/api/*` auth preHandler。
- `node.move_many`：成功 ack 返回 `{ ok: true, moved: number }`；校验失败返回 `node_move_invalid`。
- `group.create`：成功 ack 返回 `{ ok: true, groupId, children: number }`。
- `node.update` 的 `groupId` 校验失败返回 `group_invalid`。
- `node.delete` 删除 group 时返回 `{ ok: true, ungrouped: number }`（可选；保持现有 ack 形状兼容）。
- 不新增任务列表 REST；review 卡全局用 `TaskSummary`，现场用 `TaskDetail`。

### 5.3 总管工具

- `SUPERVISOR_POLICY.allowedTools` 15 → 16：新增 `update_node`。
- `update_node` 输入：

```ts
{
  nodeId: Id
  x?: number
  y?: number
  title?: string
}
```

- 校验：节点属于当前 workspace canvas；`title` 只允许 `agent`；`x/y` 有限数字；至少一个字段；不删除、不改文本、不改 groupId。
- 审计：`supervisor.node.update`，记录 nodeId、字段名、前后值摘要（不记录文本内容）。
- `list_canvas` 的 `nodeSummary` 增加 `x/y/w/h/groupId`；仍不读文件内容。
- Prompt 增加：只有用户明确要求“挪一下/整理/放到旁边/改个名字”才调用；不自动重排、不抢视口；不删除节点。

## 6. Core 纯函数

新增/调整：

- `packages/core/src/canvas/scene.ts`
  - `buildTaskScene`
  - `relatedNodeIdSet`
  - `reviewCardPosition`
- `packages/core/src/canvas/grouping.ts`
  - `groupBounds`
  - `findContainingGroup(nodeRect, groups)`：中心点判定；重叠取面积最小。
- `packages/core/src/tasks/board.ts`
  - `isStale`
  - `sortByWaiting`
  - 保留 `needsPerson`
- `packages/core/src/review/preliminary.ts`
  - `PreliminaryVerdict`
  - `parsePreliminaryVerdict(text, outcomeReason?)`
  - 从 `apps/daemon/src/supervisor/observe.ts` 下沉纯解析逻辑；daemon 保持 re-export，行为不变。
- 所有纯函数先写失败测试，再实现；覆盖率不低于 core 现有基线。

## 7. daemon 实现

### 7.1 数据库

- migration 0010：
  - `ALTER TABLE review ADD COLUMN preliminary_verdict text;`
  - `ALTER TABLE review ADD COLUMN preliminary_reason text;`
  - `ALTER TABLE review ADD COLUMN preliminary_at integer;`
- 旧数据三列为 null；`Review.parse` 用 null 默认值兼容。
- 在 fixture DB 上验证升级；不做 destructive migration。

### 7.2 Repository

- `moveNodes(tx, canvasId, moves)`：一次性校验全部 node 属于 canvas、`nodeId` 不重复、坐标有限；更新 x/y；返回数量。
- `createGroup(tx, canvasId, group, childIds)`：校验子节点属于 canvas、不是 group、没有 groupId；插入 group；批量设置子节点 groupId。
- `deleteNode`：若节点是 group，先 `update node set group_id = null where group_id = ?`，再删；同事务。
- `setReviewPreliminary(tx, reviewId, verdict, reason, at)`：只在 review 存在时更新。
- `listNodes` 已返回坐标；总管 `nodeSummary` 增加坐标/尺寸/groupId。

### 7.3 WS / runtime

- `node.move_many`：调用 repository；失败回滚；ack。
- `group.create`：调用 repository；ack。
- `node.update`：`groupId` 变更时校验目标 group 同 canvas、不是自身、不是嵌套 group；非法返回 `group_invalid`。
- `node.create`/`node.update`：对 `image` 节点校验 `src`（本地 `.baton/uploads/<safe-name>` 或 https 外链）；非法返回 `image_src_invalid`。
- `node.delete`：group 删除解绑子节点；非 group 行为不变。
- `review.preliminary`：写库成功后 emit 事件；web 失效任务详情与任务列表。

### 7.4 图片路由

新增 `apps/daemon/src/http/uploads.ts` 的只读路由（可与现有上传注册在同一文件）：

- `GET /api/workspaces/:id/uploads/:name`。
- workspace 不存在 → 404 `workspace_not_found`。
- 文件名非法/不存在/软链/越界 → 404 `image_not_found`。
- 扩展名不在白名单 → 415 `image_type_unsupported`。
- 文件超过 10MB → 413 `image_too_large`（理论上上传已限制）。
- 设置 Content-Type、Content-Length、缓存、nosniff、SVG CSP。
- 不做目录列表、不做任意路径读取、不代理外链。

### 7.5 总管

- `tools.ts` 新增 `update_node`；`service.ts` 接线；`prompt.ts` 工具清单与规则更新；`SUPERVISOR_POLICY.allowedTools` 16。
- 工具接线测试断言真实引擎请求体包含 16 个工具。
- `list_canvas` 返回坐标/尺寸/groupId；文本仍只给预览。
- 审计：`supervisor.node.update`；失败不写成功审计。

### 7.6 验收员

- `supervisor/service.ts` 在验收员结论确定后：
  - 校验目标是同一轮 review；
  - `setReviewPreliminary`；
  - emit `review.preliminary`；
  - 原有通知/建议逻辑不变。
- 目标离开 review 时，沿用现有取消验收员逻辑；不写 preliminary。
- `parsePreliminaryVerdict` 从 core 引用；daemon `observe.ts` 保持导出兼容。

## 8. web 实现

### 8.1 画布节点

- `ImageNode`：
  - 本地 `src` → `/api/workspaces/:id/uploads/:name`；外链直接使用。
  - `<img>` + `referrerPolicy="no-referrer"` + `loading="lazy"` + `decoding="async"`。
  - 失败占位：图标 + 文件名 + “图片无法加载”。
  - 创建前检查 MIME/扩展名；不在 png/jpeg/webp/gif/svg 白名单时提示并拒绝创建 image 节点。
  - NodePanel：显示来源、alt 编辑、文件名；不打开外链新窗口。
- `GroupNode`：
  - 组框、标题、子节点数、折叠按钮。
  - 折叠时隐藏子节点和相关边；group 自身仍可见。
  - 选中组时可拖动；拖动结束触发 `node.move_many`。
- `ReviewCardNode`：
  - 派生节点，`id = review:${taskId}`，不可拖动/删除。
  - 不属于 `relatedNodeIds`/`relatedEdgeIds`；由 CanvasPanel 单独渲染，不参与边的收敛。
  - 数据：TaskSummary + 可选 detail.review。
  - 显示：任务标题、status、等待时长、verify 退出码、diff stat、初步结论（PASS/FAIL/未完成）。
  - 点击打开任务详情；无通过/打回。
  - 任务离开 review 即从视图消失。

### 8.2 CanvasPanel

- 新增 `sceneTaskId`（Zustand）；进入/退出现场。
- `scene` 由 `buildTaskScene` 计算；现场模式：
  - 无关节点 `opacity: 0.25`、`pointer-events: none`；
  - 相关 group 临时展开；
  - 只显示相关边；
  - `fitView` 到相关节点与 review 卡（如果显示）；
  - 顶部 `TaskSceneBar`：任务标题、状态、等待、上下文数量、缺失节点数、review 摘要、「回到全局」。
- 退出：清除 `sceneTaskId`，恢复折叠/视口；不写库。
- 节点拖动：
  - React Flow 可用 `parentId` 做视觉父子；所有持久化坐标统一转回绝对坐标，协议不存相对坐标。
  - 普通节点拖动结束：若 groupId 变化，`node.update { groupId }`。
  - group 拖动结束：计算 group + 子节点绝对坐标，`node.move_many`；失败 refetch + toast。
- 工具栏：
  - 「图片」打开 `CreateImageNodeDialog`（本地上传 / https 外链）。
  - 「分组」从当前选中的非 group 且 `groupId === null` 的节点建组；没有选中或任一节点已在分组中时禁用/拒绝。
  - review 卡不手工创建。
- NodePanel：
  - image：alt/来源；
  - group：label/折叠/子节点数/删除（解绑）；
  - review：打开任务；派生节点不显示 NodePanel。
- NodePicker / 节点选择：image/group/review 的标题与图标补齐；review 卡不作为上下文选择项。

### 8.3 任务看板

- `TaskBoardFilters`：全部 / 需要我 / 待验收 / 待处理；标题搜索；等待排序。
- `TaskCard`：stale 标记（等待 > 30 分钟）；「看现场」动作；点击卡片仍打开详情。
- `BoardRail`：新增「需要我」计数；展开时显示；计数与筛选后列表一致。
- `MobileBoardList`：复用 `needsPerson` 过滤、等待排序、stale 标记；不加入现场入口。
- 状态表达不能只靠颜色：stale 用文字/图标 + 颜色；review 卡显示文本状态。

### 8.4 任务详情

- `TaskDetailPanel` 头部增加「看现场」。
- `ReviewCard` 增加初步结论区块：
  - `preliminaryVerdict` 为 null：显示“初步验收进行中/未完成”；
  - pass/fail：显示结论与理由；
  - 明确“最终通过/打回由你决定”。
- 新增 `review.preliminary` 事件处理：失效 task detail 与 tasks 查询。

### 8.5 设计系统

- 全部使用 `DESIGN.md` token：`bg-surface`、`border-separator`、`text-muted`、`bg-accent`、`bg-warning`、`bg-danger`、`bg-success`；禁止硬编码 hex。
- 新状态（stale、初步结论）必须有文字/图标；对比度 WCAG AA；焦点可见；键盘可达。
- 现场降暗不是唯一状态表达；现场条用文字说明当前任务和上下文数量。

## 9. 安全与隐私

- 图片读取只开放 `.baton/uploads`；realpath jail；拒绝软链；不做目录列表；不做任意路径读取。
- 外链只允许 `https://`，长度 ≤ 2048，拒绝用户名/密码、`data:`、`file:`、`javascript:`；daemon 不抓取、不代理。
- SVG 只在 `<img>` 中渲染，不内联到 DOM、不作为 `iframe/object`；服务端加 CSP sandbox 与 nosniff。
- 图片 URL 会进入上下文；UI 提示“不要在 URL 里放凭据”。
- 总管 `update_node` 只能移动/重命名 Agent；不能删除、不能改文本；审计不记录文本内容。
- 不读取图片内容、不做 OCR、不做图片向量化；不把 base64 写入 prompt/事件/日志。
- 路径、URL、错误信息不包含本机绝对路径；截图验收时按仓库脱敏规则处理。
- 新事件只含 taskId/reviewId/verdict/at，不含 transcript、diff 正文或图片内容。

## 10. 测试与验收

### 10.1 单元

- protocol：`node.move_many`、`group.create`、`groupId` patch、review 新字段的解析/拒绝。
- core：`buildTaskScene`（快照/origin/缺失/group 展开/边收敛/Agent 缺失）、`findContainingGroup`、`isStale`、`sortByWaiting`、`parsePreliminaryVerdict`。
- daemon：migration 0010、moveNodes 事务回滚、createGroup、删组解绑、setReviewPreliminary 条件、图片路由 jail/MIME/软链、supervisor update_node 审计。
- web：三种节点渲染、分组拖动/成员/折叠、现场降暗/展开/恢复、看板过滤/排序/stale、review 卡。

### 10.2 集成 / e2e

- Playwright：
  - 上传图片 → image 节点 → 看现场；
  - 建组 → 拖动整组 → 刷新后位置保持；
  - 任务到 review → 现场 review 卡 → 人工通过 → 卡片消失；
  - 看板「需要我」过滤/排序/stale。
- ego-lite + 真实 Claude：
  - 一个任务完成到 review，现场显示 verify/diff/初步结论；
  - 人工通过/打回后 review 卡消失；
  - 截图证据落 `docs/evidence/<date>-m6-task-scene/`，按仓库脱敏规则处理。

### 10.3 命令

`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；新增源码无未完成项。

### 10.4 DoD

1. 图片节点支持 png/jpeg/webp/gif/svg + https 外链；本地读取走受保护路由；10MB 上限；失败占位；daemon 不抓外链。
2. 分组支持选中建组、拖入/拖出、整组拖动、折叠；整组拖动一次事务落库；删组只解绑不删子节点；折叠不影响上下文。
3. Review 卡在 `review` 时出现、离开后消失；显示状态/verify/diff/等待/初步结论；只读；点击打开任务。
4. 现场从详情和看板都能进；相关节点/边收敛正确；相关组临时展开；缺失节点有提示；退出恢复；不自动抢视口。
5. 总管 `update_node` 只能移动 + 重命名 Agent；有审计；`list_canvas` 返回坐标/groupId；不能删节点/建组/建图片。
6. 看板「需要我」过滤、搜索、等待排序、30 分钟 stale 标记可用；rail 计数与列表长度一致；手机保留这些能力。
7. migration 0010 可升级旧库；旧任务、旧快照不受影响。
8. `pnpm verify:full`、`pnpm pack:check`、`check:boundaries`、`check:protocol`、`format:check` 全绿；Playwright + ego-lite 证据落库。
9. 不新增 `NodeType`、不建任务级画布表、不产生第二真相源。

## 11. 风险与缓解

| 风险                     | 影响                         | 缓解                                                                 |
| ------------------------ | ---------------------------- | -------------------------------------------------------------------- |
| 分组拖动坐标错位         | 刷新后位置漂移               | 绝对坐标 + `node.move_many` 单事务；前端失败 refetch；Playwright 覆盖 |
| 图片安全面               | XSS/SSRF/凭据泄漏            | 只开放 uploads；外链不代理；SVG CSP sandbox；URL 校验；测试覆盖      |
| 现场节点过多导致卡顿     | 画布交互变慢                 | 降暗用 CSS opacity；不重挂节点；必要时先测量再优化                   |
| 初步验收写入时序         | 旧结论误挂到新 review        | 写入前校验 target 仍在同一 review；目标离开即取消验收员              |
| 范围偏大                 | 一次改动跨 protocol/daemon/web | 5 个 plan 隔离；每片独立 `pnpm verify`；不把 M5-4 混进来             |
| 总管误移动节点           | 画布布局被打乱               | 只在用户明确要求时调用；审计；不删除；不自动重排                     |
| 现场变成第二详情页       | 信息过载                     | 现场只显示摘要；transcript/diff 正文留在详情                         |

## 12. 实施切片

1. **Plan 1 protocol + core + migration 0010**：命令/字段、scene/grouping/stale/preliminary 纯函数、迁移与单测。
2. **Plan 2 daemon**：repository 批移动/建组/解绑、图片路由、supervisor `update_node`/坐标、验收员写初步字段、集成测试。
3. **Plan 3 web canvas**：图片/分组/review 渲染与创建、分组拖动/成员/折叠、现场模式与现场条。
4. **Plan 4 web tasks/attention**：看板筛选/排序/stale/rail、review 卡联动、组件测试。
5. **Plan 5 验收与文档**：Playwright、ego-lite 真实 Claude、证据、docs 索引、contract 收口。

依赖：Plan 2 依赖 Plan 1；Plan 3 依赖 Plan 1+2；Plan 4 依赖 Plan 2+3；Plan 5 依赖全部。

## 13. 后续路线

- **M6-2 验收证据**：AC 清单、cost/turn、更多验收证据上画布；与 M5-4 合并考虑。
- **M5-2 外部 Source**：GitHub issue 入口、完成回写；在注意力回收稳定后再接。
- **M6-3 任务画布**：如果现场视图证明价值，再评估是否引入任务级画布；届时另立 spec/ADR。

## 14. 评审记录

- 2026-11-21：四轮 frontier 逐项确认现场形态、入口、节点范围、图片存储/安全、分组拖动/成员、review 卡、初步结论、注意力、移动端与验收方式；设计通过。
- 2026-11-21：用户确认 Section 1 架构与数据模型、Section 2/3 组件/数据流/测试切片；进入 spec 落库。
