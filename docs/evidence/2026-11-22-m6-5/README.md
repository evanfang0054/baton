# M6-5 真实链路验收证据

- 日期：2026-11-22
- 环境：本机 daemon（`127.0.0.1:7317`）+ 真实 Claude（host-native）+ Vite（`localhost:5173`）
- 工作区：`<workspace>/m6-5-demo`（临时演示工作区，未使用真实项目名）
- 总管模型：`deepseek-flash`

## 结论

- 真实 Claude 工人完成了一个任务：工人回复 `OK`，diff 为 0，验证命令退出码 3，任务进入待验收；系统没有自动通过。
- digest 的「需要你决定」展示了真实任务的待验收项；人点击后才进入任务详情。
- 总管用 `plan_tasks` 生成了计划卡；计划只写 `proposed`，没有自动建任务。人通过 WS `supervisor.action.decide` 应用后创建了 1 个 todo 任务，origin 带 `templateId=bugfix` 与 3 条 acceptance seed；任务没有自动开工或自动验收。
- 任务失败摘要只展示 `stage=verify`、可重试、相对路径 `src/login.ts`；没有 transcript 或绝对路径。
- 修改 `.baton/policy.json` 后，旧授权被 revalidate 拒绝（`mandate_revoked` / `policy_changed`）；人点击「重新授权并继续」后可再次开工。
- kill switch 打开后显示「自动化已暂停」，digest 仍保留 proposed 建议；恢复后自动化重新运行。

## 截图

- `01-observe.png`：真实 digest 的「需要你决定」，含待验收任务与等待时长。
- `02-plan.png`：总管计划卡，显示模板「修复」、上下文摘要、验收建议与「应用全部/忽略」。
- `03-reauthorize.png`：`task mandate revoked` 后出现「重新授权并继续」。
- `04-failure.png`：任务详情的「最近失败」卡，只有 stage/summary/相对路径。
- `05-kill-switch.png`：kill switch 打开，自动化已暂停，digest 仍显示待决定项。

## 方法说明

- 真实 Claude 任务通过 WS `task.create` + `task.enqueue` 创建；工人成功回复，验证命令故意退出 3，用于产生 review/失败摘要。
- 为验证重新授权，使用总管创建的 worktree 任务；在开工前临时移走 `.git`，任务以 `not_a_git_repo` 失败；随后恢复 `.git` 并修改 policy，再在 UI 触发重新授权。该失败是受控的真实 daemon 失败，没有使用 fake 引擎冒充 Claude。
- 计划应用由人通过 WS `supervisor.action.decide` 触发；总管 `decide_action` 只能 ignore，不能 apply。
- 截图均已检查：不含用户名、主机名、绝对路径、token、头像或群名。

## 边界

- 验收最终仍由人决定；总管不能 approve/reject，也不能执行命令。
- 本次真实链路未覆盖外部 Source、DAG、自动验收/合并、模板编辑器、计划卡内联编辑与运行中 `context.inject`。
