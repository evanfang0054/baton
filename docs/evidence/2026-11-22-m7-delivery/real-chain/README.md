# 真实 Claude 交付链路验收（2026-11-23）

用 ego-lite 浏览器驱动 UI，配合本机 Claude Agent SDK 跑完一条完整交付。

## 环境

- 临时 `BATON_DATA_DIR` 与 `BATON_WORKSPACES_ROOT`，隔离既有数据。
- `demo` 工作区已信任，提供 4 个阶段技能：`requirement-grooming` / `hi-fi-design` / `implement` / `acceptance`。
- 真实 Claude 执行，验收阶段用 Playwright + Chromium 做 375px 移动端实测。
- 验收阶段浏览器操作较多，本次用 `BATON_CLAUDE_MAX_TURNS=60` 完成。

## 结果

- 新建交付 → 需求 → 设计 → 开发 → 验收，4 个阶段全部由真实 Claude 执行。
- 每阶段产物落盘并自动登记为 artifact，人工审批后推进下一阶段。
- 最终 `delivery.status = done`，阶段进度 `4/4`，自动生成 `delivery-report.md`。
- 验收脚本 `run-acceptance.mjs` 对 spec 的 A1–A8 全部 PASS，证据截图与 `results.json` 归档在验收阶段目录。
- 交付列表在阶段完成后实时更新为“已交付 4/4”，无需刷新页面。

## 真实链路发现并修复

1. 默认策略拒绝写入 `.baton/**`，导致交付产物无法落盘。
   - 收窄 deny 到控制面（`policy.json` / `skills` / `playbooks`），允许 `Write/Edit .baton/deliveries/**`。
2. Agent 写出的文件从未登记为 artifact。
   - 任务完成时同步阶段产物；审批与推进前检查必产物，缺失则阻断。
3. 新建交付后任务看板缓存不刷新。
   - 创建交付后同时失效 tasks / canvas 查询。
4. Web 未消费 `delivery.updated` / `artifact.updated` / `annotation.updated`。
   - RealtimeProvider 按事件失效对应交付、产物、标注与画布查询。

## 证据

- `delivery-done.png`：交付列表显示“已交付 4/4”，四阶段均已完成。
- `delivery-canvas-zoomout.png`：交付画布阶段分组与产物计数。

截图中的工作区与交付均为虚构 demo 数据，不含身份、凭据或本机路径。
