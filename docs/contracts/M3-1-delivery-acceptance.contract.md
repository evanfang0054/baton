# Sprint Contract: M3-1 交付验收增强

> 关联 spec：`docs/specs/2026-11-19-m3-delivery-acceptance-design.md`
> 文档位置说明：本仓库 contract 落 `docs/contracts/`，不使用 `docs/agent-harness/contracts/`。

## Outcome（用户视角）

任务跑完后，我不需要切回终端：在验收卡里就能看到这次改了什么，逐文件确认后再决定通过或打回。需要并行时，我可以让任务在独立工作树里跑，互不污染；失败的任务能重试，做完的任务能重新打开继续修，历史记录都还在。daemon 重启或清理工作树之后，验收证据也不会丢。

## Definition of Done

- [ ] **1. 协议与迁移**：`TaskTransitionEvent` 增加 `retry` / `reopen`；新增 WS 命令 `task.retry` / `task.reopen`（`taskId` + 可选 `note` ≤16k）；新增 `DiffFile` / `DiffSnapshot` / `ReviewDiffResponse` / `TaskStatusHistoryItem` / `TaskHistoryResponse` 与 `ReviewView`；migration 0009 增加 `ws_event.task_id`（可空 + 从 `task.status` 回填 + `(task_id, ordinal)` 索引）与 `review.diff_json`。fixture DB 从 0008 升级到 0009 成功；`pnpm check:protocol` 通过。
- [ ] **2. diff 捕获**：verify 结束后捕获 tracked（含 staged）、untracked、删除、重命名、二进制；单文件 patch >128KB 截断该文件，所有 patch 合计 >512KB 停止追加后续文件，两种情况 `truncated=true`；`verify_ok` 与 `verify_fail` 都写快照；非 git 工作区返回空快照；捕获/写库失败不阻塞 review，`diffAvailable=false`。
- [ ] **3. diff 持久化与读取**：`GET /api/reviews/:id/diff` 返回快照；旧 review 返回 `diff_unavailable`；daemon 重启后同一 review 仍返回原快照；清理 worktree 后仍可读；接口需要现有 token cookie；diff 正文不出现在日志、WS 事件或 audit。
- [ ] **4. DiffViewer**：验收卡有“查看改动”入口且仅在 `diffAvailable=true` 时可用；文件列表显示状态、+/-、重命名 old→new、binary 标记；按文件折叠展示统一 diff，行首保留 `+`/`-`/空格；截断横幅可见；旧 review 显示“没有 diff 快照，仅保留统计”；单文件 >2000 行只渲染前 2000 行并提示；不引入 Monaco 或语法高亮依赖。
- [ ] **5. worktree 创建与执行**：`workspaceMode=worktree` 可在建任务时选择；调度器在 `queued → running` 前创建 `$BATON_DATA_DIR/worktrees/<taskId>` 与分支 `baton/<taskId>`；创建后 realpath 必须在 data dir 内；session `cwd`、verify、diffStat、diff 捕获全部使用 `task.worktreePath`；创建失败 → `failed`（reason `worktree_unavailable`），可 retry；非 git workspace 建任务直接返回 `worktree_unavailable`。
- [ ] **6. worktree 隔离验收**：同一 workspace 并行两个 worktree 任务，主工作树 `git status` 不出现两个任务的改动；两个任务分支不同；两个 review 的 diff 路径与内容互不污染；两个任务都能进入 `review`。
- [ ] **7. worktree 清理与 boot**：`POST /api/tasks/:id/worktree/cleanup` 仅允许非活跃状态；删除工作树、保留分支、清空 `worktreePath`、写 audit；`running`/`waiting_input`/`verifying` 返回 `task_active`；boot 对每个 workspace 执行 `git worktree prune`；活跃任务目录缺失 → `failed`；终态任务不自动改状态。
- [ ] **8. retry**：`failed` + `task.retry` → `queued`；`retryCount=0`；启动新 session；旧 session/review 全保留；note 追加 `<feedback>`；`task.policy_json` 刷新为当前有效 policy；写 audit；非法状态返回 `invalid_transition`；并发 retry 只产生一个 session。
- [ ] **9. reopen**：`done` / `cancelled` + `task.reopen` → `todo`；`retryCount=0`；不自动开工；note 追加 `<reopen_note>`；policy 刷新；写 audit；随后 `task.enqueue` 启动新 session；worktree 模式复用旧分支与工作树。
- [ ] **10. 任务历史 API**：`GET /api/tasks/:id/history` 返回 `statusEvents`（ordinal 倒序、默认 200、上限 500、`beforeOrdinal` 翻页）、`sessions`、`reviews`（含 `diffAvailable`）；status 事件含 status/previousStatus/retryCount/cause/attention；不返回 transcript、prompt 或文件正文；0009 之前的 `task.status` 行回填后可查。
- [ ] **11. 任务历史 UI**：任务详情新增“历史”区，默认折叠、展开时拉取；时间线展示状态变化、session 开始/结束/outcome、review 退出码/verdict/`diffAvailable`；review 行可跳到 DiffViewer；空历史有明确文案；移动端同样可用。
- [ ] **12. 售后 UI**：`failed` 显示“重试”，`done`/`cancelled` 显示“重新打开”；确认弹窗支持可选备注（≤16k）；pending 时禁用；错误 toast 显示错误码与 message；成功后失效任务/历史查询；看板卡片不加入口。
- [ ] **13. worktree UI**：桌面与移动建任务表单都有“使用独立工作树”开关，默认关，非 git workspace 禁用并提示；任务详情显示“独立工作树 · `baton/<taskId>`”徽标；桌面提供“清理工作树”动作与确认文案（分支保留）；UI 不展示绝对路径。
- [ ] **14. 移动端**：任务详情可用历史、retry/reopen；DiffViewer 在 `<768px` 为只读全屏 sheet、懒加载、按文件折叠；移动端不提供清理入口；不挂载画布。
- [ ] **15. 安全与隐私**：worktree 路径过 jail + realpath；分支名只由 taskId 白名单生成；清理/创建用 `execa` 数组参数；不自动 merge、不自动删除、不执行 `git reset`/`checkout`/`clean`；证据截图只用 fixture 或脱敏数据；日志只写 taskId/workspaceId/branch/reason。
- [ ] **16. 兼容与边界**：总管工具仍只有 `list_tasks`/`get_task`/`create_task`；总管 `create_task` 仍固定 `workspaceMode='main'`；旧 `task.worktreePath=null`、旧 `review.diff_json=null`、旧 `ws_event` 行不报错；M2-2a 的 effective autopilot、trust、kill switch 语义不变；`task.status` 仍只经 core 转移函数写入。
- [ ] **17. 真实链路**：ego-lite + 真实 Claude：worktree 内改文件 → verify → diff 可见 → 通过；daemon 重启后 diff 仍在；清理 worktree 后 diff 仍在；同一 workspace 并行两个任务互不污染；retry failed 与 reopen done 各跑通一次。证据存 `docs/evidence/2026-11-19-m3-1-delivery-acceptance/`，附 README 与脱敏截图。
- [ ] **18. 门禁与文档**：每片 `pnpm verify`；最终 `pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；CI 五项 checks 全绿；UI 截图对照 `DESIGN.md` 说明 token；migration 变更附升级说明；`docs/README.md` 索引更新；架构 spec §7 的 M3 表述与 ADR 0003 对齐；verify 失败诊断与 runbook 落地。

## Boundary Conditions

- **必须支持**：现有 M1/M2 命令与状态机；现有 token cookie 认证；host-native Claude；SQLite + Drizzle；单 daemon、单用户、本地优先。
- **不得破坏**：现有 Playwright e2e；M2-1 总管工具面与边界；M2-2a autopilot/trust/kill switch；M2-2b 移动端断点与桌面布局；`ws_event` 的 `sinceSeq` 重放语义；`task.status` 单一写入者与 audit。
- **不得引入**：自动 merge、自动清理 worktree、总管 retry/reopen/cleanup 工具、外部 Source、DSH、画布 image/group/review 节点、Monaco、第二套 UI 库、PWA/外部通知。
- **性能**：512KB diff 快照的 `GET /api/reviews/:id/diff` 本机 p95 < 500ms；DiffViewer 首屏只渲染首个文件；单文件 >2000 行截断渲染；diff 捕获让单次 verify 的额外耗时目标 < 2s（100 文件以内）。
- **安全**：worktree 路径与分支名不可由用户输入；diff 可能含密钥，禁止进入日志/WS/audit；截图与文档不含 token、真实路径、用户名或主机名；清理动作写 audit。

## Acceptance Criteria

- **Computational**：
  - `pnpm verify`（每片）、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 退出码 0。
  - migration 0009 在 fixture DB 上升级成功；回填后 `task.status` 行有 `task_id`，坏 JSON 行保持 `null` 且不报错。
  - core 转移矩阵、diff 捕获、worktree jail、history 合并均有单测；daemon 集成覆盖重启/清理/并行/并发 retry；web 单测覆盖 DiffViewer 各状态、历史、retry/reopen、worktree 开关。
  - Playwright 新增 diff、worktree、retry、reopen、history、移动端用例；现有 e2e 全量通过。
  - 真实链路证据 README 存在，截图脱敏。
- **Inferential**：
  - 代码审查：core 仍无 IO；diff 正文不进日志/WS；worktree 路径无逃逸；无自动 merge/删除；总管工具面未变。
  - UX 审查：diff 可读性、截断提示、旧 review 降级、历史空态、错误提示、移动端只读 diff。
  - 证据审查：`docs/evidence/2026-11-19-m3-1-delivery-acceptance/README.md` 记录真实 Claude 流程、重启/清理验证、并行任务、残留风险。

## Negotiation Record

- **Generator（初稿）**：18 条 DoD，覆盖协议迁移、diff、worktree、retry/reopen、历史、UI、移动端、安全、兼容、真实链路与门禁。
- **Evaluator（第 1 轮挑战）**：
  1. “diff 视图”必须写清六类文件状态、截断口径、旧 review 降级、禁止 Monaco，否则两个人会对“能看 diff”有不同理解。
  2. “worktree 隔离”不能只写“不冲突”，必须用主工作树 `git status` 干净、分支不同、diff 互不污染来判定。
  3. “retry/reopen”必须写清允许状态、`retryCount`、policy 刷新、备注块、旧历史保留、audit 与并发幂等。
  4. “任务历史”必须写清返回字段、排序、分页、排除 transcript/prompt/正文。
  5. “清理”必须写清活跃状态拒绝、保留分支、audit、boot 行为，否则容易误删。
  6. “真实链路”必须写清重启、清理、并行、retry/reopen 的步骤与证据位置。
  7. “兼容”必须覆盖旧行、总管工具面、M2-2a 语义，不能只写“不破坏现有功能”。
  8. “性能”必须给出可测阈值与降级手段。
- **Generator（修订）**：把上述挑战写进 1–18 条；补充 `worktree_unavailable`、`task_active`、`diff_unavailable`、`ReviewView`、`beforeOrdinal`、2000 行渲染上限、512KB/128KB 截断、fixture DB 升级与真实链路步骤。
- **Evaluator（第 2 轮）**：无进一步挑战；接受为最终 DoD。
