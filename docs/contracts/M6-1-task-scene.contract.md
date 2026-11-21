# M6-1 任务现场 v0：Definition of Done

> 回链 spec：`docs/specs/2026-11-21-m6-task-scene-design.md`。
> 前置：M1-M5-3 已合并；`main` 最新提交 `f57dcae`。
> 分支：spec 在 `docs/m6-task-scene-spec`；实现分支从最新 `main` 开 `feat/m6-1-task-scene`。

## 0. 文档信息

- **状态**：已实现，验收通过；证据见 `docs/evidence/2026-11-21-m6-task-scene/`。
- **范围**：`packages/protocol/**`、`packages/core/**`、`apps/daemon/**`、`apps/web/**`、migration 0010、测试与 `docs/**`。
- **预期不改**：任务状态机与转移语义；`assembleContext` 的预算/深度/敏感路径规则；`node`/`edge` 表结构；现有上传接口行为。
- **GDD**：仓库没有 `docs/agent-harness/` 与 GDD 脚本，按 M1/M2/M3/M5 先例显式跳过；测试设计由本 contract 的 DoD 与 5 个 plan 的测试矩阵承担。

## 1. 用户可见结果

我在看板或任务详情点一下，就能在画布上看到这个任务吃了哪些上下文、谁在干、验收做到了什么程度、已经等了多久；无关内容退到背景。图片、分组和验收卡都能直接看懂、能拖动整理，但不会改变任务状态。总管只在我明确要求时移动或重命名节点；最终通过或打回仍然只由我决定。

## 2. DoD

- [x] **1. 现场入口与范围**：任务详情头部和看板任务卡都能进入现场；进入后 `relatedNodeIds` 精确等于 `target agent ∪ context.included[].id ∪ origin.contextNodeIds`（去重、只保留当前存在的节点）；无关节点 opacity 0.25 且不可编辑；只显示两端都在 `relatedNodeIds` 的边；相关折叠 group 临时展开；现场条显示任务标题、status、等待时长、included/dropped/missing 数量；退出恢复之前的折叠状态并清除现场模式；进入/退出现场不发送 `node.*`/`task.*` 写命令。
- [x] **2. 缺失上下文降级**：context/origin 引用的节点已被删除时，现场条显示 `missingNodeIds.length`；不生成幽灵节点、不崩溃；Agent 缺失时 review 卡回退到 `(0,0)`。
- [x] **3. Image 本地与受保护读取**：本地上传复用 `POST /api/workspaces/:id/uploads`；只接受 png/jpeg/webp/gif/svg 且 ≤10MB；`ImageNode.src` 写 `.baton/uploads/<safe-name>`；新增 `GET /api/workspaces/:id/uploads/:name` 只服务该目录，带 auth、realpath jail、拒绝软链、正确 Content-Type、`X-Content-Type-Options: nosniff`；404/损坏显示占位 + 文件名，不阻塞画布。
- [x] **4. Image 外链与安全**：外链只接受 `https://`、长度 ≤2048、无用户名/密码、拒绝 `data:`/`file:`/`javascript:`；浏览器端 `<img>` 加 `referrerPolicy="no-referrer"`、`loading="lazy"`；daemon 不抓取、不代理外链；SVG 只在 `<img>` 渲染，服务端加 CSP sandbox；图片进入上下文只输出 `<image src="..."/>`，不写 base64。
- [x] **5. Group 创建与成员**：只允许从当前选中、非 group、`groupId === null` 的节点建组；`group.create` 在单事务内创建 group 并批量设置子节点 `groupId`；拖入/拖出按节点中心点判定，重叠取面积最小的 group；`node.update { groupId }` 校验同 canvas、非自身、非 group 节点。
- [x] **6. Group 拖动与删除**：拖 group 结束发送一次 `node.move_many`，包含 group 与全部子节点的绝对坐标；刷新后位置保持；任一节点非法时整笔回滚，前端 refetch 并 toast；删 group 在单事务内先把子节点 `groupId = null` 再删组，不删子节点。
- [x] **7. Group 折叠语义**：折叠只隐藏画布子节点和相关边；`assembleContext` 仍展开 group 的内容节点；折叠状态写入 group data，刷新后保持；现场临时展开不持久化。
- [x] **8. Review 卡**：仅在 `task.status === 'review'` 时派生 `review:${taskId}`；不写入 `node` 表、不参与 `relatedNodeIds`/边；现场卡显示标题、status、等待时长、verify 退出码、diff stat、初步结论（`preliminaryVerdict` 为 null 时显示“初步验收进行中/未完成”）；全局卡按 §5.2 只显示 `TaskSummary` 摘要，完整验收信息在任务详情与现场卡；只读，无通过/打回；点击打开任务；任务离开 review 后卡片消失。
- [x] **9. 初步验收字段**：`review` 新增 `preliminary_verdict/reason/at` 三个 nullable 列 + migration 0010；验收员结论确定后，只有在目标仍处于同一轮 `review` 时才写入；写入成功 emit `review.preliminary`；目标已离开 review 时不写；旧 review 行升级后三列为 null。
- [x] **10. 总管画布操作**：新增 `update_node`（`nodeId`、`x?`、`y?`、`title?`）；只允许移动任意节点、重命名 agent；不删除、不改文本/图片/分组 data、不改 `groupId`；节点必须属于当前 workspace canvas；写审计 `supervisor.node.update`；跨 workspace 返回 `node_not_found`。
- [x] **11. 总管画布感知**：`list_canvas` 的节点摘要包含 `x/y/w/h/groupId`；`SUPERVISOR_POLICY.allowedTools` 15 → 16；真实引擎请求体包含 16 个工具；prompt 明确“只有用户明确要求才移动/重命名、不自动重排、不删除”。
- [x] **12. 看板注意力**：新增「需要我」筛选，口径复用 `needsPerson`；标题搜索大小写不敏感；按 `waitingSince` 升序、null 最后；`isStale` 在 `waitingSince <= now - 30min` 时为 true；stale 卡有文字/图标标记；rail「需要我」计数等于筛选后列表长度；手机保留筛选、排序和 stale，不加入现场入口。
- [x] **13. 安全与隐私**：图片路由不做目录列表、不读任意路径、不代理外链；外部 URL 校验拒绝凭据/非 https/data/file/javascript；SVG 不内联到 DOM；总管审计不记录文本内容；事件只含 taskId/reviewId/verdict/at；错误与日志不写本机绝对路径、transcript、diff 正文或图片内容。
- [x] **14. 测试覆盖**：protocol 命令/字段解析；core `buildTaskScene`/`findContainingGroup`/`isStale`/`sortByWaiting`/`parsePreliminaryVerdict` 单测与快照；daemon migration/事务回滚/删组解绑/图片路由 jail/MIME/软链/supervisor 审计/初步字段条件；web 三节点渲染、分组拖动/成员/折叠、现场降暗/展开/恢复、看板过滤/排序/stale、review 卡；Playwright 覆盖图片、分组拖动、现场、review 卡、过滤排序；真实 Claude + ego-lite 跑通 review 现场并截图。
- [x] **15. 命令与迁移**：migration 0010 在 fixture DB 上从 0009 升级通过；`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；新增源码无未完成项。
- [x] **16. 不产生第二真相源**：不新增 `NodeType`；不建任务级画布表；review 卡不落库；现场不持久化；不把 transcript/diff 正文搬上画布；不做 AC/cost/外部 Source/DAG/自动验收。
- [x] **17. 文档收口**：`docs/README.md` 索引包含 spec/contract/plans；证据落 `docs/evidence/<date>-m6-task-scene/`；截图按仓库脱敏规则处理；contract 的 DoD 全部勾选后才能宣布完成。

## 3. Boundary Conditions

- **Must support**：桌面/平板任务现场；手机看板筛选/排序/stale；现有 text/file/agent 节点与 context 边；现有审批、提问、verify、diff、worktree、历史、retry/reopen、handoff 不回归。
- **Must not break**：`task.status` 单写者与状态机；`assembleContext` 预算/深度/敏感路径；现有上传接口；旧数据库升级；总管 15 个既有工具。
- **Performance**：现场 200 节点内保持可交互；图片懒加载；现场降暗用 CSS，不重挂全部节点；不因 review 卡轮询导致全量重渲染。
- **Security**：daemon 不对外链发请求；图片读取只开放 uploads；SVG 不执行脚本；外链不携带凭据；不把 base64 写入事件/日志/prompt。
- **Data**：所有节点坐标继续是绝对坐标；group 成员只改 `groupId`；review 卡不写 `node` 表；迁移只加 nullable 列。

## 4. Acceptance Criteria

**Computational**

- `pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全部退出码 0。
- migration 0010 在 fixture DB 上升级成功；旧 review 行三列为 null。
- Playwright 覆盖：图片节点、分组拖动、任务现场、review 卡、看板过滤/排序/stale。
- protocol/core/daemon/web 的新增测试全部通过；core 覆盖率不低于现有基线。

**Inferential**

- 人工 review：现场是否一眼能看出“这个任务吃了什么、卡在哪、等了多久”；review 卡是否明确“只是初步结论，最终由人决定”；分组拖动是否符合直觉；stale 是否不制造噪音。
- ego-lite + 真实 Claude：任务到 review 后现场显示初步结论；人工通过/打回后 review 卡消失；截图证据可复核。

## 5. 不在范围

- AC 清单、cost/turn、自动批准次数上限（M5-4）。
- 外部 Source / Trigger / Thread / Subscription / Admission（M5-2）。
- DAG/任务依赖、运行中 `context.inject`、续已结束旧 session。
- 任务级独立画布表、`NodeType` 扩展、图片 OCR/向量化。
- 自动验收/代验收、总管 approve/reject、系统推送/短信。
- 多用户、跨 workspace 现场、手机画布现场。

## 6. 实施顺序

1. **Plan 1 protocol + core + migration 0010**：命令/字段、scene/grouping/stale/preliminary 纯函数、迁移与单测。
2. **Plan 2 daemon**：repository 批移动/建组/解绑、图片路由、supervisor `update_node`/坐标、验收员写初步字段、集成测试。
3. **Plan 3 web canvas**：图片/分组/review 渲染与创建、分组拖动/成员/折叠、现场模式与现场条。
4. **Plan 4 web tasks/attention**：看板筛选/排序/stale/rail、review 卡联动、组件测试。
5. **Plan 5 验收与文档**：Playwright、ego-lite 真实 Claude、证据、docs 索引、contract 收口。

依赖：Plan 2 依赖 Plan 1；Plan 3 依赖 Plan 1+2；Plan 4 依赖 Plan 2+3；Plan 5 依赖全部。

## 7. Negotiation Record

- **Generator initial**：9 条宽泛标准（现场、图片、分组、review 卡、总管、看板、迁移、测试、无第二真相源）。
- **Evaluator challenges**：
  - “相关节点”没有精确定义，未说明缺失节点和边收敛。
  - “不抢视口”不可测，未说明入口和退出恢复。
  - 图片只说“支持”，未说明格式、大小、外链校验、读取路由、上下文表示。
  - 分组拖动未说明事务、坐标语义、失败回滚和刷新保持。
  - review 卡未说明 null 初步结论、是否可内联决策、离开 review 的行为。
  - 总管边界未说明允许字段、审计、跨 workspace 和工具数量。
  - “需要我”计数未给出公式和 stale 边界。
  - 迁移未说明旧数据兼容；未明确 review 卡不落库。
- **Final consensus**：17 条可逐条判定 yes/no 的 DoD；上述歧义全部写成可测试条件。

## 8. 证据

- Playwright：`apps/web/e2e/task-scene.spec.ts`、`canvas-group.spec.ts`、`board-attention.spec.ts` 全部通过；覆盖图片、现场条、分组拖动一次 `node.move_many`、需要我筛选/stale/review 卡。
- 真实 Claude：`docs/evidence/2026-11-21-m6-task-scene/README.md`。临时 daemon + Vite + 真实 claude-sdk；任务 `review` → 现场（verify 1、diff 2 文件 +5/-1）→ 人工通过 → 任务 `done`、review 卡消失。
- 真实 Claude 环境限制（如实记录）：临时环境 Corepack 缓存的 `pnpm` 不可用，`verifyExitCode = 1`；Claude 会话内改用 Homebrew pnpm 跑通。临时 daemon 未配置总管模型，因此 `preliminaryVerdict = null`，review 卡显示“进行中/未完成”。
- 图片：本地 png、外链 https、坏图占位、SVG 渲染由 web 组件测试与图片路由集成测试覆盖。
- 分组：建组、拖入/拖出、整组拖动刷新、折叠上下文不受影响、删组解绑由 core/daemon/web 测试覆盖。
- 看板：需要我过滤、等待排序、stale 标记、rail 计数一致由 core/web/Playwright 覆盖。
- 全量命令：`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 均退出码 0（2026-11-21）。

## 9. 评审记录

- 2026-11-21：spec 已获用户审阅通过；本 contract 由 sprint-contract 生成并完成两轮 evaluator 挑战，待用户确认后进入 writing-plans。
