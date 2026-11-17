---
spec_topic: m1-web-console
decision_summary: "M1-6a：HeroUI v3 + Tailwind 4 的任务控制台——可展开 7 列看板、任务详情/回复/审批/验收、可编辑 text/file/agent 画布、node CRUD 与 transcript 历史；6b 再做连线/上下文/group/image/review/canvas.patch"
design_approved: true
user_approved_at: 2026-11-17T12:44:56+08:00
gates: [user-review-passed]
spec_ref: 2026-11-16-baton-architecture-design.md
---

# M1-6a 任务控制台设计

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：`docs/specs/2026-11-17-m1-daemon-runtime-design.md`（已合并）、`docs/specs/2026-11-17-m1-attention-semantics-design.md`（已合并）、`docs/adr/0002-heroui-component-library.md`。
> 本文只锁定 M1-6a：把 M1-5/M1-5a 的 daemon 闭环变成可操作的 web 任务控制台。真实 Claude、总管、连线/上下文、通知、移动端不在范围。

## 0. 文档信息

- **状态**：设计已获用户逐节确认，待落 spec 评审与实施。
- **范围**：`packages/protocol`、`apps/daemon/**`、`apps/web/**`、`DESIGN.md` 的落地、Playwright e2e、`docs/**`。
- **不在范围**：`packages/core` 的状态机语义、`agent-claude`/`agent-pty`、总管与 `supervisor.send`、连线/上下文多选、group/image/review 节点、`canvas.patch` 多端同步、通知、移动端、worktree、`task.retry/reopen`、完整事件溯源。
- **文档位置**：spec 落 `docs/specs/`，contract 落 `docs/contracts/`，plan 落 `docs/plans/`。

## 1. 背景

M1-5 已合并：daemon 可以用 `agent-fake` 通过 WS 跑通
`task.create → enqueue → running → approval → verify → review → done`。
M1-5a 已合并：会话可以报告 `ready / blocked / dropped / unreported`，任务会进入
`waiting_input`，并带 `waitingReason`、`attention` 与 `waitingSince`；用户可以用
`session.reply` 直接回复活跃 run。

当前 web 仍是 M0 骨架：

- `apps/web/src/App.tsx` 只有空 ReactFlow、静态 4 列和禁用 textarea。
- `apps/web/package.json` 只有 React 与 `@xyflow/react`；没有 Tailwind、HeroUI、TanStack Query。
- 浏览器无法创建 workspace、agent 节点或任务；`task.create` 要求已存在的 agent 节点，但没有 `node.create`。
- `GET /api/tasks` 返回裸 `Task[]`，没有 `attention/waitingSince`；`GET /api/tasks/:id` 没有 transcript 历史。
- 刷新页面后，`session.event` 只能靠全局 `resume` 重放，无法按 session 分页加载。

`baton.ai` 的核心心智是「任务 > session」「谁最需要我，谁说了算」。M1-5a 把语义做进了状态机，M1-6a 要把它变成屏幕上的一列、一句话和一个人闸门。

## 2. 目标与非目标

### 2.1 目标

1. **三栏壳**：左看板 rail、中画布、右任务详情；顶栏含 workspace、连接状态、新建工作区/Agent 节点。
2. **可展开 7 列看板**：默认 64px rail + attention 计数；点击展开为覆盖式看板，7 列横向滚动；可固定为并排。
3. **任务详情与人闸门**：展示任务元信息、transcript、审批卡、验收卡、回复框；支持 `session.reply`、`approval.decide`、`review.decide`、`task.cancel`、`task.enqueue`。
4. **可编辑画布（6a 范围）**：text/file/agent 节点 CRUD、拖动/缩放、位置保存、从 agent 节点创建任务；已有边只读渲染。
5. **工作区**：选择与新建工作区；浏览器可以从零开始。
6. **实时**：WS 命令 + 事件 + `resume` 重连；任务状态、transcript、审批/验收结果实时更新。
7. **API 增量**：`TaskSummary`（attention/waitingSince）、session events 历史接口、`node.create/update/delete`。
8. **样式**：Tailwind `^4.3.5` + HeroUI `^3.2.7`；以根目录 `DESIGN.md` 的 HeroUI 默认主题 + baton addendum 为准。
9. **测试**：protocol/daemon/web 组件测试 + Playwright e2e；6a 不需要 LLM key。

### 2.2 非目标

- 不接真实 Claude、不接总管、不需要 `ANTHROPIC_API_KEY` 或 DeepSeek key。
- 不做连线/上下文多选、group/image/review 节点、`canvas.patch` 多端同步（M1-6b）。
- 不做通知、移动端、worktree、`task.retry/reopen`、完整事件溯源。
- 不改状态机语义、不改 `packages/core` 的转移表。
- 不做可交互终端；Agent 节点仍是只读日志/状态摘要。
- 不把 token/密钥写进 localStorage 或仓库。

## 3. 关键决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | M1-6 拆分与顺序 | 总范围 = 6a + 6b；顺序 `6a → M1-7 → 6b` | 6a 是真实 agent 的验收台；画布增强可后置 |
| D2 | 6a 布局 | 64px 看板 rail + 中画布 + 右详情；看板点击展开为覆盖层，可 pin 为并排 | 7 列 + 画布 + 详情无法同屏；默认保留画布空间 |
| D3 | 6a 画布范围 | text/file/agent 节点 CRUD、拖动/缩放、位置保存；边只读 | 先给「从画布建任务」一个可用载体；连线/上下文留 6b |
| D4 | 节点同步 | 6a 用 WS `node.*` 命令 + ack 后重拉 canvas；`canvas.patch` 留 6b | 本地单用户；避免在 6a 引入多端广播协议 |
| D5 | 任务创建 | 从 agent 节点创建；创建后 `todo`；人点「立即开工」才 `task.enqueue` | 对齐 baton.ai「外部输入只建待办，派活由人点开工」 |
| D6 | 看板数据 | `TaskListResponse` 改为 `TaskSummary[]`，带 `attention/waitingSince` | 规则只留 daemon/core 一份，前端不复制推导 |
| D7 | Transcript 历史 | 新增 `GET /api/sessions/:id/events?sinceSeq=&limit=` | 刷新后能按 session 分页加载；WS 只负责实时增量 |
| D8 | 工作区 | 选择 + 新建；沿用现有 REST | 浏览器可从零开始；不需要新协议 |
| D9 | 认证 | 沿用 `/auth?token=` → httpOnly cookie | 现有安全边界足够；6a 不改 |
| D10 | 样式 | Tailwind `^4.3.5` + HeroUI `^3.2.7`；HeroUI 默认暗色主题 | 最新稳定版满足 HeroUI v3 的 Tailwind ≥4 要求；不自定义品牌色 |
| D11 | LLM | 6a fake-only；M1-7 用本机 Claude Code 登录态；总管配置 `~/.baton/supervisor.json` 空模板 | 6a 不需要 key；总管留 M2 |
| D12 | 验收 | 浏览器完成 `workspace → agent 节点 → task → blocked → reply → verify → review → approve` | 以真实闭环为准，不以代码写完为准 |

## 4. 协议与 API 增量

### 4.1 `TaskSummary`

`packages/protocol/src/api.ts`：

```ts
export const TaskSummary = Task.extend({
  attention: Attention,
  waitingSince: Timestamp.nullable(),
})
export type TaskSummary = z.infer<typeof TaskSummary>

export const TaskListResponse = z.object({ tasks: z.array(TaskSummary) })
```

- `attention` 由 daemon 用 `@baton/core` 的 `attentionFor(task.status, task.waitingReason)` 计算。
- `waitingSince`：`status` 为 `waiting_input` 或 `review` 时取 `task.updatedAt`，否则 `null`。
- 旧客户端不存在；直接改形状，同步更新 daemon 测试。
- `GET /api/tasks` 查询参数不变：`workspaceId` + 可选 `status`。
- `TaskDetailResponse` 也增加 `attention`，与 list 同规则；`waitingSince` 不变。

### 4.2 Session events 历史

新增 REST：

```ts
export const SessionEventsQuery = z.object({
  sinceSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})

export const SessionEventsResponse = z.object({
  sessionId: Id,
  events: z.array(
    z.object({
      seq: z.number().int().nonnegative(),
      type: z.string().min(1),
      payload: z.unknown(),
      ts: Timestamp,
    }),
  ),
  nextSeq: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})
```

- 路由：`GET /api/sessions/:id/events?sinceSeq=0&limit=500`。
- 数据来自现有 `event` 表：`sessionId`、`seq`、`type`、`payloadJson`、`ts`。
- 按 `seq` 升序；`nextSeq` 为最后一条的 `seq`，没有数据时等于 `sinceSeq`。
- session 不存在返回 `session_not_found`；参数非法返回 `invalid_payload`。
- 这是只读历史；实时增量仍走 WS `session.event`。

### 4.3 节点命令

在 `ClientMessage` 增加三个命令：

```ts
export const NodeCreateInput = z.object({
  canvasId: Id,
  node: NodeCreateValue,
})

export const NodeUpdateInput = z.object({
  nodeId: Id,
  patch: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().positive().optional(),
      h: z.number().positive().optional(),
      data: z.unknown().optional(),
    })
    .strict(),
})

export const NodeDeleteInput = z.object({ nodeId: Id })
```

`NodeCreateValue` 在 protocol 层接受全部六种节点，以便 handler 能返回 `unsupported_node_type`；6a handler 只处理 text/file/agent。下面是 6a 允许的三种；image/review/group 复用实体 data shape，但 handler 会拒绝：

```ts
const NodeCreateBase = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive().default(320),
  h: z.number().positive().default(200),
  groupId: Id.nullable().default(null),
})

export const NodeCreateValue = z.discriminatedUnion('type', [
  NodeCreateBase.extend({ type: z.literal('text'), data: z.object({ content: z.string() }) }),
  NodeCreateBase.extend({
    type: z.literal('file'),
    data: z.object({
      path: z.string().min(1),
      name: z.string().min(1),
      mime: z.string().min(1).optional(),
    }),
  }),
  NodeCreateBase.extend({
    type: z.literal('agent'),
    data: z.object({
      title: z.string().min(1),
      engine: Engine,
      taskId: Id.nullable().default(null),
    }),
  }),
])
```

行为：

- `node.create`：校验 canvas 存在；写节点；返回 `ack.data = { nodeId }`。
- `node.update`：只允许改 `x/y/w/h/data`，不允许改 `type`；返回 `{ nodeId }`。`data` 按现有节点类型校验：text 只允许改 `content`，agent 只允许改 `title`，file 只允许改位置/尺寸；其他字段拒绝。
- `node.delete`：若存在任务的 `nodeId` 指向该节点，返回 `node_in_use`，不级联删除。
- 6a 对 `image/review/group` 返回 `unsupported_node_type`；6b 再扩展。
- 节点变更不广播 `canvas.patch`；客户端 ack 后重拉 `GET /api/canvas?workspaceId=...`。

### 4.4 错误码

新增：

- `session_not_found`
- `node_not_found`
- `node_in_use`
- `unsupported_node_type`

沿用：`invalid_payload`、`canvas_not_found`、`workspace_not_found`、`reply_not_allowed`、`session_not_active`。

## 5. Daemon 增量

### 5.1 Repository

- `listSessionEvents(db, sessionId, sinceSeq, limit)`：按 `seq` 升序，返回 `rows` 与 `hasMore`。
- `getNode(db, nodeId)`、`insertNode(tx, node)`、`updateNode(tx, nodeId, patch)`、`deleteNode(tx, nodeId)`。
- `countTasksByNode(db, nodeId)` 或 `getTaskByNode` 用于 `node_in_use` 守卫。
- 写操作走事务；节点插入/更新/删除与审计无关，不需要额外事件表。

### 5.2 REST

- `GET /api/tasks` 返回 `TaskListResponse`（`TaskSummary[]`）。
- `GET /api/sessions/:id/events` 按 §4.2 实现；session 不存在返回 404。
- 其余路由不变。

### 5.3 WS

- `handleCommand` 增加 `node.create`、`node.update`、`node.delete`。
- `node.delete` 守卫：任务引用 → `node_in_use`；节点不存在 → `node_not_found`。
- `task.create` 不变：仍要求目标节点是 agent；6a 的 `contextNodeIds` 由前端传 `[]`。
- `task.enqueue` 不变：由「立即开工」触发。
- `resume` 不变：客户端用 `lastSeq` 重放；`ack.data.hasMore` 为 true 时继续。

### 5.4 配置

- 不新增 daemon 运行时配置。
- 6a 实现第一步创建 `~/.baton/supervisor.json` 空模板（仓库外、权限 0600）：
  ```json
  { "baseUrl": "", "apiKey": "", "model": "" }
  ```
  6a 不读取该文件；它只是给 M2 总管预留。模板里不写任何真实 key。
- 6a 不要求 `ANTHROPIC_API_KEY`；`agent-fake` 不需要 key。

## 6. Web 架构

### 6.1 依赖

`apps/web/package.json` 增加：

```json
{
  "@heroui/react": "^3.2.7",
  "@heroui/styles": "^3.2.7",
  "@tanstack/react-query": "^5.107.1",
  "zustand": "^5.1.0",
  "tailwindcss": "^4.3.5",
  "@tailwindcss/vite": "^4.3.5",
  "lucide-react": "^1.73.0"
}
```

具体 minor 以 lockfile 为准；`lucide-react` 版本在安装时取最新稳定版。HeroUI v3 的 peer 依赖包含 React Aria 系列，由 pnpm 解析；CI 需验证没有 missing peer。新增依赖同步更新 `THIRD_PARTY_NOTICES.md`。

`apps/web/vite.config.ts` 注册 `tailwindcss()`；`apps/web/src/styles.css`：

```css
@import 'tailwindcss';
@import '@heroui/styles';
```

`index.html` / 根元素固定：

```html
<html class="dark" data-theme="dark">
  <body class="bg-background text-foreground">
```

### 6.2 状态分层

- **TanStack Query**：
  - `['workspaces']`
  - `['canvas', workspaceId]`
  - `['tasks', workspaceId]`
  - `['task', taskId]`
  - `['session-events', sessionId]`
- **Zustand**：
  - `activeWorkspaceId`
  - `activeTaskId`
  - `selectedNodeId`
  - `boardExpanded` / `boardPinned`
  - `wsStatus`
  - `lastSeq`
  - `replyDraft`
- **WS 客户端**：
  - 连接 `/ws`；`resume { sinceSeq }`；处理 `ack`/`error`/`task.status`/`session.event`/`approval.request`/`verify.result`。
  - 重连指数退避（1s → 2s → 5s，上限 5s）；重连后用 `lastSeq` 继续。
  - 命令 10s 无 ack 视为失败；状态转移不做乐观更新。
  - 事件按帧合并，避免每个 chunk 触发全量重渲染。

### 6.3 启动与数据流

1. `GET /api/workspaces`；若空，显示新建工作区表单。
2. 选 workspace（URL `?workspace=`）；并行 `GET /api/canvas`、`GET /api/tasks`。
3. 连 WS；`resume { sinceSeq: 0 }`；重放完成后 invalidate 相关 Query。
4. 选任务（URL `?task=`）；`GET /api/tasks/:id`；`GET /api/sessions/:id/events` 加载 transcript。
5. 命令：`session.reply` / `approval.decide` / `review.decide` / `task.cancel` / `task.enqueue` / `node.*` / `task.create`。
6. 事件：
   - `task.status` → invalidate `['tasks']` 与 `['task']`
   - `session.event` → 追加 `['session-events']`
   - `approval.request` / `verify.result` → invalidate `['task']`

### 6.4 错误与安全

- 401：显示未认证提示；引导重新打开 `/auth?token=...`；token 不写 localStorage。
- WS `error`：toast + 保留当前状态；命令失败显示具体 `code/message`。
- Transcript 只渲染纯文本 / mono 代码块；不使用 `dangerouslySetInnerHTML`。
- 审批命令只展示，不执行；不提供通用 shell。
- 连接状态在顶栏显示：在线 / 重连中 / 离线。

## 7. UI/UX

### 7.1 应用壳

- 顶栏：baton 字标、workspace 下拉、连接状态、「新建工作区」、「新建 Agent 节点」。
- 新建工作区：`name` + `relPath`；`relPath` 必须是 `BATON_WORKSPACES_ROOT` 下的子目录；`invalid_path` / `conflict` 直接显示在表单里。
- 三栏：左看板 rail（默认 64px）、中画布、右详情（360–440px）。
- 窄屏先保证 1280px 可用；移动端只读留 M2。

### 7.2 左栏：可展开 7 列看板

- **默认收起**：64px rail，竖排「看板」按钮 + 待审批/待回复/待验收计数 + 总任务数。
- **展开**：覆盖式看板，宽度 `min(960px, 72vw)`；7 列每列最小 160px，横向滚动。
- **pin**：可切换为并排，占 520–640px，画布自适应缩窄；默认不 pin。
- **交互**：点击 rail 或按 `B` 展开；`Esc` 收起；点击任务卡选中任务、看板收起、右详情打开。
- **列**：未规划、待办、进行中、待审核、待验收、已完成、已取消。
  - 未规划 = 没有 task 引用的 agent 节点。
  - 其余列来自 `TaskSummary[]`：待办 = `todo+queued`；进行中 = `running+verifying`；待审核 = `waiting_input`；待验收 = `review`；已完成 = `done`；已取消 = `cancelled+failed`。
- **任务卡**：标题两行截断、状态 Chip、attention 徽标、engine chip、等待时长。
  - `needs_approval` / `needs_reply` 用 warning + 图标 + 文案；`needs_review` 用 accent。
  - 等待时长用 `waitingSince`，每 30 秒刷新；> 1 小时显示「已等 1 小时 12 分」。
  - Tab/Enter 可达。

### 7.3 中栏：可编辑画布

- React Flow + 自定义节点；6a 支持 `text` / `file` / `agent`。
- 工具栏：添加文本/文件/Agent 节点、fit view、缩放；Agent 节点默认放在视口中心。
- 节点：
  - text：标题 + 内容摘要；
  - file：文件名 + 路径；
  - agent：标题 + engine + 任务状态 Chip（有 task 时）。
- 拖动/缩放：本地即时更新，松手发 `node.update`；失败回滚。
- 选中 Agent 节点：右侧显示「创建任务」表单；已有 task 时显示任务详情。
- 删除：右键/Delete 确认；被任务引用返回 `node_in_use`，提示先处理任务。
- 6a 不创建连线；已有边只读渲染。

### 7.4 右栏：任务详情

- 顶部：标题、状态 Chip、attention、engine、retryCount、waitingSince；「总管」tab 显示 M2 未开放。
- 按状态切换：
  - `waiting_input(approval)`：审批卡（风险、命令/参数、允许/拒绝）。
  - `waiting_input(question/stalled/dropped)`：回复框 + 发送。
  - `review`：验收卡（退出码、diffStat、输出尾部；通过/打回，打回必填反馈）。
  - `todo`：「立即开工」；`running/queued`：取消；终态只读。
- Transcript：
  - 默认最新 session；多 session 提供下拉切换。
  - 角色标签（你 / Agent / 工具 / 系统）+ 内容；工具输出/命令/diff 用 mono 块。
  - 实时追加；用户上滚时暂停自动滚动，显示「跳到最新」；长日志虚拟滚动。
- 创建任务表单：标题、prompt、verifyCommand（可选）；engine 固定 fake；workspaceMode 固定 main；提交后进「待办」，不自动开工。

### 7.5 组件拆分

`AppShell`、`TopBar`、`WorkspaceSwitcher`、`ConnectionStatus`、`BoardRail`、`TaskBoard`、`BoardColumn`、`TaskCard`、`AttentionBadge`、`WaitingTime`、`CanvasPanel`、`CanvasToolbar`、`TextNode`/`FileNode`/`AgentNode`、`TaskDetailPanel`、`TaskHeader`、`Transcript`、`ApprovalCard`、`ReviewCard`、`ReplyComposer`、`TaskActions`、`CreateTaskForm`、`CreateWorkspaceDialog`、`EmptyState`、`ErrorState`。

HeroUI：`Button`、`Card`、`Chip`、`Input`、`TextArea`、`Select`、`Modal`、`Tabs`、`Toast`、`Skeleton`、`Spinner`、`Tooltip`、`Popover`、`Dropdown`；图标统一 `lucide-react`。

### 7.6 可访问性

- 所有交互可键盘完成；看板 rail/卡片可 Tab 聚焦，Enter 打开。
- 焦点可见（HeroUI 默认焦点环）；状态不能只靠颜色。
- 触控目标桌面 ≥32px；移动端 M2 再补 44px。
- Transcript 滚动容器可聚焦，带 `aria-label`。

## 8. 测试与验收

### 8.1 Protocol

- `TaskSummary` / `TaskListResponse` round-trip；`attention` 四值、`waitingSince` null/非 null。
- `SessionEventsQuery/Response` round-trip；`limit` 边界。
- `node.create/update/delete` round-trip；非法节点类型被拒绝。
- `ClientMessage` 新命令的判别联合。

### 8.2 Daemon

- `listSessionEvents` 分页、`sinceSeq`、`hasMore`。
- `GET /api/tasks` 返回 attention/waitingSince；`waiting_input/review` 的 `waitingSince` 正确。
- `GET /api/sessions/:id/events` 200/404/400。
- `node.create/update/delete`；`node_in_use` 守卫；`unsupported_node_type`。
- `task.create` 从 agent 节点创建；`task.enqueue`；`session.reply`；`approval.decide`；`review.decide`。
- `resume` 重放旧事件；旧 `task.status` 仍可解析。

### 8.3 Web 组件

- 7 列分组与「未规划」来源。
- attention badge 文案/图标；等待时长格式化。
- 回复框在 `approval` 下隐藏、在 `question/stalled/dropped` 下显示。
- 验收打回必须填反馈。
- 看板 rail 展开/收起/pin；`Esc` 收起。

### 8.4 Playwright E2E

1. 启动 daemon（临时 DB/workspace），浏览器打开带 token 的地址。
2. 新建 workspace。
3. 画布添加 Agent 节点。
4. 从节点创建任务 → 「待办」。
5. 点「立即开工」→ fake `blocked` → 「待审核」。
6. 回复 → `verifying` → `review` → 通过 → `done`。
7. 刷新页面，transcript 与状态仍在。
8. 拖动节点后刷新，位置保留。
9. 删除被任务引用的节点，提示 `node_in_use`。

使用系统 Chrome（`channel: 'chrome'`），不下载 Playwright Chromium。

### 8.5 全量验收

- `pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`check:boundaries`、`check:protocol`、`format:check` 全绿。
- UI 改动附截图；关键流程附 Playwright 证据。
- 6a 不需要任何 LLM key；`~/.baton/supervisor.json` 只建空模板，代码不读取。

## 9. 实施切片

1. **Foundation**：Tailwind/HeroUI 接入、依赖、`DESIGN.md` 落地、三栏壳、workspace 选择/新建、WS/TanStack Query 基础。
2. **Board**：`TaskSummary`、rail + 7 列看板、attention/等待时长、任务卡选择。
3. **Detail**：session events API、任务详情、transcript、回复/审批/验收、取消/开工。
4. **Canvas**：node CRUD 命令、text/file/agent 节点、拖动/缩放/位置保存、从 agent 节点创建任务。
5. **E2E & 收尾**：Playwright、截图、文档、全量命令。

每个切片结束跑 `pnpm verify`；跨层改动先改 protocol，再改 daemon，再改 web。

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 6a 范围偏大 | 延期 | 按 5 个切片推进；连线/上下文/group/image/review/canvas.patch 全部留 6b |
| Tailwind 4.3.5 + HeroUI v3 首次接入 | 样式不生效 | 先做 Button/Input 冒烟页；确认导入顺序与暗色 class |
| React Flow 自定义节点性能 | 拖拽掉帧 | 节点内只放轻量摘要；日志/transcript 虚拟滚动 |
| Transcript 量大 | 页面卡顿 | 历史 500 条分页；WS 事件按帧合并；按 `sessionId+seq` 去重 |
| WS 重连重复/丢事件 | 状态不一致 | `lastSeq` + `resume`；`hasMore` 继续；E2E 覆盖刷新/重连 |
| 节点删除引用完整性 | 任务悬空 | `node_in_use` 守卫，不级联删除 |
| `TaskListResponse` 形状变更 | 现有测试失败 | 当前只有 web 消费；同步更新 protocol/daemon 测试 |
| 时间估算 | 1.5–2 周 | 超期时优先保看板/详情/回复/验收；画布可降级为仅 Agent 节点 |

## 11. 后续映射

| 后续任务 | 本 slice 留给它的东西 |
|---|---|
| M1-6b | 边/上下文多选、group/image/review 节点、`canvas.patch`、性能与移动端 |
| M1-7 | 6a 的看板/详情/回复/验收作为真实 Claude 的验收台；本机 Claude Code 登录态 |
| M2 总管 | `~/.baton/supervisor.json` 空模板；`supervisor.send` 与工具白名单另写 spec |
| M2 通知 | `waitingSince` / attention 作为 30 分钟升级输入 |
| M3 | worktree、diff 视图、slim 镜像、DSH 插件壳 |

## 12. 自审记录

- **占位符扫描**：无 `TBD`/`TODO`；所有新增字段、命令、错误码都有消费者或测试。
- **内部一致性**：7 列映射与 `DESIGN.md` 一致；attention 映射与 core 一致；`TaskSummary` 只在 list 使用；detail 用 `Task` + `attention` + `waitingSince`。
- **范围检查**：只做 6a；6b/M1-7/M2 的内容明确排除。
- **歧义检查**：看板默认 rail、可展开可 pin；任务创建后不自动开工；节点删除不级联；transcript 最新 session + 下拉切换。
- **安全**：不把 token/密钥写 localStorage/仓库；transcript 不用 `dangerouslySetInnerHTML`；审批命令只展示不执行；`~/.baton/supervisor.json` 在仓库外。

## 13. 变更记录

- 2026-11-17：实现阶段补充 `NodeUpdateInput.patch.strict()`、`NodeCreateValue` 在 protocol 层接受全部六种节点（handler 拒绝 image/review/group）、`TaskDetailResponse.attention`、`node.delete` 的 edge 引用守卫。原因：对齐 contract DoD 11 与 Plan 1 实现；整体设计已在 2026-11-17 用户评审中确认。
