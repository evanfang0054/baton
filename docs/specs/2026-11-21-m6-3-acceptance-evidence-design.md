---
spec_topic: m6-3-acceptance-evidence
decision_summary: "M6-3 验收证据 v0：AC 合同/条目/运行三表、派生验收报告、任务预算与提额、自动批准上限；画布 review 卡承载证据摘要，人仍做最终验收"
design_approved: true
user_approved_at: "2026-11-21T15:43:53+08:00"
gates: [design-approved, user-review-passed]
status: approved
spec_ref: 2026-11-21-m6-2-context-injection-design.md
domain_terms:
  [
    acceptance-contract,
    acceptance-item,
    acceptance-run,
    acceptance-report,
    report-hash,
    task-budget,
    budget-exceeded,
    budget-raise,
    auto-approval-cap,
    delegated-authority,
  ]
---

# M6-3 验收证据 v0：AC 合同、验收报告与放权护栏

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：M6-2 上下文再注入（当前 `feat/m6-2-context-injection`，尚未合入 `main`）。
> 背景材料：`baton.ai` 三份讨论稿（`复刻CanvasAgents工作台.md`、`肝了一周，我把 Super Agent 的架构融入到了我的 AI Native 工作台中.md`、`dsh-superagent-prototype-架构拆解.md`），不进仓库，只作为产品方向参考。
> 相关 spec：`docs/specs/2026-11-21-m6-task-scene-design.md`（任务现场 v0）、`docs/specs/2026-11-21-m6-2-context-injection-design.md`（上下文再注入）、`docs/specs/2026-11-20-m4-supervisor-secretary-design.md`（预验收）、`docs/specs/2026-11-20-m5-supervisor-aftersales-design.md`（售后与批量）。

## 0. 文档信息

- **状态**：设计已获用户确认（2026-11-21）；spec 待用户审阅；尚未实现。
- **范围**：`packages/protocol/**`、`packages/core/**`、`apps/daemon/**`、`apps/web/**`、数据库 migration 0012、测试与 `docs/**`。
- **预期不改**：任务状态列表与转移语义；`task.status` 单写者；`assembleContext` 的预算/深度/敏感路径规则；`node`/`edge` 表结构；现有上传接口行为；总管工具数量（仍 17 个）。
- **不在范围**：自动验收/代验收；AC 模板与跨任务统计；DAG/任务依赖/优先级/任务模板；外部 Source（M5-2）；运行中 `context.inject`；现场通过/打回（M6-4）；任务级独立画布；系统推送/短信；图片 OCR；向量检索；SDK session resume；移动端 AC 编辑。
- **命名**：本迭代叫 M6-3；核心概念是 **验收合同（acceptance contract）**、**验收条目（acceptance item）**、**验收运行（acceptance run）**、**验收报告（acceptance report）**。
- **文档位置**：仓库没有 `docs/agent-harness/` 与 `scripts/validate-handoff.sh`，按既有约定落 `docs/specs/`、`docs/contracts/`、`docs/plans/`；验收用 `pnpm verify:full`，不伪造 agent-harness 结构。
- **ADR**：本迭代没有不可逆决定。全部为增量 schema 与 nullable 字段；migration 0012 可回滚。

## 1. 背景

M6-1 已把“任务现场”做成派生视图：从看板/任务详情进入现场，突出该任务的 Agent、上下文节点、origin、相关分组和 `review` 卡；画布补了 image/group/review 节点；总管能整理画布，看板有“需要我”、stale 和等待排序。M6-2 又补了上下文再注入、注入时间线、cost/turn 和“verify 失败仍通过”的二次确认。

但对照 `baton.ai` 材料，当前验收仍是“半张证据单”：

- 材料里的“验收清单”是画布上的卡片：`复刻CanvasAgents工作台.md:112` 写明总管维护验收清单，Worker 完成后在画布生成“验收卡片”，列出变更点，点“通过”才 Done；`416-419` 是 `canvas_generate_acceptance(截图, 测试报告) → 画布生成验收清单卡片 (AC-1, AC-2)`；`657` 把验收看板定义为“画布上的特殊节点类型”；`肝了一周…:67` 说“一个任务就是一块画布，开发报告、验收记录、验收标准都在画布上”。baton 当前只有派生的 `review` 卡，显示状态、verify、diff、等待时长和初步结论，没有 AC 清单与逐条证据。
- 材料里的“老板”只做验收：`复刻CanvasAgents工作台.md:161-163` 的“工程化验收体系”要求 Agent 交付时带着测试结果来见人；`肝了一周…:133` 明确“结束只能由我来”。baton 现在要人自己翻 verify、diff、日志，成本只有全局 `$2` 兜底，没有任务级预算，也没有自动批准上限。
- 材料里的面板原则是“只显示需要人的事、计数=列表长度、默认安静”（`dsh-superagent-prototype-架构拆解.md:423-443`）。baton 的看板已有 attention/stale，但验收卡没有把“为什么需要我”讲清楚。

M6-1/M6-2 已经把画布的“输入端”补齐；本迭代补“输出端”：让验收有定义、有证据、有预算、有刹车。总管仍然是显式 Router，不获得新的审批或验收权。

## 2. 目标与非目标

**目标**

1. 任务进入 `review` 时生成一份 **AC 合同**（0-8 条；0 条表示无法生成或人主动清空，approve 需 override），由验收员逐条给出 `pass/fail/pending` 与证据；人可编辑/waive/增删，决策时冻结。
2. 验收报告从合同、运行、review、session 事实**派生**，包含目标/结果、改动、校验、AC、成本、风险与未验证；审批审计存 `contract version/revision/reportHash`。
3. 画布 `review` 卡升级为“验收证据卡”：一屏摘要（AC 计数、失败项、verify、cost/budget、初步结论）+“查看证据”；详情页承载全文与编辑。
4. 任务级预算：`task.budgetUsd` 可空，默认继承全局；80% 警告，100% 停在 `waiting_input(budget)`；提额必须由人操作，且新预算大于已花。
5. 提额后新开一次 run，工作区状态延续；不实现 SDK session resume。
6. 自动批准按任务累计次数上限（默认 10）；到顶回落人工审批；每次自动批准和到顶事件写审计。
7. 总管只读扩展 `get_task`/`list_tasks`：能回答“为什么没过/花了多少/还差什么”，仍不能写 AC、提额、approve/reject。
8. `context.inject` 增加 `requestId` 幂等，闭环 M6-2 已知限制。
9. 覆盖 core 矩阵、daemon 集成、web 组件、Playwright 与 ego-lite + 真实 Claude 验收。
10. 不新增任务状态；只新增 `waitingReason='budget'`。

**非目标**

- 自动验收/代验收；总管不能替人结束任务。
- AC 模板、跨任务统计、验收报表导出。
- DAG/任务依赖/优先级/任务模板。
- 外部 Source（GitHub/飞书）、运行中 `context.inject`、任务级独立画布。
- 现场通过/打回/重试（M6-4）。
- 系统推送/短信；本轮只做站内。
- 图片 OCR、向量检索、SDK session resume、移动端 AC 编辑。

## 3. 关键决策

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | AC 模型 | 三张表：`acceptance_contract` / `acceptance_item` / `acceptance_run`；合同按任务版本化，运行按 review 唯一 | 用户选择完整领域模型；为后续模板/统计留结构，但本轮不做模板 |
| D2 | AC 作者 | 验收员在 review 时生成；本轮不支持预写；不进入 worker prompt | 降低老板写清单的负担；验收员独立于 worker；避免 worker 按 AC 刷分 |
| D3 | AC 编辑 | review 期间可编辑/waive/增删；`expectedRevision` 乐观并发；approve/reject 时冻结 | 人保留最终判断；审计可追溯 |
| D4 | AC 失败 | 有 fail/pending/缺失时仍可通过，但需二次确认 + 理由 + 审计 | 与 M6-2 的 verify fail override 一致；不把 AC 变成硬闸门 |
| D5 | 验收员输出 | 一次输出 `<acceptance_report>` JSON：verdict + summary + items；解析失败降级 | 一次运行同时产出清单与判定；避免两遍模型成本 |
| D6 | 验收报告 | 从事实派生；审批审计存 hash/version/revision；不落 `report_json` | 避免第二真相源；AC 改动后报告自动更新；审计仍能证明人看到了什么 |
| D7 | 报告呈现 | 画布 review 卡一屏摘要 + 查看证据；详情页全文；本轮卡上只读 | 符合材料“验收卡片”，又不让 React Flow 节点变重；现场动作留 M6-4 |
| D8 | 预算口径 | 任务累计（跨 retry/reopen）+ SDK 单 session 兜底；默认继承全局；per-task override | 防止 retry/reopen 绕过；单 session 上限只防 SDK 内部失控 |
| D9 | 预算硬停 | `waiting_input` + `waitingReason='budget'`；只有人能提额；提额后新 run | 预算是老板决策，不是技术失败；避免 failed 触发自动重试继续烧钱 |
| D10 | 验收员成本 | 单独统计、单独预算（默认 `$0.5`），不计入任务预算 | 验收是系统成本；不应吃掉 worker 预算 |
| D11 | 自动批准上限 | 按任务累计次数，默认 10；到顶回落人工；审计；kill switch 优先 | 次数最直观可审计；风险策略已有；金额与预算重叠 |
| D12 | 总管边界 | 只读扩 `get_task`/`list_tasks`；不新增工具；不能写 AC/提额/approve/reject | 保持“只调度不干活、不过闸门”；先让证据可信，再谈放权 |
| D13 | 注入幂等 | `context.inject` 增加 `requestId`；同任务同 id 只写一次 | 闭环 M6-2 已知限制；不建新表 |
| D14 | 范围切分 | M5-4 并入 M6-3；注入幂等顺手做；现场动作留 M6-4 | M5-4 只剩预算/次数上限，单独迭代不划算 |

## 4. 领域模型与数据表

### 4.1 `acceptance_contract`

一次 review 一份合同；同一任务按 `version` 递增。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | text PK | nanoid |
| `task_id` | text not null | FK `task.id` |
| `version` | integer not null | 从 1 递增 |
| `status` | text not null | `draft` / `frozen` |
| `created_by` | text not null | `verifier` / `human` |
| `revision` | integer not null default 0 | 每次人工编辑 +1 |
| `truncated` | integer bool not null default false | 验收员输出超限被截断 |
| `created_at` | integer not null | ms |
| `frozen_at` | integer nullable | 决策时间 |

索引/约束：`unique(task_id, version)`；`index(task_id, status)`。

### 4.2 `acceptance_item`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | text PK | nanoid |
| `contract_id` | text not null | FK `acceptance_contract.id` |
| `ordinal` | integer not null | 1..n |
| `text` | text not null | 1-200 字 |
| `status` | text not null | `pending` / `pass` / `fail` / `waived` |
| `evidence` | text nullable | 0-200 字；file:line / 命令 / 测试名 |
| `source` | text not null | `verifier` / `human` |
| `updated_at` | integer not null | ms |

索引/约束：`unique(contract_id, ordinal)`；`index(contract_id)`。

### 4.3 `acceptance_run`

一次 review 的验收运行；验收员失败也留一条。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | text PK | nanoid |
| `task_id` | text not null | FK `task.id` |
| `contract_id` | text not null | FK `acceptance_contract.id` |
| `review_id` | text not null | FK `review.id`；一个 review 一个 run |
| `verifier_task_id` | text nullable | 验收员任务 |
| `status` | text not null | `running` / `complete` / `failed` |
| `verdict` | text nullable | `pass` / `fail` / `incomplete` |
| `summary` | text nullable | 验收员 summary，<=1000 字 |
| `created_at` | integer not null | ms |
| `completed_at` | integer nullable | ms |

索引/约束：`unique(review_id)`；`index(task_id, created_at)`；`index(contract_id)`。

### 4.4 `task.budget_usd`

- `REAL NULL`；`null` = 继承 `claudeMaxBudgetUsd`（默认 `$2`）。
- 不 backfill；旧任务读取时按 null 处理。

### 4.5 兼容与迁移

- migration 0012：创建三张表 + `ALTER TABLE task ADD COLUMN budget_usd REAL`。
- 旧任务没有 contract：第一次进 review 时创建 v1。
- 旧 review 没有 run：UI 回退到 `review.preliminaryVerdict/preliminaryReason` + 现有 verify/diff 信息。
- `waitingReason` 是 text 列，新增 `budget` 不需要 DB 迁移；协议 enum 增量。
- 旧 `task.context_json.injections[]` 没有 `requestId`：按“无 id”读取，不影响。
- 回滚：drop 三张表 + drop column；无数据回填，安全。

## 5. AC 生命周期

### 5.1 进入 review

1. 任务通过 verify（或 verify 跳过）进入 `review`，daemon 在同一事务里：
   - 取该任务最近一份 `frozen` 合同；有则克隆文本，条目状态重置 `pending`、evidence 清空；无则创建 v1。
   - 新建 `acceptance_run(status=running, review_id=当前 review)`。
2. 派验收员任务（已有 `dispatchVerifier`），验收员预算默认 `$0.5`。
3. 验收员返回后写 items、run `complete`；合同保持 `draft`，等人确认。
4. 若验收员失败/超时/预算耗尽：run `failed`，`verdict=incomplete`；合同可能是空 draft；目标任务仍停在 `review`。

### 5.2 状态矩阵

| 任务状态 | 查看 AC | 编辑 AC | 通过/打回 | 说明 |
|---|---|---|---|---|
| `review` | 是 | 是（contract `draft`） | 是 | 唯一可编辑窗口 |
| `done` / `cancelled` | 是（历史） | 否 | 否 | 合同已冻结 |
| `failed` | 是（如有历史） | 否 | 否 | retry 后下一轮 review 重新生成 |
| `todo/queued/running/verifying/waiting_input` | 否 | 否 | 否 | 尚未进入 review |
| `waiting_input(budget)` | 否 | 否 | 否 | 预算决策，不是验收 |

### 5.3 人工编辑

命令：`acceptance.update { taskId, contractId, expectedRevision, items[] }`。

规则：
- 只在任务 `review` 且合同 `draft` 时允许。
- `items` 全量替换当前合同条目；新条目 `id` 可省略，服务端生成。
- 0-8 条；`text` 1-200 字；`evidence` 0-200 字；总文本 <= 2000 字。0 条只允许用于清空；approve 时按“没有 AC”处理。
- 状态只允许 `pending/pass/fail/waived`。
- 被人工改动/新增的条目 `source=human`；未改动的保留原 source。
- 成功时 `revision += 1`；`expectedRevision` 不匹配返回 `409 conflict`。
- 超限返回 `422 acceptance_invalid`，附具体条目索引。

### 5.4 决策与冻结

- approve：
  - 所有非 `waived` 条目都是 `pass` → 正常通过。
  - 存在 `fail` / `pending` / 没有 AC → 必须带 `overrideReason`，二次确认；审计写 `acceptance_override`。
- reject：
  - 不受 AC 限制；feedback 与 context 注入照旧（M6-2）。
- review 期间 `cancel`：冻结当前 `draft` 合同（不写 decision），避免下次 review 克隆到未冻结的旧草稿。
- approve/reject 成功后合同 `frozen`，`frozen_at` 写入；`acceptance_run` 绑定 review。
- 审计 `{ contractId, version, revision, reportHash, counts, verdict, overrideReason? }`。

### 5.5 再 review

- 打回后任务回 `queued`，下一轮进入 `review` 时新建合同版本：
  - 克隆上一份 frozen 合同的 `text`；
  - 条目状态重置 `pending`、evidence 清空、`source=verifier`；
  - `version += 1`，`revision=0`。
- 旧 run/合同保留，作为历史；不覆盖。

## 6. 验收员契约

### 6.1 输入

验收员任务 prompt 包含：
- 目标任务标题、目标摘要（`task.title` + 用户原始需求的短摘要）。
- `review` 的 verify 命令/exit/output 摘要（output 截断 2k）。
- `review.diffStatJson` 的改动文件/行数；不传 diff 正文。
- 当前合同条目（如果有），作为待复核清单。
- 工作区路径与只读约束。

### 6.2 输出

验收员最后一条消息必须包含：

```xml
<acceptance_report>
{
  "verdict": "pass|fail|incomplete",
  "summary": "<=1000 字",
  "items": [
    { "text": "<=200 字", "status": "pass|fail|pending", "evidence": "<=200 字" }
  ]
}
</acceptance_report>
```

规则：
- 0-8 条；text/evidence 必须是短句；evidence 用 `file:line`、命令或测试名，不贴大段代码。
- 只使用相对路径；不写绝对路径、用户名、token、env、transcript 正文。
- 独立复核：以代码、命令输出、diff 为准；不把 worker 自述当证据。
- 无法生成 AC（任务太模糊/没有可验证产物）→ `items: []`、`verdict: "incomplete"`，summary 说明原因。

### 6.3 解析与降级

- daemon 取最后一段 `<acceptance_report>...</acceptance_report>`；没有则尝试最后一个 ```json 代码块。
- zod 校验；超限截断：最多 8 条、text/evidence 200 字、总文本 2k；`truncated=true`。
- 解析失败 → run `failed`、`verdict=incomplete`、summary 写“验收员输出无法解析”；不写验收员的半份输出；已克隆的条目保持原样；目标任务仍 `review`。
- 验收员输出出现 `VERDICT: PASS|FAIL` 但无 JSON → 保留初步结论，AC 为空。

### 6.4 验收员预算与失败

- 验收员任务 `budgetUsd = BATON_VERIFIER_BUDGET_USD`（默认 `0.5`）。
- 超预算/超时/进程失败 → run `failed`；卡上标“初步验收未完成”；人可手填 AC 或直接决定。
- 验收员任务进入 `review` 时由系统自动关闭，不再递归派验收员（M4 已有）。

## 7. 验收报告

### 7.1 结构

`buildAcceptanceReport()` 是 core 纯函数，返回：

```ts
type AcceptanceReport = {
  taskId: string
  contractId: string
  contractVersion: number
  contractRevision: number
  goal: string
  result: string
  changes: { filesChanged: number; insertions: number; deletions: number; files: string[] }
  verify: { command: string | null; exitCode: number | null; outputSummary: string; skipped: boolean }
  acceptance: { items: AcceptanceItem[]; counts: AcceptanceCounts; verdict: AcceptanceVerdict }
  usage: {
    workerCostUsd: number
    verifierCostUsd: number
    turns: number
    budgetUsd: number
    spentUsd: number
    remainingUsd: number
    overBudget: boolean
    nearBudget: boolean
  }
  risks: string[]
  unverified: string[]
  preliminary: { verdict: AcceptanceVerdict | null; summary: string | null }
  hash?: string // core 返回不含；daemon 计算后附加
}
```

### 7.2 分区

1. **目标与结果**：`task.title` + 目标摘要；结果摘要优先取验收员 summary / 既有 review summary，没有就写“未生成”；不遍历 transcript。
2. **改动**：diff stat + changed files（最多 20 个）；不含 diff 正文。
3. **校验**：verify 命令、exit code、output 摘要（截断 2k）、是否跳过/未配置。
4. **AC**：逐条状态 + 证据 + 计数。
5. **成本**：worker cost/turn、验收员 cost/turn、预算/已花/剩余。
6. **风险与未验证**：verify 跳过、AC 未过/未完成、预算接近/超限、worktree、验收员失败。
7. **初步结论**：验收员 verdict + summary（<=1k）；没有就写“未生成”。

**不包含**：diff 正文、transcript、第二遍 LLM 总结。

### 7.3 派生与审计

- 报告不落库；每次读取按事实计算。
- `reportHash` = 报告规范 JSON（键排序、去掉 hash 字段）的 sha256，由 daemon 计算（core 不 import `node:crypto`）。
- approve/reject 审计写 `{ contractId, version, revision, reportHash, counts, verdict, overrideReason? }`。
- 报告中的路径必须相对化：以 workspace 根为基准；越界路径显示 `<external>`；不出现本机绝对路径。

### 7.4 呈现

**画布 review 卡（一屏摘要）**：

```
待验收 · AC 3/5
✔ 3   ✘ 1   ○ 1
✘ 深链参数未校验
verify: exit 1 (2 failed)
cost: $1.20 / $2.00
初步结论: FAIL · 2 个风险
[查看证据]
```

- `查看证据` 打开右侧任务详情并定位到验收区块；全部内容不塞进节点。
- 卡片只读；通过/打回仍在详情，M6-4 再上卡。
- 无 AC（验收员失败）显示“初步验收未完成”，不显示假的 0/0。

**任务详情**：完整报告 + AC 编辑器 + 预算编辑器 + approve/reject。
**看板**：任务卡显示 `AC 3/5`、`超预算`、`接近预算` 的文字+图标徽标；`needs_me` 已含 review。
**移动端**：AC 摘要只读；approve/reject 复用现有卡片；不提供 AC 编辑。
**总管**：只返回摘要字段（见 §10）。

## 8. 预算护栏

### 8.1 配置

| 配置 | 默认 | 说明 |
|---|---|---|
| `claudeMaxBudgetUsd` | `2` | 全局任务默认；`task.budgetUsd=null` 时继承 |
| `BATON_MAX_TASK_BUDGET_USD` | `50` | 单任务预算 sanity 上限 |
| `BATON_VERIFIER_BUDGET_USD` | `0.5` | 验收员任务默认预算 |

### 8.2 状态

| 状态 | 条件 | 行为 |
|---|---|---|
| 正常 | `spent / budget < 80%` | 正常跑 |
| 接近 | `80% <= spent / budget < 100%` | UI/报告警告，不阻断 |
| 超限 | `spent / budget >= 100%` | 停止 session → `waiting_input(budget)` |

- `spent` = 该任务所有 worker session 的 `costUsd` 之和（跨 retry/reopen）。
- 验收员 session 不计入；报告单独显示。

### 8.3 执行点

1. 每次 start 前算剩余；`remaining <= 0` 不启动，转 `waiting_input(budget)`。
2. 传给 ClaudeAdapter 的 `maxBudgetUsd = (task.budgetUsd ?? 全局默认) - spent`；全局值只是默认，不是硬上限；`BATON_MAX_TASK_BUDGET_USD` 是 sanity 上限。`StartInput` 增加可选 `maxBudgetUsd`，adapter 优先用它。
3. usage 事件更新 `session.costUsd/turns` 后复核；`spent >= budget` 且任务仍 `running` → 发 `budget_exceeded`，中断 session。
4. SDK 因预算结束 → 映射 `budget_exceeded`，不落普通 `error`。
5. 若 `completed` 已先把任务移到 `verifying`，不再发 `budget_exceeded`；预算状态留在报告里。

### 8.4 提额

- 命令：`task.set_budget { taskId, budgetUsd }`。
- 允许状态：`todo` / `queued` / `waiting_input` / `failed`；`running/verifying/review/done/cancelled` 拒绝。
- 校验：有限数、`> 0`、`<= BATON_MAX_TASK_BUDGET_USD`。
- `waiting_input(budget)`：
  - 要求 `budgetUsd > spent`；否则 `422 budget_below_spent`。
  - 写新预算，执行 core `budget_raise`：`waiting_input(budget) → queued`；设置 `enqueuedAt`；审计 `{ oldBudget, newBudget, spent }`。
- 其他允许状态：只改预算，不改变任务状态。
- 提额后新 run 的 prompt 追加：

```xml
<budget_resume previous_usd="1.98" budget_usd="3.00">
上一轮在预算上限处停止。预算已提高；请从当前工作区状态继续，不要重复已完成的工作。
</budget_resume>
```

  这段只用于本次 run，不写回 `task.prompt`。

### 8.5 状态机增量

- `WaitingReason` 增加 `budget`。
- `attentionFor`：`waitingReason === 'budget'` → `needs_approval`。
- `canAcceptUserInput('budget')` = false；只能用 `budget_raise` 恢复。
- 新事件：
  - `budget_exceeded`：`running | queued → waiting_input(budget)`；running 时 effects 含中断 session。
  - `budget_raise`：`waiting_input` 且 `waitingReason='budget'` → `queued`。
- `start` 上下文增加 `budgetRemainingUsd`；`<= 0` 返回 `budget_exhausted`，daemon 转 `budget_exceeded`。
- `retry`/`reopen` 仍回 `queued`；start 守卫负责预算耗尽时停在 `waiting_input(budget)`。

### 8.6 fake/pty

- `agent-fake` 增加可脚本化 `usage` 步骤，用于确定性预算测试。
- `pty` 不报告成本：预算不生效，UI 显示“该引擎不报告成本”；不阻塞任务。

## 9. 自动批准上限

- 配置：`policy.autopilot.maxAutoApprovalsPerTask`，默认 `10`；`0` = 关闭自动批准；仍需 `delegatedAuthority=true`。
- 计数：`approval.decidedBy='auto'` join `session` → `task`；任务累计，retry/reopen 不重置。
- 到顶：
  - 不再自动批准；请求保持 pending，任务进入 `waiting_input(approval)`。
  - 审批卡显示“自动批准已达上限（10/10）”。
  - 审计写 `approval.cap_reached { taskId, count, cap }`。
- deny 优先、kill switch 优先、workspace trust 约束不变。

## 10. 总管只读证据

### 10.1 `get_task` 增量

```ts
acceptance: {
  total: number; pass: number; fail: number; pending: number; waived: number
  verdict: 'pass' | 'fail' | 'incomplete'
  topFailures: Array<{ text: string; evidence: string | null }> // 最多 3 条
} | null
usage: {
  workerCostUsd: number; verifierCostUsd: number; turns: number
  budgetUsd: number; spentUsd: number; remainingUsd: number
  overBudget: boolean; nearBudget: boolean
}
report: { summary: string; risks: string[]; unverified: string[] } // 截断
```

### 10.2 `list_tasks` 增量

- 任务摘要带紧凑字段：`acceptance { pass, total, fail }`、`budget { spent, limit, over }`。
- `filter=attention` 纳入“超预算”和“AC 未过”；review 本来就在 needs_me 里。
- 不返回 AC 全文、diff、transcript。

### 10.3 prompt 与边界

- 总管用 `get_task` 的 acceptance/usage/report 回答“为什么没过/花了多少/还差什么”。
- 不得声称“已验收通过/已提额/已批准”；不得编造 AC；不得读 transcript/代码。
- 可以建议提额，但不能执行。
- 工具面仍 17 个；prompt 版本号 +1；`get_task` 输出快照测试更新。
- 反幻觉后检查增加“已通过/AC 全过/已提额/已批准”类断言，必须有对应工具事实。

## 11. 画布、看板与移动端

- **review 卡**：派生节点；数据来自任务 summary 的 acceptance/budget；一屏摘要 + `查看证据`；只读。
- **现场条**：显示 `AC 3/5 · $1.20/$2.00`；不新增写操作。
- **看板**：任务卡 `AC 3/5`、`超预算`、`接近预算`；文字+图标，不只靠颜色。
- **任务详情**：完整报告 + AC 编辑器 + 预算编辑器；approve 时 AC fail/pending/缺失触发二次确认 + 理由。
- **预算卡**：`waiting_input(budget)` 显示“提高预算 / 取消”卡，不显示回复框。
- **移动端**：AC 摘要只读；approve/reject 复用现有卡片；不提供 AC 编辑。
- **DESIGN token**：全部使用 `DESIGN.md` 的语义 token；新增徽标先改 addendum。

## 12. 协议、命令与事件

### 12.1 枚举与实体

- `WaitingReason` 增加 `budget`。
- 新增 `AcceptanceItemStatus`、`AcceptanceVerdict`、`AcceptanceContractStatus`、`AcceptanceRunStatus`。
- `Task` 增加 `budgetUsd: number | null`。
- `TaskSummary` 增加 `acceptance: TaskAcceptanceSummary | null`、`budget: TaskBudgetSummary`。
- 新增 `AcceptanceContract`、`AcceptanceItem`、`AcceptanceRun`、`AcceptanceReport` schema；全部 `z.infer`。

### 12.2 命令

| 命令 | 载荷 | 说明 |
|---|---|---|
| `acceptance.update` | `{ taskId, contractId, expectedRevision, items[] }` | 全量替换条目；review+draft 才允许 |
| `task.set_budget` | `{ taskId, budgetUsd }` | 设置预算；`waiting_input(budget)` 时提额并恢复 |
| `context.inject` | 增加 `requestId?: string` | 幂等；同任务同 id 只写一次 |
| `review.decide` | 增加 `overrideReason?: string` | AC fail/pending/缺失时 approve 必填 |

### 12.3 事件

- `acceptance.updated { taskId, contractId, version, revision, status, counts, verdict }`：验收员写入、人工更新、冻结后发；**不含条目正文**。
- `task.status` 的 `waitingReason` 可为 `budget`。
- 旧 `review.preliminary` 保留；新代码优先读 run，缺失回退旧列。

### 12.4 HTTP

- `GET /api/tasks/:id/acceptance` → `{ contract, items, run, report }`。
- `GET /api/tasks` / `GET /api/tasks/:id` → 任务摘要带 acceptance/budget 紧凑字段。
- 404/409/422 统一 `{ code, message, details? }`。

## 13. 错误处理

| 场景 | 行为 |
|---|---|
| 验收员 JSON 不合法 | run failed；AC 保持已有克隆条目（可能为空）；卡标“初步验收未完成”；人可手填或决定 |
| 验收员超时/预算耗尽 | run failed；目标任务仍 review |
| AC 编辑并发冲突 | 409 + 最新 revision；UI 重载 |
| AC 超条数/字数 | 422 + 具体条目；UI 禁用提交 |
| 验收中任务离开 review | 取消验收员；run failed；不写 AC |
| approve 时 AC fail/pending/缺失 | 422 `acceptance_override_reason_required`，除非带 `overrideReason` |
| 预算低于已花 | 422 `budget_below_spent` |
| 预算超过 sanity 上限 | 422 `budget_too_large` |
| 预算耗尽 | `waiting_input(budget)`；不落 failed |
| 自动批准到顶 | 回落人工审批；审计 `approval.cap_reached` |
| 注入重复 requestId | 返回已有注入；不重复写/发 |
| 旧数据无 contract/run | 回退旧字段；不报错 |

## 14. 安全与隐私

- 报告和 AC evidence 只使用相对路径；daemon 以 workspace 根相对化，越界显示 `<external>`。
- 不写 transcript、diff 正文、token、env、绝对路径、用户名到 AC/报告/事件/审计。
- WS `acceptance.updated` 只带计数与 id，不带条目正文；正文走 REST + 本地 DB。
- 审计只存 counts/hash/version/revision，不存 AC 正文。
- AC evidence 可能含代码标识符，但不含凭据；验收员 prompt 明确禁止贴秘密。
- 截图验收前检查路径栏、用户名、token。

## 15. 测试与验收

### 15.1 core 矩阵

- `acceptanceSummary`：pass/fail/pending/waived；全 pass → pass；任一 fail → fail；任一 pending 或空 → incomplete。
- `validateAcceptanceUpdate`：0-8 条、200 字/条、2k 总字数、revision、状态枚举。
- `cloneContract`：文本保留、状态 pending、evidence 清空、version+1、revision=0。
- `buildAcceptanceReport`：固定事实快照；不含 diff 正文/transcript；规范 JSON 稳定；hash 由 daemon 测试。
- `budgetState`：正常/接近/超限；跨 session 累计；null 继承全局。
- `canRaiseBudget`：状态、`> spent`、sanity 上限。
- `autoApprovalCapReached`：cap 0、count >= cap。
- 转移矩阵：`budget_exceeded` running/queued→waiting_input(budget)；`budget_raise` waiting_input(budget)→queued；非法状态拒绝；`start` 预算耗尽。
- 注入幂等：同 requestId 返回已有；不同 requestId 追加。

### 15.2 daemon 集成

- 验收员 JSON 解析成功/失败；contract/item/run 落库；run complete/failed。
- 人工更新、409、冻结、再 review 克隆。
- 预算：start 前剩余、usage 触发 `waiting_input(budget)`、提额→queued→新 run、低于已花拒绝、retry/reopen 耗尽时停、fake/pty 不强制。
- 自动批准：第 10 次自动、第 11 次回落人工；审计；kill switch。
- 总管 `get_task`/`list_tasks` 字段；无 transcript/diff；prompt 与 `get_task` 输出快照。
- `context.inject` requestId 只写一次。
- 报告 hash 稳定；审批审计含 version/revision/hash。

### 15.3 web 组件

- AC 编辑器：增删改/waive、超限、409 重载。
- 报告分区；review 卡摘要；预算编辑器/80% 警告；AC fail/pending/缺失的二次确认；看板/移动端徽标。

### 15.4 Playwright（fake）

- `agent-fake` 增加验收员脚本（输出固定 `<acceptance_report>`）和 `usage` 步骤（cost/turns），预算与 AC 链路不依赖 mock。

1. fake 任务 → review → 验收员 AC pass → 编辑/waive → 直接通过 → done；审计有 hash。
2. AC fail → 通过 → 二次确认 + 理由 → 审计。
3. 低预算 → `waiting_input(budget)` → 提额 → 新 run → review；断言 `<budget_resume>`。
4. 自动批准 11 次 → 前 10 自动、第 11 等人工。
5. 同 requestId 投喂两次 → 只写一次。
6. 总管问“这单怎么样” → 用 `get_task` 的 AC/usage 回答，不声称已通过。

### 15.5 ego-lite + 真实 Claude

- 真实任务 → review → 验收员生成 AC → 编辑 → 通过/打回；截图 review 卡、AC 编辑器、报告。
- 低预算真实任务 → `waiting_input(budget)` → 提额 → 新 run → review。
- 总管问答 AC/成本。
- 证据落 `docs/evidence/2026-11-21-m6-3-acceptance/`，按脱敏规则处理。

### 15.6 命令

`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿。

## 16. DoD

1. 0012 三表 + `task.budget_usd`；旧数据兼容；迁移为增量、无回填。
2. 验收员产出 AC + verdict；解析成功/失败路径；人可编辑/waive；决策时冻结。
3. 报告从事实派生；hash 稳定；审计含 version/revision/hash；不含 diff/transcript。
4. 预算默认继承、per-task override、80% 警告、100% `waiting_input(budget)`、提额 > 已花、新 run 带 `<budget_resume>`、fake/pty 不强制。
5. 自动批准按任务累计、默认 10、到顶回落人工、审计、kill switch 优先。
6. 总管 `get_task`/`list_tasks` 能回答 AC/成本/报告；仍不能写/验收/提额；prompt 与 `get_task` 输出快照更新。
7. 画布 review 卡一屏摘要 + 查看证据；详情全文；看板/移动端徽标；只读。
8. `context.inject` requestId 幂等。
9. 测试与证据全绿；`pnpm verify:full`、`pack:check`、boundaries/protocol/format 全绿。
10. 不新增任务状态；只新增 `waitingReason='budget'`；状态机单写者不变。

## 17. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 验收员 JSON 不稳定 | AC 缺失 | 最后标签/代码块 + zod；失败降级，不阻塞 review |
| AC 质量/幻觉 | 错误验收 | 独立验收员、证据必填、人可改/waive |
| 预算超调 | 烧钱 | 剩余预算传给 SDK + usage 事件复核 + `budget_exceeded` 映射 |
| 三张表扩大范围 | 一次跨层大 | 5 个 plan 隔离；每片独立 verify |
| 看板 N+1 查询 AC | 列表变慢 | 批量 summary 查询 + 索引 |
| 总管 prompt 增长 | 成本/漂移 | 摘要上限 + 快照断言 |
| AC 编辑并发 | 覆盖 | `expectedRevision` + 409 |
| 再 review 克隆旧文本 | 验收标准过期 | 验收员重新判定、状态重置、人可改 |
| 批准上限误伤 | 自动化中断 | UI 明示、配置可调、审计 |
| 真实预算停不稳定 | e2e 抖动 | fake 确定性覆盖 + 一条真实低预算 |

## 18. 实施切片

1. **Plan 1 protocol + core + migration 0012**：三表 schema、budget 字段、waiting reason、commands、纯函数、转移矩阵、fake usage/verifier 脚本、单测。
2. **Plan 2 daemon acceptance**：仓储、验收员 prompt/解析、review 集成、报告装配、总管 `get_task`/`list_tasks`、集成测试。
3. **Plan 3 daemon guardrails**：预算执行/adapter 接线、提额、自动批准上限、注入幂等、审计、集成测试。
4. **Plan 4 web tasks**：AC 编辑器、报告、review 详情、预算编辑/警告、通过确认、看板/移动端徽标、组件测试。
5. **Plan 5 web canvas + acceptance**：review 卡摘要/查看证据、现场条、Playwright、ego-lite、证据、docs 索引、contract 收口。

依赖：2 依赖 1；3 依赖 2；4 依赖 2+3；5 依赖 4。

## 19. 后续路线

- **M6-4 现场任务动作**：review 卡直接回复/通过/打回/重试；需要新 spec 回链 M6-1 D4。
- **M6-5 总管主动注意力**：每日计划、优先级、stale 补推、人的通道优先；先做 observe 模式。
- **M5-2 外部 Source**：GitHub/飞书入口与完成回写；在验收证据稳定后接。
- **AC 模板/统计**：合同模型已支持版本化；后续可加模板表与跨任务统计。
- **SDK session resume**：如果真实使用证明提额后新 run 不够，再评估续会话。
- **运行中注入**：如果真实使用证明需要，再评估流式输入的产品语义与安全边界。

## 20. 评审记录

- 2026-11-21：第一轮 8 个根决策：AC 作者=验收员、AC 不进 worker prompt、预算硬停=waiting_input(budget)、预算口径=任务累计+SDK 兜底、自动批准=按次数、报告=派生+审计 hash、总管=只读扩 get_task、范围=M5-4 并入+注入幂等+现场动作留 M6-4。
- 2026-11-21：第二轮 6 个决策：提额后新 run、AC 当前版本+review 快照、验收员一次结构化输出、批准上限任务累计、报告画布一屏摘要+展开、验收员成本单独。
- 2026-11-21：第三轮 2 个决策：画布 review 卡只读+打开详情、报告一屏摘要+展开详情。
- 2026-11-21：第四轮 3 个决策：AC 失败可通过需二次确认+理由、默认预算继承全局、不支持预写 AC。
- 2026-11-21：用户选择完整验收领域模型（B 方案）；四节设计（数据模型、AC/报告、预算/护栏、测试/切片）逐节通过。
