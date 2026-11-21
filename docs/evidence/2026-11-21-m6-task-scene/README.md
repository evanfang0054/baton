# M6-1 任务现场验收

- 日期：2026-11-21
- 环境：临时 daemon（`127.0.0.1:7317`）+ Vite dev（`localhost:5173`）、临时 data/workspace、真实 Claude Code（claude-sdk，复用本机登录态）
- 任务：`M6 任务现场验收`（nodeId/taskId 为运行时 UUID，未写入仓库）
- 场景：创建 Agent 节点 → 真实 Claude 任务 → 批准 `Write`/`Bash` → 任务进入 review → 进入任务现场 → 人工通过 → review 卡消失、任务 `done`
- 结果：通过；review verdict = `approved`，任务最终状态 `done`
- 截图：
  - `01-board.png`：任务完成后看板与 rail 计数（需要我 0 / 待验收 0 / 总任务 1）
  - `02-scene.png`：任务现场条、Agent 节点、review 卡（verify 1、2 文件 +5/-1、初步验收“进行中/未完成”、最终由你决定）
  - `04-after-decision.png`：人工通过后现场仍保留、review 卡消失、任务显示已完成
- 自动校验：`verifyExitCode = 1`。原因：临时环境里 Corepack 缓存的 `pnpm` 不可用；Claude 会话中改用 `/opt/homebrew/bin/pnpm` 手动跑通，但 daemon 的 `verifyCommand` 仍按 `pnpm test` 执行并失败。这是环境问题，不是任务逻辑失败；如实记录。
- 初步验收：`preliminaryVerdict = null`。本次临时 daemon 未配置总管模型，未派验收员，因此 review 卡显示“进行中/未完成”；人工通过/打回仍然可用。
- 脱敏：
  - 未截取 transcript / verify 输出中的本机绝对路径；
  - 截图只保留任务标题、状态、verify 退出码和 diff stat；
  - 临时工作区与 data 目录在验收后删除；不触碰本机 `~/.baton`。
- 清理：已停止临时 daemon/Vite，删除临时目录；ego-lite TaskSpace 已结束。
