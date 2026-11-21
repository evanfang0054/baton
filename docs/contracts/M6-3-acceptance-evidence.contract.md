# M6-3 验收证据与放权护栏：Definition of Done

> 回链 spec：`docs/specs/2026-11-21-m6-3-acceptance-evidence-design.md`。
> 前置：M6-2 上下文再注入已验收；合并到 `main` 后从最新 `main` 开实现分支。
> 分支：spec/contract 在 `docs/m6-3-spec`；实现用 `feat/m6-3-acceptance`。

## 0. 文档信息

- **状态**：spec 已获用户审阅通过（2026-11-21）；contract 待实现；尚未写代码。
- **范围**：`packages/protocol/**`、`packages/core/**`、`apps/daemon/**`、`apps/web/**`、migration 0012、测试与 `docs/**`。
- **预期不改**：任务状态列表与转移语义；`task.status` 单写者；`assembleContext` 预算/深度/敏感路径；`node`/`edge` 表结构；现有上传接口；总管工具数量（仍 17 个）。
- **GDD**：仓库没有 `docs/agent-harness/` 与 GDD 脚本，按 M1-M6-2 先例显式跳过；测试设计由本 contract 的 DoD 与 5 个 plan 的测试矩阵承担。

## 1. 用户可见结果

任务进入待验收后，画布的 review 卡不再只写“待验收”，而是列出这次交付的验收清单：哪几条过了、哪条没过、证据是什么、花了多少钱、预算还剩多少、验收员初步结论是什么。我可以在任务详情里改清单、waive 不适用的条目、调整预算，然后决定通过或打回；有失败项时通过要二次确认并写理由。预算到上限时任务会停下来问我“提额还是取消”，而不是悄悄失败或继续烧钱。总管可以回答“这单为什么没过、花了多少、还差什么”，但仍然不能替我验收、提额或改清单。

## 2. DoD

- [ ] **1. 数据模型与迁移**：migration 0012 创建 `acceptance_contract`、`acceptance_item`、`acceptance_run` 三表，并给 `task` 加 `budget_usd REAL NULL`；`acceptance_contract` 有 `unique(task_id, version)` 和 `index(task_id, status)`；`acceptance_item` 有 `unique(contract_id, ordinal)` 和 `index(contract_id)`；`acceptance_run` 有 `unique(review_id)`、`index(task_id, created_at)`、`index(contract_id)`。在 fixture DB 上从 0011 升级通过；旧任务 `budget_usd` 为 null，旧 review 无 run 时 UI 回退旧字段；不 backfill。
- [ ] **2. 进入 review 生成合同**：任务进入 `review` 时，daemon 在同一事务里取最近一份 `frozen` 合同克隆（无则建 v1，`version=1`），条目状态重置 `pending`、evidence 清空、`source=verifier`；创建 `acceptance_run(status=running, review_id=当前 review)`；验收员任务预算取 `BATON_VERIFIER_BUDGET_USD`（默认 `0.5`）。旧任务第一次 review 也能生成。
- [ ] **3. 验收员结构化输出**：验收员 prompt 包含目标摘要、verify 命令/exit/output 摘要（截断 2k）、diff stat/changed files、当前合同（如有）、只读约束；最后一条消息包含 `<acceptance_report>` JSON（verdict/summary/items）；`items` 0-8 条，`text`/`evidence` <=200 字，summary <=1000 字；只使用相对路径；不贴 transcript、diff 正文、token/env。
- [ ] **4. 解析与降级**：daemon 取最后一段 `<acceptance_report>`，缺失则尝试最后一个 ```json 代码块；zod 校验；超限截断并写 `truncated=true`；解析失败/验收员超时/验收员预算耗尽 → run `failed`、`verdict=incomplete`、summary 说明原因，不写验收员的半份输出，已克隆条目保持原样，目标任务仍 `review`；有 `VERDICT: PASS|FAIL` 但无 JSON 时保留初步结论、AC 为空。
- [ ] **5. 人工编辑与冲突**：`acceptance.update { taskId, contractId, expectedRevision, items[] }` 只在 `review` 且合同 `draft` 时允许；全量替换；0-8 条、`text` 1-200、`evidence` 0-200、总文本 <=2000；状态只允许 `pending/pass/fail/waived`；人工改动/新增 `source=human`；成功 `revision += 1`；`expectedRevision` 不匹配返回 409；超限返回 422 + 具体条目；非 review/非 draft 返回 `invalid_state`。
- [ ] **6. 冻结、决策与再 review**：approve 时所有非 waived 条目都是 pass 才正常通过；存在 fail/pending/无 AC 时必须带 `overrideReason`，二次确认，审计写 `acceptance_override`；reject 不受 AC 限制，feedback/上下文照旧；approve/reject 成功后合同 `frozen` 并写 `frozen_at`；review 期间 cancel 也冻结当前 draft；打回后下一次 review 克隆上一份 frozen 合同、`version += 1`、`revision=0`、状态重置；旧 run/合同保留。
- [ ] **7. 验收报告**：core `buildAcceptanceReport()` 从 contract/run/review/session 事实派生，包含目标与结果、改动 stat/changed files（<=20）、verify 命令/exit/output 摘要（<=2k）、AC 条目与计数、worker/verifier 成本与预算、风险与未验证、初步结论；**不含 diff 正文、transcript、第二遍 LLM 总结**；结果摘要取验收员 summary/既有 review summary，没有写“未生成”；报告中的路径以 workspace 根相对化，越界显示 `<external>`。
- [ ] **8. 报告 hash 与审计**：daemon 对报告规范 JSON（键排序、去掉 hash）计算 sha256；approve/reject 审计写 `{ contractId, version, revision, reportHash, counts, verdict, overrideReason? }`；报告不落库；同一事实重复读取 hash 稳定；`GET /api/tasks/:id/acceptance` 返回 `{ contract, items, run, report }`；任务列表/详情带 acceptance/budget 紧凑字段。
- [ ] **9. 任务预算**：`task.budget_usd` null 时继承 `claudeMaxBudgetUsd`（默认 `$2`）；`spent` = 该任务所有 worker session 的 `costUsd` 之和（跨 retry/reopen）；80% 只在 UI/报告警告；100% 且任务仍 `running` 时发 `budget_exceeded`、中断 session、转 `waiting_input(budget)`；start 前剩余 <=0 不启动；`StartInput.maxBudgetUsd = (task.budget_usd ?? global) - spent`，Claude adapter 优先使用；SDK 预算结束映射 `budget_exceeded`，不落普通 error；`completed` 已先到 `verifying` 时不再发 `budget_exceeded`；fake/pty 不报告成本、预算不生效、UI 显示“该引擎不报告成本”。
- [ ] **10. 提额与恢复**：`task.set_budget { taskId, budgetUsd }` 允许 `todo/queued/waiting_input/failed`，拒绝 `running/verifying/review/done/cancelled`；校验有限数、>0、<= `BATON_MAX_TASK_BUDGET_USD`（默认 50）；`waiting_input(budget)` 要求 `budgetUsd > spent`，否则 422 `budget_below_spent`；成功后执行 core `budget_raise` → `queued`、设置 `enqueuedAt`、审计 `{ oldBudget, newBudget, spent }`；新 run prompt 追加 `<budget_resume>`，不写回 `task.prompt`；不实现 SDK session resume；取消走 `task.cancel`。
- [ ] **11. 状态机增量**：`WaitingReason` 增加 `budget`；`attentionFor` 把 budget 映射为 `needs_approval`；`canAcceptUserInput('budget')=false`；新事件 `budget_exceeded`（running/queued → waiting_input(budget)，running 时 effects 含中断 session）与 `budget_raise`（waiting_input(budget) → queued）；`start` 上下文增加 `budgetRemainingUsd`，<=0 返回 `budget_exhausted`；retry/reopen 仍回 queued，由 start 守卫停在 waiting_input(budget)；不新增任务状态。
- [ ] **12. 自动批准上限**：`policy.autopilot.maxAutoApprovalsPerTask` 默认 10，0 = 关闭自动批准，仍需 `delegatedAuthority=true`；计数 `approval.decidedBy='auto'` join session→task，任务累计、retry/reopen 不重置；到顶不再自动批准，请求保持 pending、任务进入 `waiting_input(approval)`，审批卡显示“自动批准已达上限（10/10）”，审计写 `approval.cap_reached`；deny 优先、kill switch 优先、workspace trust 约束不变。
- [ ] **13. 总管只读证据**：`get_task` 增加 `acceptance`（total/pass/fail/pending/waived/verdict/topFailures<=3）、`usage`（worker/verifier cost、turns、budget/spent/remaining、over/near）、`report`（summary/risks/unverified，截断）；`list_tasks` 摘要带 `acceptance {pass,total,fail}` 与 `budget {spent,limit,over}`；`filter=attention` 纳入超预算与 AC 未过；总管 prompt 版本 +1，明确不得声称“已通过/已提额/已批准”、不得编造 AC、不得读 transcript/代码；反幻觉后检查覆盖这些断言；工具面仍 17 个，不新增工具。
- [ ] **14. 注入幂等**：`context.inject` 增加 `requestId?: string`；`ContextInjection` 保存 requestId；同一任务已有相同 requestId 时直接返回已有注入，不重复写 `context_json`、不重复发送、不重复审计；旧 injections 无 requestId 时按“无 id”读取；Web 每次打开投喂对话框生成 UUID，重试复用。
- [ ] **15. 画布、看板与移动端**：review 卡显示 `AC x/y`、pass/fail/pending、最多 1 条失败项、verify 状态、cost/budget、初步结论；`查看证据` 打开右侧任务详情并定位验收区块；卡片只读；无 AC/验收员失败显示“初步验收未完成”，不显示假的 0/0；现场条显示 `AC x/y · $spent/$budget`；看板任务卡显示 `AC x/y`、`超预算`、`接近预算` 的文字+图标；移动端 AC 摘要只读、approve/reject 复用现有卡片、不提供 AC 编辑；全部使用 `DESIGN.md` token。
- [ ] **16. 协议、事件与兼容**：新增 `AcceptanceItemStatus`、`AcceptanceVerdict`、`AcceptanceContractStatus`、`AcceptanceRunStatus`、`AcceptanceContract`、`AcceptanceItem`、`AcceptanceRun`、`AcceptanceReport`；`Task` 加 `budgetUsd`；`TaskSummary` 加 acceptance/budget；`review.decide` 加 `overrideReason`；`task.set_budget`、`acceptance.update`、`context.inject.requestId` 可解析；`acceptance.updated` 只带 taskId/contractId/version/revision/status/counts/verdict，不含条目正文；旧字段语义不变；旧数据可读。
- [ ] **17. 安全与隐私**：AC/报告只使用相对路径；不写 transcript、diff 正文、token、env、绝对路径、用户名到 AC/报告/事件/审计；`acceptance.updated` 不含正文；审计只存 counts/hash/version/revision；验收员 prompt 禁止贴秘密；截图按仓库脱敏规则处理。
- [ ] **18. 测试覆盖**：protocol 字段/命令/事件；core `acceptanceSummary`、`validateAcceptanceUpdate`、`cloneContract`、`buildAcceptanceReport`、`budgetState`、`canRaiseBudget`、`autoApprovalCapReached`、转移矩阵（budget_exceeded/budget_raise/start 耗尽）、注入幂等；daemon 解析成功/失败、contract/item/run 落库、409/422、冻结/再 review、预算 start/usage/提额/低于已花、retry/reopen 耗尽、fake/pty、自动批准第 10/11 次、kill switch、总管字段、requestId 只写一次、hash 稳定；web AC 编辑器/报告/预算/确认/徽标/移动端；Playwright 覆盖 AC pass/fail、提额新 run、批准上限、requestId 幂等、总管问答；ego-lite + 真实 Claude 跑通 AC 生成与低预算提额。
- [ ] **19. 命令、迁移与收口**：migration 0012 在 fixture DB 上从 0011 升级通过；`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；docs 索引包含 spec/contract/5 个 plan/evidence；证据落 `docs/evidence/<date>-m6-3-acceptance/`；不新增任务状态、不做 AC 模板/统计/DAG/外部 Source/现场动作。

### 2.1 验收证据（实现后填）

- 单元/集成：待填。
- Playwright：待填。
- 真实链路：待填。
- 已知限制：待填。

## 3. Boundary Conditions

- **Must support**：现有 text/file/image/agent/group/review 节点与 context 边；现有任务、旧 context_json、旧 review/session；fake 与真实 Claude；桌面/平板/手机；现有审批、提问、verify、diff、worktree、历史、retry/reopen/handoff/injection。
- **Must not break**：`task.status` 单写者与状态机；`assembleContext` 预算/深度/敏感路径；M6-1 现场只读与 review 卡；M6-2 注入语义与累计预算；总管不能 approve/reject/写 AC/提额；现有上传接口；旧数据库升级。
- **Performance**：看板 acceptance/budget summary 用批量查询，不做 N+1；报告按需派生，单次读取不遍历 transcript；AC 合同 0-8 条、报告分区截断，控制 DB/WS/UI 负载；review 卡只渲染摘要。
- **Security**：daemon 不新增外部请求；AC/报告只读写本地画布/任务事实；WS 事件只带 metadata；审计不含 AC 正文；敏感路径与凭据不进入 AC/报告/日志；截图脱敏。
- **Data**：只加三张新表 + 一个 nullable 列；报告不落库；预算花费/自动批准次数从既有事实派生；旧数据不回填；migration 增量可回退（drop 三表 + drop column）。

## 4. Acceptance Criteria

**Computational**

- `pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全部退出码 0。
- migration 0012 在 fixture DB 上从 0011 升级成功；旧任务 `budget_usd=null`；旧 review 无 run 时回退旧字段；旧 injections 无 requestId 可读。
- protocol/core/daemon/web 新增测试全部通过；core 覆盖率不低于现有基线。
- Playwright 覆盖：AC pass → 直接通过、AC fail → 二次确认、低预算 → waiting_input(budget) → 提额新 run、自动批准第 11 次回落人工、同 requestId 只写一次、总管问答不声称已通过。
- ego-lite + 真实 Claude：review 生成 AC、编辑后通过/打回；低预算真实任务停在 waiting_input(budget)，提额后新 run 到 review；截图 review 卡、AC 编辑器、报告、预算卡。

**Inferential**

- 人工 review：review 卡能否一眼回答“过没过、为什么、花了多少”；报告是否能解释“谁验的、验了什么、还有什么没验”；AC 编辑是否不会误改已冻结合同；预算提额是否不会重复烧钱或丢工作区状态。
- 证据可复核：截图按脱敏规则处理；临时 daemon/workspace 已停止并清理；不把本机绝对路径、transcript 或凭据提交进仓库。

## 5. 不在范围

- 自动验收/代验收；总管 approve/reject/写 AC/提额。
- AC 模板、跨任务统计、验收报表导出。
- DAG/任务依赖/优先级/任务模板。
- 外部 Source（GitHub/飞书）、运行中 `context.inject`、任务级独立画布。
- 现场通过/打回/重试/重开（M6-4）。
- 系统推送/短信；本轮只做站内。
- 图片 OCR、向量检索、SDK session resume、移动端 AC 编辑。
- 自动批准金额上限/全局日预算；本轮只做任务次数。

## 6. 实施顺序

1. **Plan 1 protocol + core + migration 0012**：三表 schema、budget 字段、waiting reason、commands、纯函数、转移矩阵、fake usage/verifier 脚本、单测。
2. **Plan 2 daemon acceptance**：仓储、验收员 prompt/解析、review 集成、报告装配、总管 `get_task`/`list_tasks`、集成测试。
3. **Plan 3 daemon guardrails**：预算执行/adapter 接线、提额、自动批准上限、注入幂等、审计、集成测试。
4. **Plan 4 web tasks**：AC 编辑器、报告、review 详情、预算编辑/警告、通过确认、看板/移动端徽标、组件测试。
5. **Plan 5 web canvas + acceptance**：review 卡摘要/查看证据、现场条、Playwright、ego-lite、证据、docs 索引、contract 收口。

依赖：Plan 2 依赖 Plan 1；Plan 3 依赖 Plan 2；Plan 4 依赖 Plan 2+3；Plan 5 依赖 Plan 4。

## 7. Negotiation Record

- **Generator（初稿）**：从 spec 抽出 15 条 DoD：迁移、合同生成、验收员输出、解析降级、人工编辑、冻结/再 review、报告、hash/审计、预算、提额、状态机、批准上限、总管、幂等、画布。
- **Evaluator（第 1 轮挑战）**：要求把“正常/支持”改成可执行断言；补负向路径：解析失败不写半份、409/422、预算低于已花、SDK 预算错误映射、completed 与 budget_exceeded 竞态、0 条 AC、旧数据回退、WS 不含正文、fake/pty 不强制、第 10/11 次批准、kill switch、requestId 只写一次。
- **Generator（修订）**：拆成 19 条 DoD，补 Boundary Conditions 与 Computational/Inferential 验收；明确报告派生/hash/路径相对化、预算只走任务剩余、提额新 run 不续 session。
- **Evaluator（第 2 轮挑战）**：要求 AC 0-8 与“无 AC 需 override”一致；要求 `acceptance.updated` 只带 metadata；要求再 review 克隆版本与 cancel 冻结；要求总管 prompt/输出快照而非工具 schema。修订后接受。
- **Final consensus**：19 条 DoD + Boundary Conditions + 验收标准；用户已审阅 spec 并确认；进入 writing-plans。
