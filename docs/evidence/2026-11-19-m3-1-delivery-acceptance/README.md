# M3-1 交付验收增强验收

- 日期：2026-11-19
- 分支：`feat/m3-1-diff`
- 环境：临时 `BATON_DATA_DIR` / `BATON_WORKSPACES_ROOT`；host-native Claude；ego-lite；模型名不记录
- 结果：真实 Claude 跑通 worktree/diff/重启/清理/通过；双任务并行隔离通过；retry/reopen/历史通过；桌面与移动端 UI 通过
- 截图：`01-review-worktree.png` / `02-diff-viewer.png` / `03-history.png` / `04-mobile-review.png` / `05-mobile-diff.png` / `06-mobile-done.png`
- 残留风险：见文末

## 1. 真实 Claude：worktree + diff + 重启 + 清理 + 通过

临时 workspace（`demo`）只含一个已提交的 `README.md`。通过 daemon API 创建 `claude-sdk` 任务：

- `workspaceMode = worktree`
- `dangerouslySkipPermissions = true`（daemon 显式开启 `BATON_ALLOW_BYPASS_PERMISSIONS=1`）
- `verifyCommand = grep -q BATON-OK README.md`
- prompt：把 `BATON-OK` 追加到 `README.md`，不改其他文件

断言与结果：

| 步骤 | 断言 | 结果 |
|---|---|---|
| 独立工作树 | 任务进入 `review`，`review.diffAvailable = true` | 通过 |
| 主工作区 | `git status --short` 为空 | 通过 |
| diff 内容 | `GET /api/reviews/:id/diff` 只含 `README.md`，patch 含 `+BATON-OK` | 通过 |
| 历史 | `GET /api/tasks/:id/history` 含 `review` 状态事件，review 行 `diffAvailable = true` | 通过 |
| 重启 | 重启 daemon 后同一 review 的 diff 快照完全一致 | 通过 |
| 清理 | 清理工作树后 `worktreePath = null`，分支 `baton/<taskId>` 仍存在，diff 快照不变 | 通过 |
| 验收 | 通过 review 后任务进入 `done` | 通过 |

## 2. 真实 Claude：双任务并行隔离

同一 workspace 并行启动两个 `claude-sdk` worktree 任务：

- 任务 A：创建 `alpha.txt`，verify `test -f alpha.txt`
- 任务 B：创建 `beta.txt`，verify `test -f beta.txt`
- daemon 并发上限设为 2

断言与结果：

- 两个任务都进入 `review`。
- 主工作区 `git status --short` 为空。
- 两个分支 `baton/<taskIdA>`、`baton/<taskIdB>` 都存在。
- A 的 diff 只有 `alpha.txt`，B 的 diff 只有 `beta.txt`，互不污染。
- 两个工作树清理后分支都保留。

同一隔离口径另有 daemon 集成测试覆盖（两个 fake 任务并行 + 真实 git），见 `apps/daemon/test/verify-runner.test.ts` 的 “isolates two worktree tasks”。

## 3. retry / reopen / 历史

用 `fake` 引擎在真实 daemon 上验证确定性售后流程：

1. 任务为 worktree 模式；在 `$BATON_DATA_DIR/worktrees/<taskId>` 放入阻塞文件，使 `git worktree add` 失败。
2. `task.enqueue` → 任务进入 `failed`，`retryCount = 0`。
3. 移除阻塞文件后 `task.retry`（带备注）→ 新 session → 审批 → verify → `review`。
4. 通过 review → `done`。
5. `task.reopen`（带备注）→ `todo`，`retryCount = 0`，`worktreePath` 不变。
6. 再次 `task.enqueue` → 新 session → 审批 → verify → `review`。

断言与结果：

- 历史返回 3 个 session、2 个 review，状态事件覆盖 `failed`、`queued`、`todo`、`review`。
- 重新打开后复用原工作树与分支。
- 清理工作树后分支保留，工作树目录删除。

## 4. UI（ego-lite）

- 桌面：任务详情显示“独立工作树 · `baton/f115cc06`”徽标、验收卡“查看改动”、展开历史时间线。
- DiffViewer：文件列表（`README.md` / 修改 / +1 -0）与统一 diff（`+BATON-OK`）。
- 移动端（390×844）：任务详情可查看历史与 diff；DiffViewer 为只读全屏 sheet；移动端不提供“清理工作树”入口。
- 通过验收后移动端 footer 显示“任务已结束，可以重新打开继续处理。”与“重新打开”。
- 截图隐私：`06-mobile-done.png` 为隐藏会话日志后的截图；所有截图已检查，不含用户名、宿主信息、token 或真实绝对路径。

## 5. 自动化回归

- `pnpm verify:full`：typecheck、lint、单元/集成测试、build、Playwright 全量通过。
- 新增 `verify-runner` 并行隔离测试：两个 worktree 任务在不同目录执行，主工作区干净，diff 只含各自文件。
- 既有 Playwright 用例覆盖 diff 入口、worktree 清理、retry/reopen/history、移动端 footer。

## 6. 残留风险

- 真实 Claude 的模型与 SDK 版本未记录；行为可能随宿主 Claude Code 升级变化。
- 并行隔离样本为两个任务，未覆盖更大并发与大量文件。
- worktree 清理只删工作树、保留分支；合并或删除分支仍需用户手动完成（设计如此）。
- diff 依赖 git；非 git 工作区返回空快照，`diffAvailable = false`。
- 会话日志可能包含工作区路径；本次截图通过隐藏日志区规避，产品侧仍按“日志不写入文档”约束使用。
