# ADR 0008：总管委派验收与委派审批

- **状态**：Accepted（2026-11-20 用户确认高风险也自动批）；代验收部分仍待确认
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

采用选项 3，并按用户 2026-11-20 的选择先落地“总管全权”：

- 新增 workspace policy `autopilot.delegatedAuthority`（默认 `false`）。
- 只有当 workspace trusted、kill switch 关闭、policy `autopilot.enabled` 与 `delegatedAuthority` 都为 true、且 task 由总管创建时，`evaluateApproval` 才对**除 deny 规则外**的所有工具自动放行，包括高风险 Bash。
- 人类创建的 task 永远走人工审批；`AskUserQuestion` 与工作区逃逸仍降级为人工确认。
- 每次自动放行写 `approval.auto_allow` audit；kill switch 立即生效。
- 代验收（`autopilot.delegatedAcceptance`）仍未实施：本 ADR 当前只落地委派审批；验收仍归人。

## 后果

- 好处：总管创建的任务不再被高风险审批卡住，老板只需要看最终结果；所有自动动作有审计与 kill switch。
- 风险：总管创建的会话里，任意未被 deny 的 Bash（包括网络、删除、git 写操作之外的命令）都可能自动执行；一旦模型误判，影响面比“只自动批准低风险”大。
- 缓解：deny 规则仍然优先；workspace 必须 trusted；依赖 kill switch 可立即停止；人工任务不受影响。
- 代价：M2 的“高风险永不自动批准”被 workspace 级开关打破；需要持续观察审计与任务结果。

## 待确认

- 代验收（`autopilot.delegatedAcceptance`）是否开启；本 ADR 暂未实施。
- 代验收的 diff 阈值（建议 ≤ 200 行 / 20 文件）是否合适。

## 实施状态（2026-11-20）

- 已完成：`autopilot.delegatedAuthority`、policy patch/UI 开关、`evaluateApproval` 委派分支、session-runner 传入 `delegatedAuthority`、core 单测与 UI 单测。
- 未实施：`autopilot.delegatedAcceptance`（代验收）与完成感知投递。
