# ADR 0008：总管委派验收与委派审批

- **状态**：Proposed（未实施）
- **日期**：2026-11-20
- **关联**：`docs/specs/2026-11-20-m4-supervisor-secretary-design.md`、`docs/specs/2026-11-18-m2-supervisor-design.md`、`docs/specs/2026-11-19-m3-delivery-acceptance-design.md`

## 背景

M2 的 Router v0 只有“建待办”的权限，开工、审批、验收都归人。用户实测后明确提出：总管应该像秘书一样把事做完、自己验证、只把结果告诉老板；过多的人工闸门让“智能调度”退化成人工点按。

这与 M2 的安全边界冲突：M2 明确写了“结束只能由我来”，自动批准也要求命中白名单并受 kill switch 约束。直接把验收权交给模型会让任何任务都能被无声结束，风险不可接受。

## 选项

1. **保持现状**：总管只建待办，人开工、审批、验收。安全但用户明确不满意。
2. **无条件自治**：总管自动开工、自动批准所有工具、自动验收。体验最好，但一次模型误判就可能结束一个错误交付。
3. **分级自治 + 可选委派**：默认保持人闸门；workspace 显式开启委派后，总管才能对自己创建的 task 代验收/代审批；所有动作可审计、可停止、可 reopen。

## 决定

采用选项 3。

- 新增 workspace policy `autopilot.delegatedAcceptance`（默认 `false`）。
- 仅当 workspace trusted、kill switch 关闭、task 由总管创建、verify 退出码 0、diff 在阈值内、没有未决 approval/question 时，总管可以代验收。
- 代验收写入 audit；人仍可 reopen；reopen 后不再自动验收。
- 人类创建的 task 永远不代验收。
- 代审批复用现有 `evaluateApproval`：deny 永远优先；高风险操作只有在 policy allow 明确列出时才可能自动；不新增绕过 policy 的路径。
- 完成感知只投递“需要人”的汇总（review/failed/waiting_input），不逐条事件通知。

## 后果

- 好处：老板只处理异常和最终结果；总管对自己派发的任务闭环；所有自动动作有审计与 kill switch。
- 风险：模型可能在证据不足时误判“可以验收”；通过 verify + diff 阈值 + audit + reopen 降低影响。
- 代价：需要新增 policy 字段、迁移、UI 开关、runtime 观察钩子和集成测试；M2 的“结束只能由我来”改为“默认由人来，workspace 可显式委派”。

## 待确认

- `autopilot.delegatedAcceptance` 的默认值保持 `false` 是否可接受。
- 高风险 Bash 是否允许在委派模式下自动批准；本 ADR 建议不允许。
- 代验收的 diff 阈值（建议 ≤ 200 行 / 20 文件）是否合适。

## 实施计划（确认后）

1. protocol：`AutomationPolicy` 增加 `delegatedAcceptance`，drizzle migration。
2. core：新增纯函数 `canDelegateAcceptance(task, review, policy, workspace)` 与测试。
3. daemon：runtime 状态转移后调用 supervisor.observeTask；delegated 时调用 review 决策并写 audit。
4. web：自动化设置增加开关与说明；任务详情显示“总管代验收”审计。
5. 验收：集成测试覆盖 trusted/kill switch/verify 失败/人类任务/reopen；手工跑一个总管任务并确认无需点通过。
