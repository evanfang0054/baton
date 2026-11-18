# M1-6b 画布上下文真实链路验收

- **日期**：2026-11-18
- **代码**：`feat/m1-6b-context`，验收时 HEAD `61b9017`
- **环境**：host-native daemon（`npx` 构建产物）+ 本机 Claude Code 登录态 + ego-lite 浏览器
- **范围**：画布多选、连线、任务上下文、真实 Claude 执行、详情快照

## 步骤

1. 启动 daemon（`BATON_DATA_DIR` / `BATON_WORKSPACES_ROOT` 指向临时目录，工作区 `demo` 已 `git init`）。
2. 在 UI 创建并信任工作区 `demo`（项目 hooks 保持关闭）。
3. 添加文本节点 A：`ALPHA-42: 登录页必须支持暗黑模式`。
4. 添加文本节点 B：`BETA-17: 接口字段必须向后兼容`。
5. 从 A 的 source handle 拖到 B 的 target handle，创建 `context` 边。
6. 添加 Agent 节点；用 Meta+点击多选 A、B，再点击 Agent 打开面板，确认 chips 同时显示 A、B。
7. 任务说明填「列出上下文中的两个标记，并说明它们的关系」，创建任务；引擎选择 Claude Code。
8. 点「立即开工」，等待 Claude 执行到待验收。
9. 人工验收通过。

## 结果

- **上下文快照**：注入 2 个、排除 0 个、40 字符；关系 1 条：A → B。
- **Claude 输出**：同时识别出 `ALPHA-42` 与 `BETA-17`，并说明二者通过一条 `context` 有向边相连。摘录：
  - 「上下文中共有两个标记（节点），它们之间通过一条关系边相连」
  - 「存在一条有向边：**ALPHA-42 → BETA-17**，关系类型为 `context`」
- **任务状态**：`已完成`（人工验收通过）。
- **verify 说明**：本次任务配置的 verify 命令因宿主机 pnpm shim 路径不可用而退出 1；这是本机环境问题，不是产品逻辑失败。人工验收按真实 Claude 输出与快照内容通过。

## 截图

- `01-context-snapshot.png`：任务详情里的上下文快照（2 个注入 + 1 条关系）。
- `02-canvas-edge.png`：画布上的 A → B 连线。
- `03-transcript.png`：真实 Claude transcript 与完成态详情。

截图已检查：不包含凭据、token、真实身份或本机绝对路径。
