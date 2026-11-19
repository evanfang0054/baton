# M2-2a 无人值守与汇报验收

- 日期：2026-11-19
- 分支：`feat/m2-autopilot`
- 环境：临时 `BATON_DATA_DIR` / `BATON_WORKSPACES_ROOT`；host-native Claude；ego-lite；模型名不记录
- 结果：3 个真实 Claude 任务批量开工 → 自动批准 1 次 → 自动重试 1 次 → 全部 `review`
- digest：`ready/blocked/dropped` 与看板一致；已读/历史/未读圆点验证通过
- 截图：`01-settings.png` / `02-batch-start.png` / `03-digest.png` / `04-review.png` / `05-kill-switch.png` / `06-untrusted.png`
- 残留风险：见文末

## 1. 真实 Claude 三任务

临时 workspace（`demo`）使用 `.baton/policy.json`：

- `verify.command = sh .baton/verify.sh`，脚本第一次失败、第二次成功，用于验证自动重试。
- `approval.allow` 含 `Read`、`Edit:src/**`、`Edit:**/src/**`、`Bash:pnpm test`。
- `autopilot.enabled = true`、`retryMax = 1`、`autoApproveMaxRisk = medium`。

三个任务分别要求把 `src/a.ts`、`src/b.ts`、`src/c.ts` 的常量改成 `*-DONE`。结果：

| 任务 | 引擎 | 结果 | 自动批准 | 自动重试 | 最近 verify |
|---|---|---|---|---|---|
| `更新 src/a.ts 文案` | claude-sdk | `review` | 1（Edit / medium） | 0 | 0 |
| `更新 src/b.ts 文案` | claude-sdk | `review` | 0 | 0 | 0 |
| `更新 src/c.ts 文案` | claude-sdk | `review` | 0 | 1 | 0 |

- 三个文件均落到 `ALPHA-DONE` / `BETA-DONE` / `GAMMA-DONE`。
- a 的自动化记录里可见 `自动批准 · Edit · medium` 与策略版本。
- c 第一次 verify 退出 1，按 `retryMax=1` 自动重试后进入 `review`。
- b/c 的初始审批是人工点的：它们的策略快照早于本轮阈值/allow 修正；a 的新会话才吃到自动批准。这也验证了“修改只影响新启动会话，运行中任务用启动时快照”。

## 2. digest

- 09:00 调度器自动生成一次，09:14 手动再生成一次。
- 手动 digest 快照：总数 3、待处理 0、待验收 3、进行中 0；`自动批准 1`；最久等待指向 `更新 src/b.ts 文案`。
- 点「知道了」后未读圆点消失；「历史」可见两条 digest 的已读/未读状态；刷新后状态保持。

## 3. kill switch

- 顶栏「暂停自动化」后，fake 任务 `杀开关审批检查`（`Bash:pnpm test`，medium）停在 `waiting_input`，无自动决策。
- 人工允许后执行一个恒失败的 verify（`exit 1`）：任务进入 `review`，`retryCount = 0`，说明暂停期间不会自动重试。
- 设置弹窗「恢复自动化」后，新 fake 任务 `恢复后自动批准` 的 Bash medium 审批被自动批准并进入 `review`。

## 4. 环境变量强制暂停

- 以 `BATON_KILL_SWITCH=1` 重启 daemon：摘要返回 `killSwitch=true`、`killSwitchForced=true`；顶栏显示「由环境变量强制暂停」，没有「恢复」入口。
- 重启前后 5 个任务的状态与 retry 数完全一致。
- 移除环境变量重启后恢复为 `false/false`。

## 5. 未信任 workspace

- 新建 `demo2`（不信任），写入 `autopilot.enabled=true` 的 `.baton/policy.json`，开 fake 任务 `未信任审批检查`。
- 审批停在 `waiting_input`，自动化记录为空；`PATCH /api/workspaces/:id/automation` 返回 `409 workspace_untrusted`。
- 信任后新任务 `信任后自动批准` 的 Bash medium 审批自动通过并进入 `review`。

## 6. 人工闸门与总管边界

- 对 `更新 src/a.ts 文案` 点「通过」→ `done`。
- 对 `更新 src/b.ts 文案` 点「打回」并附反馈 → 回到队列并再次执行至 `review`。
- 对总管说「帮我把『更新 src/c.ts 文案』这个任务开工」：总管识别出任务已是 `review`，明确拒绝开工，并引导到验收/打回；任务状态未变。

## 7. 本轮发现并修复的问题

真实 Claude 的 `Edit` 审批只带绝对 `file_path`、不带 `cwd`，core 无法判定工作区边界，把 `Edit` 判成 `high`，导致 `autopilot` 永远不能自动批准文件修改。已在适配器审批上下文中补 workspace `cwd`（不改变回传给 SDK 的入参），提交 `c86e5e6`。

同时确认：`Edit` 的工具风险是 `medium`，因此 `autoApproveMaxRisk=low` 不会自动批准任何文件修改；需要显式选择 `medium`。

## 8. 残留风险

- 历史任务快照仍按旧策略执行；升级阈值后需要新会话才能生效，这是设计行为但容易被误解。
- 真实 Claude 的只读工具没有产生审批请求，本次自动批准样本只有 `Edit` 和 fake 的 `Bash`；更多工具面仍需后续实测。
- verify fixture 的计数文件是 workspace 级共享，三个任务不是每个都触发“首次失败”；只有 c 完整覆盖了自动重试。
- 截图仅包含 baton UI 视口；已检查不含用户名、绝对路径、token 或其它窗口内容。
