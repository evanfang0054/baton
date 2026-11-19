---
spec_topic: m2-2b-mobile-console
decision_summary: "M2-2b 移动端响应式控制台：<768px 不挂画布，完整非画布控制面；768–1023px 压缩桌面；≥1024px 桌面不变；ADR 0007 反转移动端只读"
design_approved: true
user_approved_at: "2026-11-19T11:16:22+08:00"
gates: [design-approved, user-review-passed]
spec_ref: 2026-11-16-baton-architecture-design.md
domain_terms: [mobile console, compact desktop, control surface, attention-first, node picker, responsive branch]
---

# M2-2b 移动端响应式控制台设计

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 反转：架构 §1.3 与决策 #16 的“移动端只读”由 `docs/adr/0007-mobile-control-console.md` 取代。
> 前置：M2-2a 无人值守与汇报（已合并，`main` `922a339`）。
> 背景材料：`baton.ai` 两份讨论稿（不进仓库）；只作为产品方向参考，不作为实现依据。

## 0. 文档信息

- **状态**：设计已获用户逐项确认；spec 已获用户审阅通过。
- **范围**：`apps/web/**`、`DESIGN.md`、`docs/**`、CI 的 `check:secrets`。
- **不在范围**：`packages/protocol/**`、`apps/daemon/**`、SQLite schema、migration、依赖运行时升级。
- **文档位置**：spec 落 `docs/specs/`，contract 落 `docs/contracts/`，plan 落 `docs/plans/`；不使用 `docs/agent-harness/`。
- **命名**：本迭代不再叫“移动端只读”，统一叫“移动端响应式控制台”。

## 1. 背景

M1 已把单任务闭环跑通：画布上下文 → 建任务 → 真实 Claude 执行 → 审批/提问 → verify → 人工验收。M2-1 把总管 Router v0 做实；M2-2a 把自动批准、自动重试、kill switch、digest 和看板批量开工做实。

架构 §7 的 M2 验收标准是：

> 无人值守连续跑 3 个任务并产出汇报；手机上能通过/打回。

前半句已由 M2-2a 交付；后半句仍未完成。原方案（架构 §1.3 / 决策 #16）把移动端限定为“只读看板 + 验收”，理由是触控画布成本高。实际使用中，只读会把手机变成通知窗口：审批、回复、开工、建任务仍然要把人拉回桌面，“离开电脑也能推进任务”的注意力回路没有闭合。

当前 web 是桌面三栏 + React Flow 画布，代码里没有任何响应式工具类或 `useMediaQuery`。移动端不是加几行 CSS 就能完成，需要一套明确的响应式分支。

本迭代选择：**移动端响应式控制台**。手机拥有除画布外的完整控制面；画布、拖拽、连线、节点删除仍只在桌面/平板完成。该反转由 ADR 0007 记录。

## 2. 目标与非目标

**目标**

1. `<768px` 进入移动控制台：看板、任务详情、审批/回复/验收、开工/取消/批量开工、建任务、总管、设置、信任/创建工作区、kill switch、digest 全部可用。
2. `768–1023px` 进入压缩桌面：保留画布；看板默认收起；右栏改覆盖层。
3. `≥1024px` 桌面布局与行为保持不变。
4. 手机端不挂载 `CanvasPanel`；画布数据仍可读取，用于节点选择器。
5. 建任务支持表单与总管两种入口，共享节点选择器；任务表单可新建 Agent。
6. 节点表单支持创建/编辑 text、创建 file、创建/编辑 Agent（通过移动端节点列表进入）；已有 file 只读；不删除节点、不建连线。
7. 认证、WS 重连、命令 ack、错误提示复用现有实现；不新增协议。
8. Playwright 覆盖手机/平板/桌面三档；ego-lite H5 视窗 + 真实 Claude 完成一次移动端闭环。
9. `check:secrets` 用 gitleaks 做全历史基线与 PR diff，进入 CI。

**非目标**

- 画布渲染、拖拽/缩放、连线、节点删除（移动端）。
- image/group/review 节点的创建或编辑。
- Web Push、外部通知渠道、PWA、离线队列。
- 只读 token scope、多用户、远程协作、手机端登出端点。
- 协议、daemon、DB、migration 变更。
- 桌面视觉重做；只做响应式分支。
- diff 视图、cost/turn、M1-7b、外部 Source。

## 3. 关键决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 断点 | `<768` 移动；`768–1023` 压缩桌面；`≥1024` 桌面不变 | 手机与平板行为差异大；平板保留画布，手机不挂画布 |
| D2 | 实现方式 | 现有组件内做响应式分支，复杂分支抽同目录小组件 | 用户明确选择“响应式改造现有三栏”，不引入独立壳/路由 |
| D3 | 画布 | `<768` 不挂载 `CanvasPanel`；`≥768` 保留 | 手机触控画布成本高；平板仍可用画布 |
| D4 | 动作面 | 手机拥有除画布外的完整控制面 | 只读不能闭合离开电脑的回路；用户明确选择完整控制面 |
| D5 | 节点表单 | 创建/编辑 text、创建 file、创建/编辑 Agent；file 只读 | 手机可自举任务；不重建画布编辑器 |
| D6 | 节点删除/连线 | 不在手机端提供 | 无画布难以确认影响；删除与关系编辑留在桌面 |
| D7 | 建任务 | 表单 + 总管，共享节点选择器 | 两种入口对应桌面已有能力；共享选择器避免重复 |
| D8 | 认证 | `/auth?token=` HttpOnly cookie；同一 token | 不新增服务端安全面；单用户本地 v1 |
| D9 | 通知 | 站内未读 + digest；不做真推送 | 先闭环；Web Push 需要 HTTPS/SW/VAPID，单独迭代 |
| D10 | 看板 | 移动端“需要我处理”优先 + 状态分组 | 小屏不适合 7 列横滑；符合“只显示需要人的事” |
| D11 | 桌面 | `≥1024` 行为与视觉不变 | 降低回归风险；响应式只增加分支 |
| D12 | 服务端 | 不改 protocol/daemon/DB | 现有 REST/WS 已覆盖全部动作；`node.create` 已支持 text/file/agent |
| D13 | 密钥扫描 | gitleaks 全历史基线 + PR diff，折进 Plan 1 | 公开仓库；历史泄漏删除文件不等于失效 |
| D14 | 记录 | 新 ADR 0007 + 本 spec 回链 | 反转已锁定决策必须留痕 |
| D15 | 验收 | Playwright 多视口 + ego-lite H5 + 一次真实 Claude | CI 可重复 + 真实浏览器/真实引擎证据 |

## 4. 词汇与不变量

| 词汇 | 定义 |
|---|---|
| mobile console | `<768px` 的移动控制台，不挂载画布 |
| compact desktop | `768–1023px` 的压缩桌面，保留画布，看板默认收起 |
| control surface | 人可直接操作的动作集合；本迭代指除画布外的全部桌面动作 |
| attention-first | 看板先展示审批/回复/验收，再展示进行中/待办/已完成 |
| node picker | 从现有节点列表中多选上下文或目标 Agent 的共享组件 |
| responsive branch | 同一组件内按 viewport 切换布局，不新增独立路由 |

**九条不变量**

1. 只有一个 `App`、一个 `RealtimeProvider`、一套 Query/Zustand/WS；不新增移动路由。
2. `<768px` 不挂载 `CanvasPanel`；画布数据可请求，但不得初始化 React Flow。
3. `≥1024px` 的桌面行为、布局与快捷键保持不变。
4. 不改 `packages/protocol`、`apps/daemon`、SQLite schema；所有写操作走现有命令。
5. 手机端不删除节点、不创建边；text/file/agent 之外不新增节点类型。
6. 建任务必须有 Agent 目标；手机可在任务表单内先创建 Agent。
7. 手机与桌面共用同一 token；不新增只读 scope；截图/日志不得包含 token。
8. 上下文选择只选节点；连线依赖仍由 core 自动包含，任务详情展示实际快照。
9. 状态投影不变：看板、任务详情、通知仍来自同一事实源。

## 5. 响应式架构

### 5.1 `useViewport`

新增 `apps/web/src/lib/use-viewport.ts`：

- `mobile`：`window.matchMedia('(max-width: 767px)')`
- `compact`：`(min-width: 768px) and (max-width: 1023px)`
- `desktop`：`(min-width: 1024px)`
- 用 `useSyncExternalStore` 订阅 `matchMedia` 的 `change`；服务端/测试环境无 `matchMedia` 时回退 `desktop`。
- 只用于**条件挂载**（`CanvasPanel`）和需要 JS 分支的极少数位置；布局优先用 Tailwind 断点，避免 JS/CSS 双份断点。

### 5.2 组件分支

| 组件 | `mobile` | `compact` | `desktop` |
|---|---|---|---|
| `App` 顶栏 | 紧凑：workspace、连接、自动化状态、更多菜单 | 紧凑：保留主要按钮 | 现状 |
| `BoardRail` | 隐藏；底部导航显示计数 | 64px rail | 现状 |
| `TaskBoard` | 全宽列表：待处理优先 + 分组折叠 + 筛选 | 覆盖层，默认收起 | 现状 7 列覆盖层 |
| `CanvasPanel` | **不挂载** | 挂载 | 挂载 |
| `RightPanel` | 不显示独立右栏；任务详情与总管由全屏页承载 | 覆盖层 | 右侧面板 |
| `TaskDetailPanel` | 全屏；底部任务操作条 | 覆盖层 | 侧栏 |
| `SupervisorPanel` | 底部导航“总管”全屏 | 覆盖层 | 右栏 tab |
| 设置/信任/创建工作区 dialog | 全屏或底部抽屉 | 居中弹窗 | 居中弹窗 |
| `CreateTaskForm` / `NodePanel` | 列表选择器 + 表单 | 复用桌面画布选择 | 现状 |
| 节点列表（更多菜单） | 按类型分组 + 搜索；新建 text/file/agent，编辑 text/agent | 不单独提供，走画布 | 不单独提供，走画布 |
| `DigestCard` | 底部导航“汇报”全屏列表 | 右栏/看板卡 | 现状 |

复杂分支抽同目录小组件（如 `TaskBoardMobile.tsx`、`TaskDetailMobile.tsx`），但由原组件根据 viewport 渲染，不新增路由。

### 5.3 画布挂载

- `App` 在 `viewport === 'mobile'` 时不渲染 `CanvasPanel`，也不初始化 React Flow。
- `canvas` 查询仍保留：节点选择器、任务表单、总管 composer 需要节点列表。
- 移动端不显示“画布占位提示”，避免误导；在“新建任务”空态里提示“上下文可多选节点；连线依赖自动包含”。

### 5.4 数据与状态

- 复用 `RealtimeProvider`、TanStack Query、Zustand、`useCommand`。
- 移动端 tab 状态放 `useAppStore`：`mobileTab: 'board' | 'supervisor' | 'digest'`；任务详情由现有 `activeTaskId` + 全屏面板承载。
- URL 继续使用现有 `workspace` / `task` query 参数；不引入 router。
- 不新增本地持久化；不使用 localStorage 保存 token 或敏感信息。

### 5.5 设计系统

先改 `DESIGN.md`，再改代码：

- 断点：`<768` / `768–1023` / `≥1024`。
- 移动端触控尺寸 ≥44px；底部导航安全区 `env(safe-area-inset-bottom)`。
- 移动端页面内边距、卡片间距、底部任务操作条高度。
- 不新增颜色；状态色仍只用语义色。

### 5.6 Bundle

- 本迭代不做代码分割；`<768` 仍会下载 React Flow 代码，只是不挂载。
- 记录 `vite build` 的 JS gzip 体积；按 §11 的阈值决定是否后续用 `React.lazy` 懒加载 `CanvasPanel`。

## 6. 移动端信息架构

### 6.1 导航

- 顶栏：workspace 切换、连接状态、自动化状态（运行中/已暂停 + 暂停/恢复）、更多菜单（设置、信任、创建工作区、新建任务）。
- 底部导航：**看板 / 总管 / 汇报**；汇报 tab 显示未读圆点。
- 任务详情：从看板进入，全屏；返回回到看板。
- 平板（compact）：保留顶栏 + rail + 画布；看板默认收起；右栏覆盖。

### 6.2 看板

- 顶部“需要我处理”：审批（needs_approval）、回复（needs_reply）、验收（needs_review），显示计数与最长等待。
- 下面分组：进行中（running/queued/verifying）、待办（todo）、已完成（done/cancelled，默认折叠）。
- 状态筛选 chips：全部 / 待处理 / 进行中 / 待办 / 已完成。
- 任务卡：标题、状态 Chip、attention、等待时长、Agent/workspace；点击进详情。
- 待办进入“选择”模式：多选 + 批量开工（复用 `task.enqueue`，单批 ≤20，逐条报告失败）。
- 空态：无任务时显示“新建任务”和“让总管建任务”两个入口。

### 6.3 任务详情

- 头部：返回、标题、状态 Chip、等待时长。
- 底部任务操作条：开工（todo）、取消（活跃态）、停滞重新入队；审批/回复/验收动作在对应卡片内完成，避免长 transcript 把闸门挤出视口。
- 内容顺序：
  1. 闸门：审批卡、提问卡、验收卡（复用现有组件并做窄屏布局）。
  2. transcript：只读，虚拟滚动；长会话分页/尾部加载复用现有实现。
  3. 上下文快照：节点列表 + 关系提示。
  4. 自动化记录：自动批准/重试/策略版本。
- 打回必须填反馈；危险操作二次确认。

### 6.4 建任务

- 入口：看板“新建任务”、顶栏更多菜单、总管 composer。
- 字段：Agent（选择已有或新建）、上下文节点（多选，排除目标）、标题、prompt、verify 命令（可选）、引擎、跳过权限（仅信任 workspace）。
- 新建 Agent：标题 + 引擎；先 `node.create`（type `agent`，`taskId: null`），再 `task.create`；失败保留节点并提示重试。
- 上下文：多选 text/file/agent；不选也可创建；连线依赖自动包含，表单提示“可在任务详情核对”。
- 提交：默认“创建”（进 `todo`）；可勾选“创建后立即开工”（`task.create` → `task.enqueue`）。
- 校验：标题/prompt 必填；引擎不可用时禁用提交；未信任 workspace 不显示“跳过权限”。

### 6.5 节点表单

- 入口：更多菜单 → **节点列表**。节点列表按类型分组、支持搜索；点击 text/agent 进入编辑，file 只读；提供“新建文本 / 新建文件 / 新建 Agent”；不显示画布、不显示边。
- 任务表单内也可直接“新建 Agent”。
- Text：内容（多行）；标题由首行推导（与 `nodeTitle` 一致）。
- File：创建时填写名称、工作区相对路径、可选 mime；表单做非空与相对路径提示；已有 file 节点只读（daemon 不允许更新 file data）；实际读取由现有 `resolveWithin` 在上下文装配时校验，越界按 core 现有策略失败。
- Agent：标题、引擎；编辑时只改标题，不改引擎（避免影响已建任务）。
- 默认位置：`x = 80 + (nodeCount % 4) * 360`，`y = 80 + floor(nodeCount / 4) * 240`；宽 320、高 200；桌面可再拖动。
- 不提供删除；不提供连线；不创建 image/group/review。

### 6.6 总管

- 底部导航“总管”全屏；消息历史、流式文本、工具卡、建任务卡复用现有组件。
- Composer 增加“目标 Agent”和“上下文”选择按钮；选中后显示 chips；发送 `supervisor.send` 时带 `targetNodeId` / `contextNodeIds`。
- 建任务卡仍只“打开任务”，不自动开工。
- 断线/重连沿用现有 `waitForReply` 与流式状态复位。

### 6.7 设置、信任、工作区

- 自动化设置：复用 `AutomationSettingsDialog`；移动端全屏；三个可编辑字段 + allow/deny/verify/digestCron 只读 + 最近变更。
- 顶栏状态：运行中 / 已暂停 / 由环境变量强制暂停；暂停/恢复调用现有 kill-switch REST。
- 信任/取消信任：复用 `WorkspaceTrustDialog`；移动端明确警告“信任后仓库策略可启用自动化”。
- 创建工作区：复用 `CreateWorkspaceDialog`；移动端全屏。
- workspace 切换：顶栏 select；切换后重置任务详情和 tab。

### 6.8 汇报

- 底部导航“汇报”：digest 列表、未读/已读、历史、手动生成。
- 摘要内容与桌面一致：待验收/待处理/已放弃、变化计数、最长等待、前 3 个 blocked。
- 不新增通知渠道；未读圆点只在本应用内。

### 6.9 可访问性

- 所有图标按钮有 `aria-label`；底部导航使用 `aria-current`。
- 触控目标 ≥44×44px；不使用 hover-only 操作。
- 焦点可见；弹窗焦点陷阱复用 HeroUI/React Aria。
- 状态不只靠颜色：Chip + 文案/图标。
- 对比度达到 WCAG AA；暗色主题固定。

## 7. 数据流与命令

### 7.1 复用端点

| 用途 | 端点/命令 |
|---|---|
| workspace 列表/创建/信任 | `GET/POST /api/workspaces`、`PATCH /api/workspaces/:id/trust` |
| 画布节点 | `GET /api/canvas?workspaceId=` |
| 引擎 | `GET /api/engines` |
| 任务列表/详情/自动化 | `GET /api/tasks`、`GET /api/tasks/:id`、`GET /api/tasks/:id/automation` |
| 会话事件 | `GET /api/sessions/:id/events?sinceSeq=&limit=` + WS |
| 通知 | `GET /api/notices`、`POST /api/notices/:id/read` |
| 自动化 | `GET/PATCH /api/workspaces/:id/automation`、`PUT /api/automation/kill-switch`、`POST /api/workspaces/:id/digest` |
| 审计 | `GET /api/audit?actionPrefix=` |
| 总管 | `GET /api/supervisor/status`、`GET /api/supervisor/messages`、WS `supervisor.send` |
| 任务动作 | `task.create`、`task.enqueue`、`task.cancel`、`session.reply`、`approval.decide`、`review.decide` |
| 节点 | `node.create`、`node.update` |

### 7.2 写操作顺序

- 新建 Agent + 任务：`node.create` → `task.create`；两步都成功后刷新 tasks/canvas。
- 创建并开工：`task.create` → `task.enqueue`；enqueue 失败保留 `todo` 并提示。
- 新建 text/file：`node.create`；刷新 canvas。
- 编辑 text/agent：`node.update`；file 只读；刷新 canvas。
- 批量开工：逐条 `task.enqueue`；汇总成功/失败，单批上限 20。

### 7.3 上下文与连线

- 手机只选节点；core 仍按现有规则把目标 Agent 的连线依赖纳入上下文。
- 表单与任务详情显示“连线依赖自动包含”；任务详情的上下文快照是最终事实。
- 手机不创建/删除边，不改变现有上下文语义。

### 7.4 WS 与后台

- 复用 `RealtimeProvider` 的重连 + `sinceSeq` 回放。
- 移动端从后台恢复：重新拉取任务列表/详情，WS 重连；不重复插入旧事件。
- 命令失败沿用现有 ack 超时/错误关联/Toast。

## 8. 安全与隐私

- `/auth?token=` 设置 HttpOnly、SameSite=Strict cookie；不把 token 写 localStorage。
- 远程访问：`BATON_HOST=0.0.0.0` + `BATON_TOKEN` + Tailscale/Caddy/Nginx；补 runbook。
- 手机是完整控制面：同一 token 拥有全权限。手机丢失视为凭据泄露：轮换 `BATON_TOKEN` 并重启 daemon；截图不得包含 token/URL。
- 不新增服务端只读 scope；不实现手机端登出端点（未来路线）。
- 信任/取消信任、跳过权限、kill switch 恢复都需要明确确认；自动批准仍受 M2-2a 的 effective autopilot 约束。
- 日志、审计、截图脱敏规则不变；移动端不新增埋点。

## 9. 错误处理

| 场景 | 行为 |
|---|---|
| 401 / WS 4401 | 顶栏显示未认证横幅，引导 `/auth?token=...` |
| 409 `workspace_untrusted` | 自动化设置/跳过权限显示未信任提示；不提供绕过 |
| 404 任务/节点 | 返回看板并提示“任务或节点不存在” |
| 表单校验 | 标题/prompt 必填；file 创建时名称/相对路径必填；引擎不可用禁用提交 |
| Agent 创建成功、任务失败 | 保留 Agent 节点，提示重试；不自动回滚 |
| 批量开工部分失败 | 逐条报告，保留成功任务 |
| WS 断线 | 显示连接状态；恢复后回放 + 重拉快照 |
| 空 workspace | 空态 + 创建/建任务入口 |
| 无 Agent 节点 | 任务表单显示“新建 Agent”入口 |

## 10. 测试与验收

### 10.1 单元/组件

- `useViewport` 在 `mobile/compact/desktop` 三档的订阅与回退。
- `TaskBoard` 移动分支：待处理优先、分组、筛选、批量选择。
- `TaskDetailPanel` 移动分支：审批/提问/验收、底部任务操作条、打回反馈。
- `CreateTaskForm`：已有/新建 Agent、上下文多选、创建并开工。
- `NodePanel`：text/file/agent 表单、默认位置、路径错误；移动端 file 只读。
- `SupervisorComposer`：目标/上下文选择器、发送 payload。
- 设置/信任/工作区 dialog 的窄屏行为。

### 10.2 Playwright

视口：`360×800`、`390×844`、`768×1024`、`1280×800`。

移动端用例：

1. `<768` 无画布 DOM；看板待处理优先；任务卡显示等待时长。
2. 审批允许/拒绝；提问回复；验收通过/打回（含反馈必填）。
3. 开工、取消、批量开工（部分失败提示）。
4. 表单建任务：新建 Agent + 上下文 + 创建；创建并开工。
5. 新建 text/file 节点；编辑 text；相对路径表单提示与上下文装配失败提示。
6. 总管发送 + 目标/上下文选择 + 建任务卡打开任务。
7. 自动化设置保存、未信任 409、kill switch 暂停/恢复。
8. 信任/取消信任、创建工作区、workspace 切换。
9. digest 未读/已读/历史/手动生成。

平板用例：画布存在；看板默认收起；右栏覆盖；关键动作可用。
桌面回归：现有 e2e 全量通过；画布/7 列看板/右栏不被移动分支影响。

### 10.3 真实链路

- ego-lite H5 视窗（390×844）+ 真实 daemon + 真实 Claude。
- 流程：手机建任务（新建 Agent + 上下文）→ 开工 → 审批（至少一次 allow/deny）→ verify → 移动端验收通过/打回。
- 截图脱敏，存 `docs/evidence/2026-11-19-m2-2b-mobile-console/`，附 README。
- 真实 Claude 只用于验收证据，不进入 CI。

### 10.4 check:secrets

- gitleaks（MIT，单二进制）：
  - 一次性全历史基线：`gitleaks detect --source . --log-opts="--all"`。
  - CI：PR diff/新增提交扫描；命中失败。
  - 本地脚本 `pnpm check:secrets`。
- 发现存量密钥：先报告、评估轮换；不改写历史后当作没发生。
- 更新 `THIRD_PARTY_NOTICES.md`（若 gitleaks 作为开发/CI 依赖进入锁文件）。

### 10.5 命令

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
```

## 11. 性能与风险

| 风险 | 影响 | 对策/触发条件 |
|---|---|---|
| 响应式分支回归桌面 | 桌面布局/交互损坏 | `≥1024` 不改变结构；桌面 e2e 全量；分支抽小组件 |
| 移动端范围过大 | 迭代失控 | 一个 spec、四个 plan；共享选择器/复用 dialog |
| 手机 token 全权限 | 手机丢失=凭据泄露 | runbook + token 轮换；不新增 scope；截图脱敏 |
| React Flow 仍在移动 bundle | 首屏变慢 | 记录 gzip 体积；若移动 JS > 400KB gzip 或 ego-lite H5 首屏 > 2s，再 `React.lazy` 懒加载 |
| 长 transcript | 移动端卡顿 | 复用虚拟滚动；尾部加载；超过 50k 再引入增量投影 |
| 后台 WS 断线 | 状态陈旧 | 恢复时重连 + 重拉快照；`sinceSeq` 回放 |
| 节点默认位置重叠 | 桌面画布混乱 | 网格位置；桌面可拖动；新节点创建后刷新 canvas |
| 上下文无连线视图 | 用户误判范围 | 表单提示 + 任务详情上下文快照 |

## 12. 实施切片

一个迭代，四个实施 plan；不是分批交付，而是控制单次改动可回滚。

1. **Plan 1 foundation**
   - `check:secrets`（gitleaks 脚本 + CI + 全历史基线）。
   - `useViewport`、`DESIGN.md` 响应式 token、App 顶栏/底部导航、`<768` 不挂画布、平板压缩布局。
   - 桌面/平板/手机三档壳测试。
2. **Plan 2 tasks**
   - 移动看板、任务详情、审批/提问/验收、开工/取消/批量开工、transcript 虚拟滚动。
3. **Plan 3 controls**
   - 建任务表单、节点选择器、text/file/Agent 表单、总管 composer、设置/信任/工作区、digest、kill switch。
4. **Plan 4 acceptance**
   - Playwright 多视口全量、ego-lite H5 真实 Claude、桌面/平板回归、证据与索引。
   - `pnpm verify:full`、`pnpm pack:check`、`check:boundaries`、`check:protocol`、`format:check`。

每片结束跑 `pnpm verify`；第 4 片结束跑全量命令。

## 13. 未来路线（不在本 spec）

- Web Push / 外部通知渠道（手机锁屏提醒）。
- PWA 可安装、离线队列。
- image/group/review 节点、节点删除、连线表单。
- 只读 token scope、手机端登出、短期配对 token。
- `React.lazy` 画布代码分割（按测量触发）。
- diff 视图、cost/turn、M1-7b。
- 外部 Source、主动运行。

## 14. 评审记录

- 2026-11-19：用户逐项确认——
  - 下一迭代为 M2-2b 移动端；从“只读”改为“完整非画布控制面”。
  - 响应式改造现有三栏，不做独立壳/路由。
  - 断点 `<768` 移动、`768–1023` 压缩桌面、`≥1024` 桌面不变。
  - 手机端不显示画布；不删除节点、不建连线。
  - 建任务：表单 + 总管，共享节点选择器；任务表单可新建 Agent。
  - 节点表单：创建/编辑 text、创建 file、创建/编辑 Agent；已有 file 只读；不创建 image/group/review。
  - workspace：切换/创建/信任/取消信任均在手机端。
  - 认证沿用 `/auth` cookie；通知只做站内；验收 Playwright + ego-lite H5 + 一次真实 Claude。
  - `check:secrets` 用 gitleaks 全历史基线 + PR diff，折进 Plan 1。
  - 新 ADR 0007 + 本 spec 回链，反转移动端只读。
- 设计已通过；spec 已获用户审阅通过。下一步：sprint contract（DoD）与 4 个实施 plan。
