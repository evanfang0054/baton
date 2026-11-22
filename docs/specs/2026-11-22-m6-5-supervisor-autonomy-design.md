---
spec_topic: m6-5-supervisor-autonomy
decision_summary: "M6-5 总管自治与注意力：observe 档 + supervisor_action 账本 + Mandate revalidate + digest 注意力收敛 + 计划/模板/批量 dryRun；总管仍不 approve/reject、不读 transcript、不执行命令"
design_approved: true
user_approved_at: 2026-11-22T10:11:46+08:00
gates: [design-approved, user-review-passed]
spec_ref: 2026-11-18-m2-supervisor-design.md
domain_terms:
  [
    supervisor-autonomy,
    observe-mode,
    supervisor-action,
    plan,
    mandate,
    revalidate,
    attention-item,
    failure-summary,
    task-template,
    dry-run,
    human-only-apply,
  ]
---

# M6-5 总管自治与注意力设计

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：M2 Router v0、M2-2a 无人值守、M4 秘书化、M5-1 售后与批量、M5-3 交接、M6-1 任务现场、M6-2 上下文注入、M6-3 验收证据均已合并。
> 背景材料：`baton.ai` 三份讨论稿（`dsh-superagent-prototype-架构拆解.md`、`复刻CanvasAgents工作台.md`、`肝了一周…`），不进仓库，只作为产品方向参考。
> 相关 spec：`docs/specs/2026-11-18-m2-supervisor-design.md`（Router v0）、`docs/specs/2026-11-19-m2-autopilot-design.md`（无人值守）、`docs/specs/2026-11-20-m4-supervisor-secretary-design.md`（秘书化）、`docs/specs/2026-11-20-m5-supervisor-aftersales-design.md`（售后与批量）、`docs/specs/2026-11-21-m6-3-acceptance-evidence-design.md`（验收证据与放权护栏）。

## 0. 文档信息

- **状态**：设计已获用户逐项确认（2026-11-22）；spec 已获用户审阅通过（2026-11-22）；尚未实现。
- **范围**：`packages/protocol/**`、`packages/core/**`、`apps/daemon/**`、`apps/web/**`、数据库 migration 0013、测试与 `docs/**`。
- **预期不改**：任务状态列表与转移语义；`task.status` 单写者；AC 只能由验收员生成并由人编辑的语义；`assembleContext` 的预算/深度/敏感路径规则；`node`/`edge` 表结构；外部 Source 与 DAG。
- **不在范围**：外部 Source（GitHub/飞书）、跨任务 DAG/任务依赖、自动验收/自动合并、总管直接执行命令或改代码、外部推送、独立注意力页面、模板编辑器、计划卡内联编辑、运行中 `context.inject`、多用户。
- **文档位置**：spec 落 `docs/specs/`，contract 落 `docs/contracts/`，plan 落 `docs/plans/`；仓库没有 `docs/agent-harness/` 与 `scripts/validate-handoff.sh`，按既有约定执行。
- **ADR**：本迭代没有不可逆决定；新增表与 nullable 字段可回滚。总管自治边界由本 spec 锁定，后续变更走新 spec 或 ADR 并回链。

## 1. 背景

M2-M6 已把“单任务闭环 + 总管任务管理”做实：画布上下文、真实 Claude 执行、审批/提问、verify/diff、worktree、retry/reopen、任务历史、总管建节点/建任务/开工/售后/批量/预验收、上下文注入、AC 合同与验收报告。

但对照 `baton.ai` 材料，总管仍停在“显式 Router + 被动通知”：

- `SUPERVISOR_POLICY.mode` 只有 `explicit`；`observe/auto` 只在类型里，没有 would-do 账本。
- 任务 `origin_json` 有 `policyVersion`，但恢复/重开时没有按当前策略重新校验授权。
- 看板有 stale/attention 标记，digest 有快照；但总管不会主动把“今天需要你决定的事”收敛成可执行清单。
- 批量建单/售后是一步到位，没有“计划 → 预览 → 确认”的两阶段。
- 失败原因散落在 session/review 摘要里，总管无法稳定回答“上次为什么失败”。
- 模板、上下文摘要这些流程资产还不存在。

dsh 拆解里最值得借的三条是：**observe → auto 渐进授权**、**Mandate 不可变授权快照 + 恢复前 revalidate**、**面板只显示需要人的事**。M6-3 的后续路线也预留了 **M6-5 总管主动注意力**：每日计划、优先级、stale 补推、人的通道优先；先做 observe 模式。

本迭代只做这三条在 baton 当前架构下最自然的一步，不把总管变成 Worker，也不接外部 Source。

## 2. 目标与非目标

**目标**

1. 总管主动行为默认 `observe`：只写 `supervisor_action(proposed)`，不产生任务/状态副作用；人可应用或忽略。显式用户指令仍直接执行。
2. 新增 `supervisor_action` 账本，承载主动提议、计划与批量动作；proposed 24h 过期，记录按保留策略清理。
3. `TaskOrigin` 增加 `scope/strength/allowedActions/mandateVersion`；`retry/reopen/enqueue/apply_plan` 前按当前 policy revalidate，失败拒绝并说明。
4. 新增 human-only `task.reauthorize` 命令；总管不能调用；重新授权后写入新的 origin/mandateVersion。
5. digest 增加“需要你决定”分组；只列需要人的任务，计数=列表长度；安全建议可应用，approve/reject/取消运行中只给跳转。
6. 新增 `task_failure` 表与结构化失败摘要；总管只读摘要，不读 transcript。
7. 新增 `plan_tasks` + 计划卡：1-6 个候选任务、模板、目标 Agent、上下文、验收 seed 预览；计划必须由人确认后创建。
8. 新增 4 个内置模板（bugfix/feature/review/handoff）；验收 seed 只进验收员 prompt，不写进任务 prompt。
9. 新增 `batch_tasks` dryRun 与 `create_tasks.dryRun`；批量 cancel 排除 running。
10. 覆盖 core 单测、daemon 集成、web 组件、Playwright 与 ego-lite + 真实 Claude 验收。

**非目标**

- 外部 Source（GitHub/飞书）、Source/Trigger/Thread/Subscription/Admission 表。
- 跨任务 DAG、任务依赖、优先级、due date、labels、archive。
- 自动验收/自动合并；总管不能 approve/reject。
- 总管直接执行 shell、改代码、读 transcript/日志/文件正文。
- 外部推送（飞书/邮件/Webhook）、独立注意力页面。
- 模板编辑器、计划卡内联编辑、运行中 `context.inject`。
- 多用户、跨 workspace 自治、SDK session resume。

## 3. 关键决策

| #   | 决策              | 结论                                                                                                                                    | 理由                                                                 |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| D1  | 迭代范围          | M6-5a 治理底座 / M6-5b 注意力与分诊 / M6-5c 流程资产；DAG 单独 spec；外部 Source 全部后置                                             | 注意力/授权/流程资产是同一层问题；DAG 与外部 Source 是另外两层       |
| D2  | 明确不做          | 自动验收、自动合并、总管执行命令/改代码                                                                                                 | 与「结束只能由我来」「只调度不干活」冲突                             |
| D3  | observe 配置      | 全局 `off/observe/auto` + `autoRetry` / `attentionReminder` 两个能力开关；triage 仅显式，不设开关                                     | Q16 决定 triage 不后台扫画布；保留死开关只会误导                       |
| D4  | observe 生效      | 显式用户指令绕过 observe；总管主动推断必须过 gate；`off < observe < auto`，能力模式不能超过全局                                          | 用户明确要求“重试那个失败任务”不应被 observe 拦住                    |
| D5  | 默认值            | 全局 `observe`；`autoRetry=off`；`attentionReminder=observe`                                                                             | 重试会烧钱且可能循环；提醒无副作用，可先观察                         |
| D6  | 账本              | 新增 `supervisor_action`，只记主动提议/计划；proposed 7 天、终态 30 天；同任务同 kind 24h 去重                                          | 账本是“本来会做什么”的观察面，不是第二个 audit                       |
| D7  | Mandate 存储      | 扩展 `task.origin_json`：`scope/strength/allowedActions/mandateVersion`；不建独立表                                                       | 单用户、任务级授权；origin 已是不可变快照                            |
| D8  | revalidate        | `retry/reopen/enqueue/apply_plan` 前校验；失败拒绝并说明，不静默降级                                                                      | 规则变了却继续执行等于授权漂移                                       |
| D9  | 重新授权          | human-only `task.reauthorize`；总管无此工具                                                                                              | 恢复授权必须是代码级人闸门，不交给提示词                             |
| D10 | 注意力形态        | 复用 digest + 9/21 + 手动生成；增加“需要你决定”；不新增页面/推送                                                                         | 现有 notice/digest/未读已在；新页面会变成第二个看板                  |
| D11 | 注意力内容        | 只列审批/回复/验收/失败/预算/stale；一个任务一条；计数=列表长度；健康状态不占空间                                                       | dsh 面板七原则                                                       |
| D12 | 安全建议          | 重试/重开/生成计划可应用；approve/reject/取消运行中只给跳转                                                                                | 人的终审与运行中取消不能被 digest 绕过                               |
| D13 | 主动触发          | 9/21 digest 扫描 + failed/review 钩子；triage 仅显式；不后台扫画布                                                                        | 没有外部事件源时，后台扫画布既贵又制造噪音                           |
| D14 | 计划              | 复用 `supervisor_action(kind='triage_plan')`；24h 过期；apply 幂等；部分失败记 applied + result_json；零条创建记 failed                   | plan 本质是待应用的批量动作，复用同一状态机                          |
| D15 | 计划确认          | 计划卡在聊天消息流内；**模型只能 ignore，apply 只能由人在计划卡点击（WS）**                                                              | apply 是批量写操作，必须代码级人闸门，不依赖模型自觉                 |
| D16 | 计划编辑          | v1 不做内联编辑；改需求用聊天让总管重新生成计划                                                                                          | 避免在卡片里再造一套表单，也符合 Router 不改写需求                   |
| D17 | 模板              | 4 个内置模板；字段含标题模板、验收 seed、上下文规则、默认引擎/预算；无编辑器                                                            | 模板价值是稳定验收标准与上下文规则                                   |
| D18 | 验收 seed         | 只进验收员 prompt 作为建议清单；不写进任务 prompt                                                                                        | 避免 worker 按清单刷分，保持 M6-3 的 AC 作者语义                      |
| D19 | dryRun            | `create_tasks` + `plan_tasks` + 批量 enqueue/retry/cancel；单条显式动作保持现状；批量 cancel 排除 running                                  | 批量才需要预览，单条动作已有确认和审计                               |
| D20 | 失败摘要          | 新增 `task_failure`；daemon 生成；每任务保留 20 条；总管只读摘要                                                                          | 结构化事实可审计，且不破坏不读 transcript 的边界                     |
| D21 | 上下文摘要        | 同 Agent、交接链、同上下文节点、最近失败、标题关键词；最多 5 条；不读 transcript/文件正文                                                 | 让建单时有历史感，但不把总管变成检索器                               |
| D22 | 注意力任务范围    | 覆盖当前 workspace 全部任务；自动重试只对总管创建或被显式授权的任务生效                                                                   | 面板要对整个工作区诚实，自动写操作要有授权来源                       |
| D23 | kill switch       | 停 auto apply；observe 仍可写 proposed                                                                                                   | 暂停期间仍能积累“本来会做什么”，但不会产生副作用                     |
| D24 | 工具面            | 17 → 21：新增 `plan_tasks`、`decide_action`（只 ignore）、`get_task_failure`、`batch_tasks`；`create_tasks` 增加 `dryRun`                  | 计划/失败/批量需要明确工具；不做万能 manage 枚举                     |
| D25 | 数据保留          | `supervisor_action` 按 D6；`task_failure` 每任务 20 条；审计只追加                                                                        | 防止账本与失败表无限增长                                             |

## 4. 领域模型

### 4.1 SupervisorAction

总管主动想做的一件事，或一个待确认的计划。

```ts
type SupervisorActionKind =
  | 'triage_plan'
  | 'retry'
  | 'reopen'
  | 'attention_reminder'
  | 'batch_enqueue'
  | 'batch_retry'
  | 'batch_cancel'

type SupervisorActionStatus = 'proposed' | 'applied' | 'ignored' | 'failed' | 'expired'

interface SupervisorAction {
  id: string
  workspaceId: string
  threadId: string | null
  taskId: string | null
  kind: SupervisorActionKind
  status: SupervisorActionStatus
  strength: 'explicit' | 'inferred'
  mode: 'observe' | 'auto'
  reason: string
  payload: unknown // 脱敏；不存 transcript/文件正文/工具入参全文
  result: unknown | null // createdTaskIds / failed[]
  policyVersion: string
  mandateVersion: string | null
  dedupeKey: string
  createdAt: number
  updatedAt: number
  expiresAt: number
  appliedAt: number | null
  ignoredAt: number | null
}
```

状态机：`proposed → applied | ignored | failed | expired`；终态不可回退。

### 4.2 Plan

`kind='triage_plan'` 的 action；`payload.items` 是 1-6 个候选任务：

```ts
interface PlanItem {
  title: string
  templateId: 'bugfix' | 'feature' | 'review' | 'handoff' | null
  targetNodeId: string | null // null = 自动建/复用 Agent
  agentTitle: string | null
  contextNodeIds: string[]
  engine: Engine | null
  budgetUsd: number | null
}
```

- 不存任务 prompt 正文；apply 时按 `triggerId` 读回原用户消息/文本节点。
- 计划 24h 过期；apply 前校验 policyVersion、目标/上下文节点仍存在、任务状态允许。
- 部分失败：`status='applied'` + `result.createdTaskIds/failed[]`；零条创建才 `failed`。

### 4.3 Mandate

```ts
interface TaskMandate {
  scope: 'task'
  strength: 'explicit' | 'inferred'
  allowedActions: Array<
    'retry' | 'reopen' | 'cancel' | 'reply' | 'inject_context' | 'handoff' | 'update_canvas'
  >
  policyVersion: string
  promptVersion: string
  mandateVersion: string
  issuedAt: number
  source: SourceKind
}
```

- 存在 `task.origin_json`；旧任务缺字段按 `null` 兼容。
- `mandateVersion = shortHash({ scope, allowedActions, policyVersion })`。
- `validateMandate(task, requestedAction, currentPolicy, gate)`：
  1. current policy 仍允许 requestedAction；
  2. workspace trusted；
  3. kill switch 对 auto 动作关闭；
  4. `inferred` 动作要求当前能力为 auto；
  5. 否则返回 `{ ok:false, code:'mandate_revoked', reason }`。
- 失败不降级、不删除任务；human `task.reauthorize` 写入新 origin 后才可继续。

### 4.4 AttentionItem

```ts
type AttentionKind = 'approval' | 'reply' | 'review' | 'failed' | 'budget' | 'stale'

interface AttentionItem {
  taskId: string
  title: string
  kind: AttentionKind
  reason: string
  waitingSince: number | null
  proposalId: string | null
  action:
    | { type: 'open_task' }
    | { type: 'open_review' }
    | { type: 'apply_proposal'; proposalId: string }
}
```

- 一个任务一条；按最高优先级原因合并：审批 > 回复 > 验收 > 失败 > 预算 > stale。
- 排序：需要人的优先，其次 `waitingSince` 早，再按 `updatedAt` 新。
- 最多 20 条；计数必须等于列表长度。

### 4.5 FailureSummary

```ts
interface FailureSummary {
  stage: 'launch' | 'run' | 'verify' | 'review' | 'verifier' | 'budget' | 'unknown'
  lastError: string // 脱敏，<=2k
  retryable: boolean
  affectedPaths: string[] // 相对路径，<=20
  summary: string // 中文短摘要，<=2k
  createdAt: number
}
```

- 由 daemon 生成；输入只取 session outcome、verify 摘要、acceptance run 状态、adapter 错误分类。
- 不写 transcript、工具入参全文、绝对路径、token。

### 4.6 TaskTemplate

```ts
interface TaskTemplate {
  id: 'bugfix' | 'feature' | 'review' | 'handoff'
  label: string
  titlePattern: string // 使用 {goal} 占位
  acceptanceSeed: string[] // 3-5 条，<=200 字/条
  contextRules: {
    includeSameAgent: boolean
    includeHandoffChain: boolean
    includeRecentFailures: boolean
    maxContextNodes: number
  }
  defaultEngine: Engine | null
  defaultBudgetUsd: number | null
}
```

| 模板    | 标题模板      | 验收 seed 关注点            | 上下文规则                |
| ------- | ------------- | --------------------------- | ------------------------- |
| bugfix  | `修复：{goal}` | 复现步骤、失败现象、回归点  | 同 Agent + 最近失败       |
| feature | `实现：{goal}` | 功能点、边界、测试          | 同 Agent + 交接链         |
| review  | `审查：{goal}` | 改动范围、风险、验证方式    | 同上下文节点              |
| handoff | `交接：{goal}` | A 的结果可被 B 消费         | 交接链                    |

- seed 只进验收员 prompt，不写进任务 prompt。
- 模板由总管按意图选择；计划卡显示模板名；没有明确模板时不强行套用。

## 5. 数据模型与 migration 0013

### 5.1 `supervisor_action`

```sql
CREATE TABLE supervisor_action (
  id text PRIMARY KEY NOT NULL,
  workspace_id text NOT NULL REFERENCES workspace(id),
  thread_id text,
  task_id text,
  kind text NOT NULL,
  status text NOT NULL,
  strength text NOT NULL,
  mode text NOT NULL,
  reason text NOT NULL,
  payload_json text NOT NULL,
  result_json text,
  policy_version text NOT NULL,
  mandate_version text,
  dedupe_key text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  expires_at integer NOT NULL,
  applied_at integer,
  ignored_at integer
);
CREATE UNIQUE INDEX supervisor_action_dedupe_idx ON supervisor_action(dedupe_key);
CREATE INDEX supervisor_action_status_idx
  ON supervisor_action(workspace_id, status, created_at);
```

### 5.2 `task_failure`

```sql
CREATE TABLE task_failure (
  id text PRIMARY KEY NOT NULL,
  workspace_id text NOT NULL REFERENCES workspace(id),
  task_id text NOT NULL REFERENCES task(id),
  session_id text,
  attempt integer NOT NULL,
  stage text NOT NULL,
  last_error text NOT NULL,
  retryable integer NOT NULL,
  affected_paths_json text,
  summary text NOT NULL,
  created_at integer NOT NULL
);
CREATE INDEX task_failure_task_idx ON task_failure(task_id, created_at);
```

### 5.3 兼容与迁移

- `TaskOrigin` 新字段在 JSON 内；旧 origin 按 `null` 读取，不 backfill。
- `DigestReport.attention` 是 notice payload 增量；旧 notice 缺字段按空数组读取。
- `TaskDetail.lastFailure` 是 REST 增量；旧数据为 `null`。
- 回滚：drop 两张表；不涉及旧列改写。

## 6. core 纯函数

- `packages/core/src/supervisor/attention.ts`：`buildAttentionItems`。
- `packages/core/src/supervisor/mandate.ts`：`buildMandate`、`validateMandate`。
- `packages/core/src/supervisor/plan.ts`：`buildPlan`、`validatePlanApply`、`nextActionStatus`。
- `packages/core/src/supervisor/templates.ts`：4 个内置模板与 `matchTemplate(intent)`。
- 全部无 I/O；不 import `node:*` 或 `apps/*`。
- `attention` 与 `plan` 必须有固定事实快照测试；禁止把 transcript/diff 正文塞进输入。

## 7. daemon

### 7.1 Observe gate

```ts
type AutonomyMode = 'off' | 'observe' | 'auto'

function effectiveAutonomy(global: AutonomyMode, capability: AutonomyMode): AutonomyMode {
  const rank = { off: 0, observe: 1, auto: 2 }
  return rank[capability] <= rank[global] ? capability : global
}
```

- 显式用户指令：不经过 gate，直接走现有工具；写 audit。
- 主动推断：`off` 不写；`observe` 写 proposed；`auto` 执行并写 applied + audit。
- kill switch：`auto` 视为 `off`；`observe` 仍可写 proposed。
- `triage` 不设能力开关；`plan_tasks` 始终是显式工具，计划始终由人确认。

### 7.2 Action service

新增 `apps/daemon/src/supervisor/actions.ts`：

- `propose(input)`：校验 dedupe、写 `supervisor_action(proposed)`、写 audit `supervisor.action.propose`。
- `apply(actionId, actor)`：校验状态、过期、policyVersion、mandate、计划有效性；执行对应动作；写 applied/failed + audit。
- `ignore(actionId, actor)`：写 ignored + audit。
- `expire(now)`：把过期 proposed 置 expired；不改任务。
- `listProposed(workspaceId)`：给 digest/attention/plan card 查询。
- `apply` 对 plan 只接受 human actor；总管工具 `decide_action` 只能 `ignore`。

### 7.3 Revalidate

- `requireTask` 后、执行 **主动/自动** 的 `retry/reopen/enqueue/apply_plan` 前调用 `validateMandate`；显式用户指令是人的授权，直接执行并写 audit，不要求 origin。
- 对有 origin 的任务，显式动作仍校验 `allowedActions` 是否包含该动作；不含则返回 `mandate_revoked`，避免人误以为旧授权仍覆盖新动作。
- 失败返回 `mandate_revoked`，detail 含 `requestedAction / originPolicyVersion / currentPolicyVersion / reason`；任务状态不变。
- `task.reauthorize` human-only 命令：写入新 origin（`strength=explicit`、当前 `allowedActions/policyVersion/mandateVersion`），写 audit `supervisor.mandate.reauthorize`。
- 总管 prompt 明确：没有 reauthorize 工具；遇到 `mandate_revoked` 只能让用户去任务详情重新授权或新建任务。

### 7.4 Failure summary

- 在 `transition-runner` / `review` 失败路径写 `task_failure`：
  - worker failed：stage `launch/run/verify`；
  - 验收员失败：stage `verifier/review`；
  - 预算停：stage `budget`。
- `lastError` / `summary` 脱敏：相对路径、无 token、无 transcript；最多 2k。
- 每任务保留 20 条；插入后删更早记录。
- `get_task` 增加 `lastFailure`；新增 `get_task_failure` 工具返回最近 N 条。

### 7.5 Attention 与 digest

- `generateDigest` 调用 `buildAttentionItems`，写入 `DigestReport.attention`。
- **digest 的“需要你决定”分组始终反映当前需要人的任务**；`attentionReminder` 只控制“是否立即生成一条 digest notice”，不控制列表本身。
- `attentionReminder=auto`：任务跨过 stale 阈值或进入 attention 时，立即生成 digest notice；同任务 24h 一条。
- `attentionReminder=observe`：只在下一次定时/手动 digest 出现。
- `attentionReminder=off`：不主动生成 notice；下一次手动/定时 digest 仍可看到当前需要人的任务。
- 不改现有 digest 的窗口/变化计数逻辑；新增字段向后兼容。

### 7.6 工具面

新增：

```ts
plan_tasks({
  source: { text?: string; nodeIds?: string[] },
  template?: 'bugfix' | 'feature' | 'review' | 'handoff',
  targetNodeId?: string,
  contextNodeIds?: string[],
  maxItems?: number,
})

decide_action({
  actionId: string,
  decision: 'ignore', // apply 不在工具面
})

get_task_failure({ taskId: string, limit?: number }) // 默认 3，最多 20

batch_tasks({
  action: 'enqueue' | 'retry' | 'cancel',
  taskIds: string[], // 去重后 1..20
  dryRun?: boolean, // 默认 true
  confirm?: boolean, // 只有 confirm=true 才执行；否则按 dryRun 处理
})
```

- `create_tasks` 增加 `dryRun?: boolean`。
- 工具总数 21；`SUPERVISOR_POLICY.allowedTools`、prompt、engine 接线测试同步更新。
- prompt 增加：工具选择顺序、计划必须人确认、模型不能 apply、失败摘要只读、批量 cancel 排除 running。
- `model-surface` 快照断言 21 个工具全部接线；系统提示词体积不超过当前预算 +15%。
  - 若仓库尚无该测试，新增等价的工具接线快照：断言真实引擎请求体包含全部 21 个工具名，并设置 prompt 字符数上限。

### 7.7 建单上下文摘要

- `buildTaskContextDigest`（daemon 或 core）按以下来源取最多 5 条：
  1. 同 Agent 的历史任务（最近 3 条）；
  2. 交接链上下游；
  3. 同上下文节点/画布组；
  4. 最近失败摘要；
  5. 标题关键词相似（大小写不敏感，最多 2 条）。
- 只输出标题、状态、最近失败 stage/summary；不读 transcript、文件正文、diff 正文。
- 计划卡显示摘要条数和来源；用户可在聊天里要求去掉某条。

### 7.8 WS 命令

```ts
supervisor.action.decide {
  workspaceId: string
  actionId: string
  decision: 'apply' | 'ignore'
}
```

- host 注入 actor=human；客户端不能伪造。
- apply 只允许 `proposed`、未过期、policyVersion 未变；plan 还需目标/上下文仍有效。
- 幂等：已 applied 返回已有 `result`；已 ignored/expired 返回错误码。
- 成功后 invalidate digest/tasks/action 查询；写 audit `supervisor.action.apply|ignore`。

### 7.9 Runtime 接线

- `observeTask` 的 review/failed/waiting_input 通知保持不变；新增 failed 钩子写 retry proposal（按 `autoRetry` gate）。
- `automation/scheduler` 的 digest 生成前调用 action `expire(now)`。
- kill switch 读取现有 `automationState`；不新增开关。
- runtime close 时停止 action 过期任务与 digest job。

## 8. Web

- **DigestCard**：增加“需要你决定”分组；每条显示标题、原因、等待时长、动作；应用按钮走 WS，不经过模型；空态安静。
- **计划卡**：在 `SupervisorMessage` 内渲染 `plan_tasks` 结果；显示模板 chip、上下文数量、验收 seed 预览；按钮「应用全部」「忽略」走 WS；不做内联编辑；过期/失败显示原因。
- **任务详情**：新增“最近失败”卡，读 `lastFailure`；不展示 transcript。出现 `mandate_revoked` 时显示“重新授权并继续”，调用 human-only `task.reauthorize`，成功后由用户再触发 retry/reopen。
- **自动化设置**：新增“总管自治”区：
  - 全局 `off / observe / auto`；
  - `autoRetry`、`attentionReminder` 两个开关；
  - 说明「修改只影响新提议；已提议的 action 仍可应用/忽略；kill switch 下 auto 停止，observe 仍记录」。
- **移动端**：DigestCard 与计划卡自适应；不新增页面。
- **刷新**：WS `supervisor.action.decide` 成功后 invalidate `tasks/digest/actions`；计划卡用 `GET /api/supervisor/actions/:id` 或列表查询恢复状态。

## 9. 协议与 API

- `TaskOrigin` 增加 `scope/strength/allowedActions/mandateVersion`（增量字段，旧数据可空）。
- `TaskDetail` 增加 `lastFailure: FailureSummary | null`。
- `DigestReport` 增加 `attention: { items: AttentionItem[]; counts: Record<AttentionKind, number> }`。
- 新增 `SupervisorAction`、`PlanItem`、`FailureSummary`、`AttentionItem` schema；全部 `z.infer`。
- REST：
  - `GET /api/supervisor/actions?workspaceId=&status=proposed&limit=20`
  - `GET /api/supervisor/actions/:id`
- WS：
  - `supervisor.action.decide`（见 7.8）。
  - `task.reauthorize { taskId }`：human-only；写入新 origin/mandateVersion；返回 `{ taskId, mandateVersion }`；总管工具面不暴露。
- 不新增 `supervisor_action` 的 WS 广播；页面通过 digest notice/invalidate 刷新。

## 10. 安全与隐私

- 总管仍然不能 approve/reject、不能读 transcript/代码/日志、不能执行命令。
- 主动行为先落 `supervisor_action`；`observe` 无副作用；`auto` 才执行并写 audit。
- `task.reauthorize`、`supervisor.action.decide` 是 human-only；总管工具不能调用。
- 计划 apply 只允许人在计划卡点击；模型 `decide_action` 只能 ignore。
- 计划 apply 前校验：未过期、policyVersion 未变、目标/上下文仍存在、任务状态允许。
- 失败摘要只存脱敏事实：相对路径、最后错误、stage、retryable；不存 transcript、工具入参全文、绝对路径、token。
- digest 只列需要人的任务；计数=列表长度；不新增外部推送。
- kill switch：停 auto apply；observe 仍可记录 proposal。
- 所有 propose/apply/ignore/expire/revalidate 写 audit；审计不含正文。
- `supervisor_action.payload` 不存任务 prompt 正文；apply 时按 triggerId 读回原消息。

## 11. 错误码

| 错误码                     | 场景                                 |
| -------------------------- | ------------------------------------ |
| `action_not_found`         | actionId 不存在/不属于 workspace     |
| `action_expired`           | proposed 超过 24h                    |
| `action_already_decided`   | 已 applied/ignored/failed/expired    |
| `action_not_applicable`    | 计划目标/上下文失效、任务状态不允许  |
| `mandate_revoked`          | revalidate 失败                      |
| `reauthorize_required`     | 需要 human `task.reauthorize`        |
| `plan_invalid`             | 计划条目/模板/上下文非法             |
| `plan_expired`             | 计划过期                             |
| `batch_invalid`            | taskIds 重复/超限/含 running cancel  |
| `autonomy_disabled`        | 能力或全局模式为 off                 |
| `supervisor_action_forbidden` | 模型尝试 apply 或调用 human-only |

## 12. 测试与验收

### 12.1 core

- `buildAttentionItems`：优先级合并、排序、20 条截断、计数=长度、空态、无健康噪音。
- `validateMandate`：policy 变更、untrusted、kill switch、allowedActions 不含请求动作、旧 origin 兼容。
- `buildPlan`：1-6 条、模板字段、上下文去重、源节点排除、过期时间。
- `templates`：4 个模板字段完整、seed 长度、只进 verifier prompt。
- 状态机：proposed → applied/ignored/failed/expired；非法转移拒绝。

### 12.2 daemon（ScriptedSupervisorEngine + fake adapter）

- observe 下 `plan_tasks`/`batch_tasks` 只写 proposed，不建任务/不改状态。
- auto 下 batch retry 执行并写 applied + audit；kill switch 停止 auto。
- WS apply 幂等；重复点击不重复建单；过期/策略变更拒绝。
- revalidate 失败：任务保持原状态，返回原因；human `task.reauthorize` 后可继续。
- `task_failure`：失败/验收失败写一条；保留 20 条；不含 transcript/绝对路径。
- digest attention：与看板同口径、计数=列表长度、无健康噪音。
- 21 个工具全部接线；prompt 体积预算。

### 12.3 web

- DigestCard 的“需要你决定”分组、应用按钮、空态。
- 计划卡：应用/忽略、过期/失败原因、部分失败列表。
- 自动化设置：全局模式 + 两个能力开关 + kill switch 说明。
- 任务详情：最近失败卡。
- 移动端自适应。

### 12.4 Playwright（fake）

- observe → digest 出现 proposed → 人点应用 → 任务创建。
- 计划卡应用幂等。
- revalidate 拒绝 → 重新授权 → 继续。
- 失败摘要显示；无 transcript。
- kill switch 下 auto 不执行、observe 仍记录。

### 12.5 ego-lite + 真实 Claude

- 真实任务失败 → 摘要 → 总管建议重试 → observe 记录 → 人应用。
- 计划预览 → 人确认 → 任务创建 → 验收仍由人决定。
- 截图脱敏，证据落 `docs/evidence/`。

### 12.6 命令

`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿。

## 13. 实施切片

1. **protocol + core + migration 0013**：origin 字段、action/failure 类型、WS 命令、attention/mandate/plan/templates 纯函数、迁移与单测。
2. **daemon 治理**：observe gate、action service、revalidate、`task_failure` 写入、`plan_tasks`/`decide_action`/`get_task_failure`、prompt 更新。
3. **daemon 注意力与批量**：digest attention、attentionReminder、`batch_tasks`、kill switch 接线、集成测试。
4. **web**：DigestCard、计划卡、最近失败、设置、WS apply/ignore、组件测试。
5. **验收**：Playwright、ego-lite 真实链路、证据、docs 索引、contract 收口。

每片结束 `pnpm verify`；最后 `pnpm verify:full`、`pnpm pack:check`。

## 14. 风险与缓解

| 风险                         | 影响                     | 缓解                                                                 |
| ---------------------------- | ------------------------ | -------------------------------------------------------------------- |
| observe 产生噪音             | 用户不看 digest          | 只列需要人的事；24h 去重；20 条上限；健康状态不占空间                |
| revalidate 误伤              | 合法任务无法恢复         | human-only reauthorize；错误说明清楚；旧 origin 兼容                 |
| 计划过期/目标失效            | apply 失败               | 24h 过期；apply 前校验；失败给原因并重新 plan                        |
| 模型尝试 apply 计划          | 绕过人闸门               | 工具面不提供 apply；WS 校验 actor=human；审计                        |
| 失败摘要泄露                 | 本机路径/错误正文进入 UI | daemon 脱敏；相对路径；2k 截断；审计不含正文                         |
| 工具/提示词膨胀              | 模型选错工具/成本上升    | 21 工具快照；体积预算 +15%；prompt 增加选择顺序                      |
| 账本/失败表增长              | DB 膨胀                  | proposed 7 天/终态 30 天；task_failure 20 条/任务                    |
| digest 变成第二个看板        | 注意力分散               | 只列需要人的事；不显示健康统计；每条一个动作                         |
| batch cancel 误杀运行中      | 任务中断                 | 批量 cancel 排除 running；running 走单任务二次确认                   |

## 15. DoD

1. observe 下主动行为只写 proposed，无任务/状态副作用；auto 才执行并写 audit。
2. 计划 apply 只能由人点击；模型 `decide_action` 只能 ignore；apply 幂等、过期/策略变更拒绝。
3. revalidate 失败拒绝并说明；human `task.reauthorize` 可用；总管无此工具。
4. digest 只列需要人的任务，计数=列表长度；安全建议可应用，approve/reject/取消运行中只给跳转。
5. `task_failure` 由 daemon 生成，保留 20 条/任务；总管只读摘要；不含 transcript/绝对路径。
6. 4 个内置模板；验收 seed 只进 verifier prompt；计划卡显示模板但不可内联编辑。
7. `create_tasks.dryRun` 与 `batch_tasks` 覆盖批量 enqueue/retry/cancel；cancel 排除 running。
8. 21 个工具接线 + prompt 体积测试通过；外部 Source/DAG/自动验收/总管执行命令均未引入。
9. `pnpm verify:full`、`pack:check`、boundaries/protocol/format 全绿；证据脱敏。

## 16. 评审记录与后续

- 2026-11-22：完成五轮 brainstorming；确认范围（M6-5a/b/c、DAG 与外部 Source 后置、自动验收/执行排除）、observe 默认、Mandate 扩展 origin、`supervisor_action` 账本、digest 注意力、计划预览、失败摘要、模板、dryRun、human-only apply 与 `task.reauthorize`。
- 2026-11-22：设计分节确认；用户审阅 spec 通过，进入 sprint contract 与实施计划。
- 后续路线：M6-6 跨任务 DAG（单独 spec）、外部 Source（GitHub 先/飞书后）、模板编辑器、计划卡内联编辑、运行中上下文注入、SDK session resume。
