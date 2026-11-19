---
spec_topic: m3-1-delivery-acceptance
decision_summary: "M3-1 交付验收增强：verify 时持久化 diff 快照并按需查看；worktree 默认关、按任务可选且不自动合并/删除；retry/reopen 人工触发并开新 episode；任务历史复用 ws_event.task_id，不新建事件表"
design_approved: true
user_approved_at: "2026-11-19T16:51:17+08:00"
gates: [design-approved]
spec_ref: 2026-11-16-baton-architecture-design.md
domain_terms: [delivery acceptance, diff snapshot, worktree, retry, reopen, episode, task history, lazy diff API]
---

# M3-1 交付验收增强：diff 视图、worktree 隔离与任务售后设计

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：M2 已收口——M2-1 总管 Router v0（`0c9eedf`）、M2-2a 无人值守与汇报（`922a339`）、M2-2b 移动端响应式控制台（`960580e`）。
> 背景材料：`baton.ai` 三份讨论稿（不进仓库）；只作为产品方向参考，不作为实现依据。
> 架构 spec §7 的 M3 表在 ADR 0003 移除 Docker 后部分失效；本 spec 把 M3 的第一阶段重述为“交付验收增强”，分发与 DSH 后置。

## 0. 文档信息

- **状态**：设计已获用户逐项确认（2026-11-19）；spec 待用户审阅。
- **范围**：`packages/protocol/**`、`packages/core/src/state-machine/**`、`apps/daemon/**`、`apps/daemon/migrations/**`、`apps/web/**`、`docs/**`。
- **不在范围**：总管工具扩容、外部 Source（GitHub/飞书）、DSH、画布 image/group/review 节点、`canvas.patch`、M1-7b（partial streaming / cost / turn / idle eviction）、自动 merge、自动清理 worktree、PWA 与外部通知、多用户。
- **文档位置**：spec 落 `docs/specs/`，contract 落 `docs/contracts/`，plan 落 `docs/plans/`；不使用 `docs/agent-harness/`。
- **命名**：本迭代叫 M3-1。M2 已按 M2-1 / M2-2a / M2-2b 收口，不再新增 M2 子编号。

## 1. 背景

M1 已把单任务闭环跑通：画布上下文与关系 → 建任务 → 真实 Claude 执行 → 审批/提问 → verify → 人工验收。M2-1 把总管 Router v0 做实；M2-2a 把自动批准、自动重试、kill switch、digest 和看板批量开工做实；M2-2b 把手机变成完整控制面。M2 验收标准“无人值守连续跑 3 个任务并产出汇报；手机上能通过/打回”已经闭合。

现在产品最大的缺口不再是“入口”，而是**单个任务的交付质量**。背景文章把标准总结为三个问题：**定义正确、验证正确、失败可恢复**；并明确建议先把这个质量三角跑稳，再交给 Router 放大并发。当前代码里三块板都不完整：

1. **验收是盲的**：`ReviewCard` 只显示 `+/-` 行数（`apps/web/src/features/tasks/ReviewCard.tsx`），`review` 表只有 `diff_stat_json`，没有 diff 正文。人无法在 baton 内判断“改得对不对”，只能切回终端。
2. **并行不安全**：`apps/daemon/src/runtime/task-service.ts:45` 直接拒绝 `workspaceMode !== 'main'`；`WorkspaceMode` 已有 `worktree` 枚举、`task.worktreePath` 字段也一直为 `null`。同一 workspace 并行跑多个任务会互相踩。
3. **没有售后**：`task.retry` / `reopen` 在 M1-5a 明确后置；任务详情没有历史时间线。文章里“老 Bug 找回来、新开 session 继续修”的场景做不了；dsh 拆解 9.3 的第 5 问“失败三次之后谁看得到、他能做什么”也答不上。

本迭代选择 **M3-1 交付验收增强**：diff 快照与按需查看、worktree 隔离、任务 retry/reopen 与历史。它同时是架构 spec §7 中 M3 的核心交付（worktree 开关、diff 视图）；分发与 DSH 不在本迭代。

## 2. 目标与非目标

**目标**

1. verify 结束时把 diff 快照持久化到 `review`；验收卡可按需展开统一 diff，覆盖修改/新增/删除/重命名/二进制/截断。
2. diff 证据在 daemon 重启、worktree 清理后仍可读；旧 review 没有快照时给出明确降级。
3. 任务可按任务选择独立 worktree；默认关；verify、diffStat、diff 捕获都在工作树内执行；并行两个任务同一 workspace 不冲突。
4. worktree 结束后保留；清理是显式动作并写 audit；boot 只 prune 缺失目录，不误删。
5. 任务可从 `failed` retry、从 `done`/`cancelled` reopen；两者都人工触发、重置自动重试预算、开新 episode，历史只追加。
6. 任务详情提供历史时间线：状态变化、session 开始/结束/outcome、verify/review 结果；不展示 transcript 正文。
7. verify 失败时的 PATH/命令诊断与 runbook 落地，避免宿主机 shim 问题被误判为产品失败。
8. 单测、daemon 集成、Playwright、ego-lite + 真实 Claude 全链路验收。

**非目标**

- 总管新增 `enqueue` / `retry` / `reopen` / 验收工具；总管仍只有 `list_tasks` / `get_task` / `create_task`。
- 外部 Source、Thread 订阅、admission、bot、多身份。
- 自动 merge / 自动开 PR / 自动清理 worktree；worktree 的合入由人手动完成。
- 画布 image/group/review 节点、`canvas.patch`、移动端画布。
- M1-7b 的 partial streaming、成本/turn UI、idle eviction/resume。
- 完整事件溯源；`ws_event` 只增加任务维度索引列，不改变重放语义。
- 多 session 并行执行同一个任务；本迭代仍是“一个任务一个活跃 run”。

## 3. 关键决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 迭代范围 | M3-1 三件套：diff、worktree、售后/历史 | 同时补“验证正确”和“失败可恢复”；也是架构 M3 的核心 |
| D2 | diff 证据归属 | verify 时快照写入 `review.diff_json` | 重启、清理后证据仍在；与风险表“重启丢验收证据”的既有对策一致 |
| D3 | diff 读取方式 | 懒加载 `GET /api/reviews/:id/diff`，不塞进任务详情 | 详情保持轻量；diff 不可变，适合长缓存 |
| D4 | diff 上限 | 总 512KB、单文件 128KB；超限标记 `truncated`，不静默丢 | 防内存与响应失控；截断可见 |
| D5 | worktree 默认 | 默认关，建任务时按任务显式选择 | 与架构决策 #14 一致；先观察真实并行需求 |
| D6 | worktree 路径 | `$BATON_DATA_DIR/worktrees/<taskId>`，分支 `baton/<taskId>` | 不污染仓库；分支名由 taskId 推导，不接受用户输入 |
| D7 | worktree 生命周期 | `queued → running` 时创建；失败 → `failed`；结束后保留；手动清理；boot 只 prune 缺失目录 | 不做事后自动删除；diff 已入库，清理不丢证据 |
| D8 | worktree 合并 | 不自动 merge；分支保留，由人手动合入 | 避免自动改写用户主工作树；v1 保持显式 |
| D9 | retry 语义 | `failed` + retry → `queued`；重置 `retryCount=0`；备注按 `feedback` 追加 | 人工介入即重置自动重试预算；失败恢复应直接重跑 |
| D10 | reopen 语义 | `done`/`cancelled` + reopen → `todo`；重置 `retryCount=0`；备注按 `reopen_note` 追加；不自动开工 | 旧任务上的新工作，先让人确认上下文；开工仍由人触发 |
| D11 | 新 episode 策略 | 新 session 使用当前 workspace policy 快照，刷新 `task.policy_json`；旧 episode 授权快照不变 | 与 M2-2a D15 一致；策略变更只影响新会话 |
| D12 | 历史取数 | `ws_event` 加可空 `task_id` + 回填 + `(task_id, ordinal)` 索引；不新建 `task_event` 表 | 状态历史已在 `ws_event`；加索引列不新增真相源、不重复写事件 |
| D13 | 总管边界 | 总管工具面不变；retry/reopen/cleanup 只暴露给人工 WS/REST | 先做人闸门与交付质量，再扩自治 |
| D14 | verify PATH | 先加失败诊断与 runbook；不凭空改登录 shell 环境解析 | 项目原则“先复现再修”；证据显示是宿主机 shim 环境问题 |
| D15 | 移动端 | 历史与只读 diff 纳入；不做画布、不做 diff 编辑 | 移动端是控制面；验收需要看得见改动 |
| D16 | 隐私 | diff 正文不进日志、不进 WS；UI/证据不展示本机绝对路径 | diff 可能含密钥；截图可能长期留存 |

## 4. 领域词汇与不变量

| 词汇 | 定义 |
|---|---|
| delivery acceptance | 人基于 verify 输出与 diff 快照做通过/打回的闭环 |
| diff snapshot | verify 结束时捕获的统一 diff 与文件统计，持久化在 review |
| worktree | 任务独立的 git 工作树与分支；目录在 data dir 下 |
| retry | 对 `failed` 任务的人工恢复动作；回到 `queued` |
| reopen | 对 `done`/`cancelled` 任务的人工重开动作；回到 `todo` |
| episode | 一次 session + 其后的 verify/review；retry/reopen 开新 episode |
| task history | 由状态事件、session、review 组成的时间线；不存 transcript 正文 |
| lazy diff API | 验收卡打开时才读取 diff 快照的 REST 接口 |

**七条不变量**

1. 验收证据（verify 输出 + diff 快照）在 review 时刻持久化；daemon 重启、worktree 清理后仍可读。
2. worktree 默认关；只有显式选择才启用；路径必须在 data dir jail 内。
3. 不自动 merge、不自动删除 worktree；清理是显式动作并写 audit。
4. retry/reopen 只能人工触发；总管工具不可调用。
5. retry/reopen 开新 episode；旧 session/review 历史只追加、不改写。
6. 新 episode 使用当前 workspace policy 快照；旧 episode 的授权快照不变。
7. diff 正文不进日志、不进 WS；只通过鉴权 REST 读取。

## 5. 协议增量

### 5.1 状态转移事件

`packages/protocol/src/transitions.ts` 增加两个事件：

```ts
z.object({
  type: z.literal('retry'),
  note: z.string().min(1).max(16_384).optional(),
}),
z.object({
  type: z.literal('reopen'),
  note: z.string().min(1).max(16_384).optional(),
}),
```

`packages/core/src/state-machine/transition.ts`：

- `failed` + `retry` → `queued`，`retryCount` 返回 `0`，effects 追加 `enqueueTask()`；有 note 时追加 `appendFeedback(note)`。
- `done` / `cancelled` + `reopen` → `todo`，`retryCount` 返回 `0`；有 note 时追加新的 `appendReopenNote(note)` effect（`effects.ts` 新增，runtime 落到 `<reopen_note>` 块）。
- 其他状态一律 `invalid_transition`；`review` 仍走既有 `approve` / `reject`。
- `waiting_input(stalled)` 仍走既有 `enqueue`（看板“立即开工”），不新增 retry 分支。

### 5.2 WS 命令

`packages/protocol/src/commands.ts` 增加：

```ts
export const TaskRetryInput = z.object({
  taskId: Id,
  note: z.string().min(1).max(16_384).optional(),
})

export const TaskReopenInput = z.object({
  taskId: Id,
  note: z.string().min(1).max(16_384).optional(),
})
```

命令类型：`task.retry`、`task.reopen`。沿用现有信封、ack、错误关联与 10s 超时；成功后服务端广播 `task.status`，web 失效任务/历史查询。

### 5.3 REST

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/api/reviews/:reviewId/diff` | `ReviewDiffResponse` |
| GET | `/api/tasks/:taskId/history?limit=200&beforeOrdinal=` | `TaskHistoryResponse` |
| POST | `/api/tasks/:taskId/worktree/cleanup` | `{ ok: true }` |

约束：

- 三个接口都需要现有 token cookie；不新增匿名入口。
- `history` 的 `limit` 默认 200、上限 500；`beforeOrdinal` 只作用于状态事件。
- `worktree/cleanup` 对 `running` / `waiting_input` / `verifying` 返回 `task_active`；对没有工作树的任务返回 `worktree_not_found`。

### 5.4 协议类型

```ts
export const DiffFile = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: z.enum(['modified', 'added', 'deleted', 'renamed', 'binary']),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string(), // binary 时为空串
})
export type DiffFile = z.infer<typeof DiffFile>

export const DiffSnapshot = z.object({
  v: z.literal(1),
  capturedAt: Timestamp,
  baseRef: z.literal('HEAD'),
  truncated: z.boolean(),
  files: z.array(DiffFile),
})
export type DiffSnapshot = z.infer<typeof DiffSnapshot>

export const ReviewDiffResponse = z.object({
  reviewId: Id,
  taskId: Id,
  snapshot: DiffSnapshot,
})
export type ReviewDiffResponse = z.infer<typeof ReviewDiffResponse>

export const TaskStatusHistoryItem = z.object({
  ordinal: z.number().int().nonnegative(),
  ts: Timestamp,
  status: TaskStatus,
  previousStatus: TaskStatus,
  retryCount: z.number().int().nonnegative(),
  cause: TaskStatusCause.optional(),
  attention: Attention.optional(),
})
export type TaskStatusHistoryItem = z.infer<typeof TaskStatusHistoryItem>

export const TaskHistoryResponse = z.object({
  taskId: Id,
  statusEvents: z.array(TaskStatusHistoryItem),
  sessions: z.array(Session),
  reviews: z.array(ReviewView),
  nextBeforeOrdinal: z.number().int().nonnegative().optional(),
})
export type TaskHistoryResponse = z.infer<typeof TaskHistoryResponse>
```

`Review` 实体本身不变；新增 API 投影 `ReviewView = Review.extend({ diffAvailable: z.boolean() })`，用于任务详情与历史响应，由 `diff_json IS NOT NULL` 派生，不新增列。`statusEvents` 不足 `limit` 时不返回 `nextBeforeOrdinal`。

### 5.5 Prompt 块

`apps/daemon/src/db/repositories.ts` 的 `appendTaskPromptBlock` 标签扩展为：

```ts
tag: 'feedback' | 'user_reply' | 'reopen_note'
```

- retry 备注复用 `feedback`（与 verify 失败反馈同一语义）。
- reopen 备注用 `reopen_note`，追加到原 prompt 末尾；原 prompt 与上下文快照不被改写。

### 5.6 错误码

- `invalid_transition`：状态不允许 retry/reopen。
- `task_not_found` / `review_not_found`。
- `diff_unavailable`：旧 review 没有 diff 快照。
- `worktree_not_found` / `worktree_unavailable`（非 git 工作区或创建失败）。
- `task_active`：活跃任务不允许清理工作树。

## 6. 数据模型与 migration 0009

当前最新 migration 是 0008。本迭代新增 0009：

### 6.1 `ws_event.task_id`

```sql
ALTER TABLE ws_event ADD COLUMN task_id TEXT;
UPDATE ws_event
SET task_id = json_extract(payload_json, '$.payload.taskId')
WHERE type = 'task.status';
CREATE INDEX ws_event_task_ordinal_idx ON ws_event (task_id, ordinal);
```

- 列可空；只对 `task.status` 回填；解析失败或非任务事件保持 `null`。
- 写入侧：event store 追加 `task.status` 时显式写入 `task_id`；其他事件不写。
- `ws_event` 仍是客户端重放的唯一来源；`task_id` 只是任务维度索引，不改变事件语义。
- 不新建 `task_event` 表；session/review 历史直接查各自表。

### 6.2 `review.diff_json`

```sql
ALTER TABLE review ADD COLUMN diff_json TEXT;
```

- 存 `DiffSnapshot` 的 JSON 字符串；旧行为 `null`。
- 上限按 patch 字节计算：单文件 `patch` 超过 128KB 时截断该文件；所有文件 `patch` 合计超过 512KB 时停止追加后续文件；两种情况都置 `truncated=true`，文件统计仍保留。
- binary 文件只保留 status/统计与空 patch；重命名保留 `oldPath`。
- `diff_json` 不参与 verify 判定；verify 仍看 `verify_exit_code`。

### 6.3 不加的字段

- 不加 `task.worktree_branch`：分支名由 `baton/<taskId>` 推导；`worktree_path` 已有。
- 不加 `task.reopen_count`：episode 由 `session` 行体现。
- 不加 `review.diff_captured_at`：时间在快照 JSON 内。

### 6.4 迁移验证

- 每个 migration 在 fixture DB 上跑升级；验证回填后 `task.status` 行有 `task_id`，旧行不报错。
- 回填 SQL 只在 migration 里执行一次；应用启动不重复扫描。

## 7. daemon 实现

### 7.1 模块

- `apps/daemon/src/workspace/worktree.ts`：worktree 创建、清理、prune、路径 jail。
- `apps/daemon/src/verify/diff.ts`：diff 捕获与截断。
- `apps/daemon/src/runtime/task-actions.ts`：retry/reopen 的应用服务。
- `apps/daemon/src/http/history.ts`（或并入 `http/tasks.ts`）：history 与 diff 路由。
- `apps/daemon/src/db/repositories.ts`：`updateReviewDiff`、history 查询、`task_id` 写入。

### 7.2 diff 捕获

verify 命令结束后、应用 transition 之前：

1. 解析工作路径：`task.worktreePath ?? resolveWorkspaceDir(...)`。
2. `git -C <path> diff --no-color --no-ext-diff --unified=3 --find-renames HEAD` 取 tracked 改动（含 staged）。
3. 用 `git status --porcelain=v1 -z` 找 untracked；逐个 `git diff --no-index -- /dev/null <file>` 取 patch；binary 用 numstat 判定。
4. 按文件组装 `DiffFile`；单文件 patch 超 128KB 时截断该文件，所有 patch 合计超 512KB 时停止追加后续文件；两种情况都置 `truncated=true`。
5. transition 成功后调用 `updateReviewDiff(reviewId, snapshot)`；`verify_ok` 与 `verify_fail` 两条路径都写；transition 失败则丢弃。
6. 捕获或写库失败只记结构化日志（taskId、reviewId、原因），不阻塞 review 创建；该 review 的 `diffAvailable=false`。

非 git 工作区：返回空 snapshot 并置 `truncated=false`；UI 显示“该工作区没有 git 改动”。

### 7.3 worktree

**创建**

- 触发点：调度器在 `queued → running` 之前调用 `ensureWorktree(task)`；不在 core 转移内做 IO。
- 路径：`join(config.dataDir, 'worktrees', task.id)`；创建后 `realpath` 必须在 data dir 内。
- 分支：`baton/<taskId>`；不存在则 `git worktree add -b ...`，存在则 `git worktree add <path> <branch>`（retry/reopen 复用旧分支与改动）。
- 创建成功把 `worktreePath` 写入 task，再执行 `start` 转移；失败执行 `error` 转移，reason 为 `worktree_unavailable`，可 retry。
- 建任务时若 `workspaceMode=worktree` 但 workspace 不是 git 仓库，直接返回 `worktree_unavailable`，不落任务。

**使用**

- `session-runner` 的 `cwd`、verify 的 `workspacePath`、`readDiffStat`、diff 捕获全部使用 `task.worktreePath ?? workspacePath`。
- policy 仍从 workspace 根读取；worktree 只是执行目录。

**清理**

- `POST /api/tasks/:id/worktree/cleanup`：仅非活跃状态；`git worktree remove --force <path>`，保留分支；写 audit；清空 `task.worktreePath`。
- 不做 TTL、不自动清理；磁盘增长由 UI 徽标与 runbook 说明。
- boot：对每个 workspace 执行 `git worktree prune`；活跃任务的目录缺失 → `failed`（reason `worktree_missing`）；终态任务只标记缺失，不自动改状态。

**合并**

- 不自动 merge；分支保留。任务详情只展示分支名与“独立工作树”徽标，不展示绝对路径。
- 需要合入时由用户在仓库里自行 `git merge baton/<taskId>`。

### 7.4 retry / reopen

- `task.retry`：仅 `failed`；校验 note 长度；刷新 `task.policy_json` 为当前有效 policy；有 note 追加 `feedback`；应用 `retry` 转移；写 audit（`task.retry`，含 taskId/workspaceId/policyVersion）。
- `task.reopen`：仅 `done` / `cancelled`；同样刷新 policy；有 note 追加 `reopen_note`；应用 `reopen` 转移回到 `todo`；写 audit（`task.reopen`）。
- 两者都重置 `retryCount=0`；旧 session/review 不修改。
- 新 episode 在 `task.enqueue` / `task.start` 后由现有路径启动；worktree 模式复用已有工作树。
- 在途防护：同一任务 retry/reopen 并发请求，第二个返回 `invalid_transition` 或复用第一次结果；不重复建 session。

### 7.5 history

- 状态事件：`ws_event WHERE task_id = ? AND type = 'task.status' ORDER BY ordinal DESC LIMIT ?`；`beforeOrdinal` 翻页。
- sessions：`session WHERE task_id = ? ORDER BY startedAt DESC`。
- reviews：`review WHERE task_id = ? ORDER BY rowid DESC`。
- 返回三个数组；web 合并成时间线。daemon 不做复杂聚合，不做全文搜索。

### 7.6 审计与日志

- audit 动作：`task.retry`、`task.reopen`、`worktree.create`、`worktree.create_failed`、`worktree.cleanup`。
- 日志只写 taskId/workspaceId/branch/reason；不写 diff 正文、不写绝对路径。
- diff 捕获失败、worktree 创建失败用 `warn`，带原因码。

### 7.7 总管

- `packages/core/src/supervisor/policy.ts` 不改；工具仍为 `list_tasks` / `get_task` / `create_task`。
- 总管 `create_task` 仍固定 `workspaceMode: 'main'`；不暴露 retry/reopen/cleanup。

## 8. web

### 8.1 DiffViewer

- 入口：`ReviewCard` 增加“查看改动”按钮；只在 `review.diffAvailable` 时可用。
- 数据：`GET /api/reviews/:id/diff`，TanStack Query key `['reviewDiff', reviewId]`，`staleTime: Infinity`（快照不可变）。
- 展示：文件列表（状态、+/-、重命名 old→new、binary 标记）+ 折叠的统一 diff；行首 `+`/`-`/空格，颜色用 `DESIGN.md` 的 success/danger token；不加 Monaco、不加语法高亮依赖。
- 截断：顶部横幅“diff 过大，已截断”；仍展示文件统计。
- 空/旧 review：`diffAvailable=false` 或 `diff_unavailable` → 显示“该验收记录没有 diff 快照，仅保留统计”。
- 大文件：按文件折叠；单文件超过 2000 行时只渲染前 2000 行并提示。

### 8.2 任务历史

- 任务详情新增“历史”区（默认折叠，展开时拉 `GET /api/tasks/:id/history`）。
- 时间线合并三类事实：状态变化（含 previousStatus/retryCount/attention）、session（开始/结束/outcome）、review（verify 退出码/verdict/diffAvailable）。
- 不展示 transcript、prompt、文件正文；review 行可跳到 DiffViewer。
- 空历史显示“还没有记录”。

### 8.3 售后动作

- `TaskActions`：`failed` 显示“重试”；`done`/`cancelled` 显示“重新打开”。
- 确认弹窗带可选备注（textarea，≤16k）；提交走 WS `task.retry` / `task.reopen`。
- pending 时禁用按钮；错误 toast 显示错误码与 message；成功后失效任务/历史查询。
- 看板卡片不加入口，避免误触；只在任务详情操作。

### 8.4 worktree UI

- 建任务表单（桌面 `CreateTaskForm` 与移动 `MobileCreateTaskForm`）增加“使用独立工作树”开关，默认关；workspace 不是 git 仓库时禁用并提示。
- 任务详情显示“独立工作树 · `baton/<taskId>`”徽标；不显示绝对路径。
- 详情提供“清理工作树”动作，确认文案说明“分支会保留，改动不会丢失”；活跃任务隐藏/禁用。

### 8.5 移动端

- 任务详情复用同一历史区与 retry/reopen 动作。
- DiffViewer 在 `<768px` 用全屏 sheet，只读、按文件折叠；懒加载，不预取。
- 移动建任务表单包含 worktree 开关；移动不提供清理入口（放到桌面详情）。

### 8.6 实时与缓存

- 收到 `task.status` 后失效 `['task', taskId]`、`['taskHistory', taskId]`、任务列表。
- review diff 一旦成功缓存不失效；任务删除/切换时正常回收。
- WS 命令沿用 `useCommandAction` 的 ack/error 处理；重连后通过 resume 补齐状态。

### 8.7 无障碍

- diff 的增删不能只靠颜色：行首保留 `+`/`-`/空格，并提供 `aria-label`。
- 历史时间线用列表语义；截断横幅可读屏。
- 弹窗焦点捕获、Esc 关闭、键盘可达，遵循现有 HeroUI 组件。

## 9. 安全与隐私

- worktree 路径：`resolveWithin(dataDir, 'worktrees/<taskId>')` + 创建后 realpath 校验；阻断 `..`、绝对路径与软链逃逸。
- 分支名只由 taskId 生成，不接受用户输入；taskId 先做字符白名单校验。
- diff 正文不进 pino、不进 WS、不进 audit；REST 仍需 token cookie。
- 证据截图只用 fixture 数据；实际任务截图检查用户名、路径栏、密钥。
- 清理/创建用 `execa` 数组参数，不拼 shell；不执行模型生成的命令。
- 清理写 audit；不提供“删除分支”动作，避免不可逆丢失。
- 不自动 merge、不做 `git reset` / `git checkout` / `git clean` 等破坏性操作。

## 10. 测试与验收

### 10.1 单元

- core：retry/reopen 转移矩阵（合法/非法状态、retryCount=0、note effect、effects 末尾仍是 `emitTaskStatus`）。
- diff 捕获：修改/新增/删除/重命名/二进制/空工作区/截断/非 git。
- worktree 路径：jail、realpath、分支名、创建失败分类。
- history 合并：状态事件分页、session/review 排序。

### 10.2 daemon 集成

- `agent-fake` 任务在 worktree 内跑 verify；diff 快照写入 review；重启后仍可读。
- retry failed → 新 session、retryCount=0、旧 review 保留；reopen done → todo → enqueue 新 session。
- 同一 workspace 两个 worktree 任务并行，diff 与 verify 互不污染。
- cleanup 保留分支、清空 worktreePath；boot 对缺失目录的处理。
- 并发 retry/reopen 只产生一个 session。

### 10.3 web

- DiffViewer：加载/错误/截断/binary/rename/空 diff；键盘与读屏。
- 历史时间线：空、分页、review 跳转。
- retry/reopen：禁用态、备注、错误 toast、成功后刷新。
- worktree：开关、徽标、清理确认、非 git 禁用。
- 移动端：历史、只读 diff、动作可用。

### 10.4 Playwright

- worktree 任务从建到 review，打开 diff，通过验收。
- retry 一个 failed 任务；reopen 一个 done 任务。
- 历史时间线展示状态/session/review。
- 手机视窗打开 diff 与历史。

### 10.5 ego-lite + 真实 Claude

- 真实 Claude 在 worktree 内改文件 → verify → diff 可见 → 人工通过。
- daemon 重启后 diff 仍可读；清理 worktree 后 diff 仍可读。
- 同一 workspace 并行两个任务，两个分支/diff 互不污染。
- retry/reopen 跑通，历史保留。
- 证据落 `docs/evidence/2026-11-19-m3-1-delivery-acceptance/`，截图脱敏。

### 10.6 门禁

- 每片 `pnpm verify`；最终 `pnpm verify:full`、`pnpm pack:check`、`check:boundaries`、`check:protocol`、`format:check`。
- UI 改动附截图并对照 `DESIGN.md` 说明 token。
- migration 变更附升级验证说明。

## 11. 实施切片

### Slice 1：diff

- migration 0009（`ws_event.task_id`、`review.diff_json`）、protocol 类型、diff 捕获与持久化、懒加载 REST、DiffViewer。
- DoD：review 可查看 diff；六类文件状态与截断正确；重启后仍可读；单测/集成/web 测试通过。

### Slice 2：worktree

- worktree 管理器、`queued → running` 接线、verify/diff 使用工作树、清理 API、boot prune、建任务开关与详情徽标。
- DoD：并行两个任务同一 workspace 不冲突；verify/diff 在工作树内；清理保留分支；非 git 工作区明确拒绝。

### Slice 3：retry / reopen / history

- core 转移、daemon 服务与 audit、policy 刷新、history REST、任务详情时间线与动作。
- DoD：failed 可 retry、done/cancelled 可 reopen；新 episode 重置 retryCount；历史完整；并发幂等。

### Slice 4：验收与文档

- Playwright、ego-lite + 真实 Claude、证据 README、`docs/README.md` 索引、架构 spec §7 的 M3 表述同步、verify PATH 诊断与 runbook。
- DoD：全量门禁通过；证据可复核；文档无悬挂里程碑。

依赖：Slice 1 → 2 → 3 → 4。每片独立可回滚；不把重构与功能混在同一提交。

## 12. 风险与缓解

| 风险 | 影响 | 对策 |
|---|---|---|
| diff 过大导致内存/响应慢 | 验收卡卡顿 | 512KB/128KB 上限、按文件折叠、截断标记 |
| worktree 路径逃逸 | 越权读写 | jail + realpath + 分支名白名单 |
| worktree 磁盘增长 | 磁盘占用 | 手动清理、详情徽标、runbook 说明 |
| retry/reopen 重复 session | 并发浪费 | 状态校验 + 在途防护 + 单命令 ack |
| 旧 review 无 diff | 验收降级 | `diffAvailable=false` + 明确文案，不报错 |
| 回填 SQL 解析失败 | 历史缺失 | `task_id` 可空；失败行保持 null |
| 策略刷新导致行为变化 | 自动批准差异 | 只影响新 episode；audit 记录 policyVersion |
| 移动端 diff 性能 | 首屏变慢 | 懒加载 + 按文件折叠 + 测量后决定懒加载组件 |
| 清理与 verify 竞态 | 证据丢失 | 活跃状态拒绝清理；清理仅在非活跃状态 |
| diff 含密钥 | 泄漏 | 不进日志/WS；证据脱敏；REST 鉴权 |

## 13. 未来路线（不在本 spec）

- 总管只读 `get_task_detail`（verify/diff 摘要）；带人工确认卡的 enqueue/retry；observe/auto。
- 外部 Source：GitHub/飞书、actor 身份、admission、Thread/Subscription。
- DSH 插件壳与 headless spike。
- 画布 image/group/review 节点、`canvas.patch`。
- M1-7b：partial streaming、成本/turn UI、idle eviction/resume、session 级 allow。
- worktree TTL/自动清理、自动 merge / PR 创建。
- 同一任务多 session 并行。

## 14. 评审记录

- 2026-11-19：用户逐项确认下一迭代范围（M3-1 三件套）、diff 快照入库与懒加载、worktree 默认关/保留/手动清理、retry→queued / reopen→todo、历史复用 `ws_event.task_id`、总管不扩权、verify PATH 先诊断；设计通过。
- 待评审：本 spec 正文。评审通过后写 contract（DoD）与 4 个实施计划。
