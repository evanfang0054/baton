# Sprint Contract: M6-5 总管自治与注意力

> 仓库没有 `docs/agent-harness/`，按既有约定落 `docs/contracts/`。
> 对应 spec：`docs/specs/2026-11-22-m6-5-supervisor-autonomy-design.md`。

## Outcome

当任务卡住、失败或需要验收时，用户每天只需要看一张“需要你决定”清单；总管会先把“本来会做什么”记下来，用户点一下就能应用或忽略。总管想批量建单时，先给一张可确认的计划卡，不会直接建；任务重开/重试前会按当前规则重新校验，规则变了就明确拒绝并让用户重新授权。用户仍然做最终验收，总管不替用户通过、不打回、不执行命令。

## Definition of Done

- [x] migration 0013 创建 `supervisor_action`、`task_failure` 及索引；空库与已有数据库升级测试通过；旧 `origin_json` / 旧 digest notice 按空字段兼容。
- [x] observe gate：全局 `observe` 时，主动 retry/attention 提议只写一条 `proposed`，任务状态与 session 不变；显式用户指令仍按现有路径执行。
- [x] 生效模式矩阵：`off < observe < auto`，能力模式不能超过全局；`autoRetry` 默认 off、`attentionReminder` 默认 observe；`triage` 没有主动开关。
- [x] `supervisor_action` 状态机：`proposed → applied | ignored | failed | expired`；非法转移拒绝；proposed 24h 过期；同任务同 kind 24h 去重；保留策略可测。
- [x] Mandate：`origin_json` 持久化 `scope/strength/allowedActions/mandateVersion`；`validateMandate` 覆盖 policy 变更、untrusted、kill switch、动作不在 allowedActions；失败不改变任务状态。
- [x] `task.reauthorize` 是 human-only WS 命令；写入新 origin/mandateVersion；总管工具面不存在该工具。
- [x] digest attention：只含 approval/reply/review/failed/budget/stale；一个任务一条；排序正确；最多 20 条；`counts` 等于 `items.length`；无事项时安静；旧 notice 可解析。
- [x] 注意力动作映射：`apply_proposal` 只用于安全建议；approve/reject/取消运行中只映射 `open_task`，没有一键决策。
- [x] `task_failure`：worker/verifier/budget 失败路径各写一条；字段脱敏、相对路径、单字段 ≤2k；每任务保留 20 条；`get_task_failure` 与 `get_task.lastFailure` 可读；快照不含 transcript/绝对路径。
- [x] `plan_tasks`：1-6 条；只写 `proposed`，不建任务；校验 source/context/target；返回模板/上下文/引擎/预算；计划卡可渲染。
- [x] 计划 apply：只有 human WS `supervisor.action.decide` 可 apply；模型 `decide_action(decision=apply)` 返回 `supervisor_action_forbidden`；重复 apply 幂等；过期/policy 变更/目标失效拒绝；部分失败写 `applied + result.failed[]`，零条创建写 `failed`。
- [x] 模板：4 个内置模板字段完整；验收 seed 只出现在 verifier prompt 快照，不出现在 task prompt；无模板编辑器。
- [x] dryRun：`create_tasks/plan_tasks` 与 `batch_tasks` 可用；`batch_tasks` 只有 `confirm=true` 执行；`taskIds` 去重后 1..20；cancel 排除 running 并返回 `requiresConfirmation`；部分失败逐条返回。
- [x] 建单上下文摘要：来源为同 Agent/交接链/同上下文节点/最近失败/标题关键词；最多 5 条；不含 transcript/文件正文；计划卡显示摘要条数。
- [x] WS `supervisor.action.decide`：actor 由 host 注入 human；非法/过期/已决策/策略变更返回明确错误码；成功写 audit 并 invalidate 查询。
- [x] Web：DigestCard 有“需要你决定”分组；计划卡有应用/忽略与过期/失败原因；任务详情有最近失败卡与“重新授权并继续”；自动化设置有全局模式 + 两个开关；移动端自适应；无独立注意力页面。
- [x] 工具面 17 → 21：真实引擎请求体包含全部 21 个工具；prompt 快照更新；prompt 字符数不超过当前预算 +15%。
- [x] 安全：kill switch 停 auto apply，observe 仍写 proposed；propose/apply/ignore/expire/revalidate 全部写 audit；审计/action/failure 不含 transcript、绝对路径、token。
- [x] 负空间：不新增外部 Source 表/工具、DAG 表/工具、自动验收/自动合并；总管仍不能 approve/reject、不能执行命令或改代码。
- [x] 测试：core 单测、daemon 集成（ScriptedSupervisorEngine + fake adapter）、web 组件、Playwright、ego-lite 真实链路；`pnpm verify` 与 `pnpm verify:full` 通过。
- [x] 工程检查：`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 通过；新增源码无 TODO/FIXME 占位。

## Boundary Conditions

- Must support：单 workspace；fake adapter 确定性测试；真实 Claude 以 host-native 运行，复用本机登录态。
- Must not break：现有任务状态机与转移语义；AC 只能由验收员生成、人可编辑；现有 17 个总管工具行为；旧 digest notice 与旧任务 origin；移动端现有任务/总管页面。
- Must not leak：transcript、diff 正文、文件正文、工具入参全文、绝对路径、token、用户身份信息。
- Performance：digest/attention 使用批量查询，不做 per-task N+1；prompt 体积预算 +15%；计划 apply 单批最多 6 条、批量动作最多 20 条。
- Compatibility：旧 `TaskOrigin` 缺字段按 null；旧 notice 缺 `attention` 按空数组；旧任务无 `task_failure` 按 null。

## Acceptance Criteria

### Computational

- `pnpm verify`：typecheck / lint / format / boundaries / protocol / 单测 / build 全绿。
- `pnpm verify:full`：Playwright 全绿。
- `pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿。
- 新增测试文件覆盖 DoD 中每个可计算项；migration 0013 有升级测试；prompt/工具快照断言 21 个工具与字符上限。
- `grep -RIn "TODO\|FIXME" packages/protocol/src packages/core/src apps/daemon/src apps/web/src` 输出为空（本次新增代码范围内）。

### Inferential

- 代码审查逐条对照 spec 的关键决策 D1-D25 与 DoD；发现偏离先改 spec 或实现，不静默漂移。
- ego-lite 真实验收：observe → digest → 人点应用；计划预览 → 人点应用；revalidate 拒绝 → 重新授权；失败摘要显示；截图脱敏并附证据。
- 至少两名评审者（或一次作者自审 + 一次 code review）确认“总管仍不能 approve/reject/执行命令”的边界未被绕过。

## Negotiation Record

- **Generator round 1**：提出 12 条 DoD，覆盖 observe、action、mandate、digest、failure、plan、templates、dryRun、工具面、测试。
- **Evaluator round 1**：指出 8 个缺口——`observe` 无副作用缺少 DB 级断言；`attention` 的“需要人”没有精确枚举；计划 apply 的人闸门没有可测试的拒绝路径；部分失败/过期/策略变更未写清；`task_failure` 脱敏没有验收口径；“不新增外部 Source/DAG/自动验收”没有负空间检查；prompt/工具接线没有体积与快照断言；旧数据兼容与移动端回归未覆盖。
- **Generator round 2**：把 DoD 扩到 20 条，加入迁移/旧数据、模式矩阵、状态机、human-only apply、部分失败、脱敏快照、负空间、prompt 预算、移动端与工程检查；明确 acceptable criteria 的计算/推断两类传感器。
- **Evaluator round 2**：接受修订版；没有新的阻塞挑战。保留的监督点是实现阶段每个切片结束时重跑 `pnpm verify`，最后一并跑 `pnpm verify:full` 与 `pnpm pack:check`。

## 实施结果（2026-11-22）

- 实现计划：`docs/plans/2026-11-22-m6-5-governance.md`、`.../attention-failure.md`、`.../plan-templates-batch.md`、`.../acceptance.md`
- 验证：`pnpm verify:full`（51 条 Playwright 全绿）、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check`
- 证据：`docs/evidence/2026-11-22-m6-5/README.md`
- 测试说明：仓库没有名为 `ScriptedSupervisorEngine` 的既有 harness；daemon 集成使用真实临时 DB + mock OpenAI-compatible 引擎 + fake/真实 Claude 各一条链路覆盖同等范围。
- 保留边界：总管仍不能 approve/reject、不能执行命令、不能读 transcript；计划 apply 只由人触发。
