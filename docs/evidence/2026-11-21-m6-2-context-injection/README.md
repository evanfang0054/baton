# M6-2 上下文再注入验收

- 日期：2026-11-21
- 环境：临时 daemon（`127.0.0.1:7317`）+ Vite dev（`localhost:5173`）、临时 `BATON_DATA_DIR` / `BATON_WORKSPACES_ROOT`、宿主真实 Claude Code（`claude-sdk`）
- 场景：建任务 → 真实 Claude `baton_report(blocked)` 进入 `waiting_input` → 画布选中文本节点投喂 → 任务回 `running` → 自动完成到 `review` → 查看时间线与 cost/turn
- 截图：
  - `01-board.png`：任务看板（待验收任务与已取消的首次尝试）
  - `02-inject-dialog.png`：投喂对话框（目标任务、节点、说明）
  - `03-timeline.png`：任务详情上下文快照 + 注入 #1 + 累计 usage
  - `04-review-usage.png`：验收卡「本次 $0.21 · 2 turns」与跳过自动校验
  - `05-override-confirm.png`：跳过自动校验时点击「通过」的二次确认与可选理由
- 真实结果：
  - 注入后 `context.injections` 为 1，prompt 收到 `<context_update seq="1">`；
  - 任务从 `waiting_input` 恢复，Claude 回复后上报 `ready`，最终进入 `review`；
  - session `costUsd` / `turns` 落库并在详情/验收卡显示；
  - 首次尝试暴露了 resumed turn 的 `baton_report` 被 `reported` 标志静默丢弃、任务停在 `running` 的问题；修复为每次 `send` 重置上报状态，并补单测。第二次完整跑通。
- 脱敏：截图仅含虚构任务与节点内容；未包含本机绝对路径、用户名、token 或 transcript 正文。
- 已知限制：临时环境中的 verify 未配置，验收显示「未执行自动校验」；通过覆盖确认由 Playwright 与组件测试覆盖，本证据聚焦真实投喂链路。
