# M8 交付工作台实跑与修复记录（2026-11-24）

以真实用户路径跑了一遍本地 daemon + web：新建工作区 → 信任 → 开自动驾驶 → 新建交付 → 需求/设计阶段 → 闸门卡 → 标注/画板 → 停止交付 → 总管汇报 → 移动端。

环境：

- 数据目录与工作区均为临时目录，不涉及真实项目数据。
- 引擎：本机 Claude Code（`claude-sdk`），总管：DeepSeek OpenAI-compatible。
- 浏览器：ego-lite；自动化回归：Playwright（系统 Chrome）。

## 已修复

| 优先级 | 问题 | 根因 | 修复 |
| --- | --- | --- | --- |
| P0 | 交付画布「新建画板」始终提示 `WebSocket 未连接`，画板无法打开 | `App` 在 `RealtimeProvider` 外层调用 `useCommand()`，拿到的是默认 `offlineCommand` | 拆出 `AppShell`，把 `RealtimeProvider` 提到最外层；新增 Playwright 用例覆盖「新建画板」 |
| P0 | 自动重试的 verify 第二次失败后任务永久停在 `verifying` | `ensureAcceptanceForReview` 只从 frozen 合同取版本号；失败重试留下 draft 后重复插入 `(task_id, version)` 撞唯一索引，事务回滚 | 版本号改为对最新合同（含 draft）单调递增；补 `acceptance-service` 测试 |
| P1 | 非 pnpm 项目 verify 失败，并在用户 `package.json` 写入 `packageManager: pnpm@...` | 包管理器检测只认 `packageManager` 字段，缺省 pnpm；corepack 自动 pin 会改仓库 | 新增 `detectPackageManager`：显式字段 → 锁文件 → 默认 npm；verify 子进程设置 `COREPACK_ENABLE_AUTO_PIN=0` |
| P1 | 阶段任务详情误报「任务创建于上下文快照上线前」 | `delivery` 创建阶段任务时没有写 `context_json` | 阶段任务持久化与手动任务相同的上下文快照；补测试 |
| P2 | 人工任务的验收员派发产生 `supervisor.notify_failed` 外键告警 | 人工任务没有总管 thread，验收员 origin 的合成 `threadId` 被直接用于写入 `supervisor_message` | `notify` 先校验 thread 存在；补服务测试 |
| P2 | 交付看板 sr-only 文案把已取消交付说成「最先等待」 | 直接取 `visible[0]` | 取第一个 `waitingSince != null` 的交付 |
| P2 | 阶段分组技能缺失只有一个「（缺失）」 | 无解释 | 增加 title：缺失/未信任/已加载的路径与影响 |
| P2 | Excalidraw 工具栏为英文 | 未设置语言 | `langCode="zh-CN"` |

## 仍在的缺口 / 建议

1. **移动端没有交付入口**：M7 spec 8.10 要求「交付列表/详情/审批」，移动端只有任务/总管/汇报。当前只能从任务列表间接处理阶段任务。
2. **全新工作区没有技能模板**：默认 playbook 的 4 个 skill 全部显示缺失；建议创建交付时提供「一键写入模板技能」或文档入口，否则新用户看到的全是黄色缺失。
3. **恢复自动化是两步**：头部「恢复」打开设置弹窗，需要在弹窗里再点「恢复自动化」。可考虑非强制暂停时直接恢复。
4. **真实 Agent 会打开用户 Chrome**：设计阶段通过工作区 `.mcp.json` 使用 Chrome MCP，在用户现有浏览器中新开窗口；信任工作区前应明确提示这一副作用。
5. **失败阶段缺少一键重试**：失败任务的重试在任务详情底部，需要滚动；阶段卡只显示失败原因与交接按钮。
6. **重建后需重启 daemon**：daemon 启动时以 `wildcard: false` 注册静态文件；运行中重新 build 会产生新的带 hash 资源，旧 daemon 只对新路径回退 index.html，页面空白。
7. **修复后仍可复现的旧数据**：本次工作区里的失败任务、草稿画板是修复前产生的；新代码只保证后续行为正确。

## 验证

- `pnpm verify`：exit 0（typecheck、lint、format、boundaries、protocol、全部单测、build、bundle check）。
- 新增/更新的单测：
  - `apps/daemon/test/verify-package-manager.test.ts`
  - `apps/daemon/test/acceptance-service.test.ts`
  - `apps/daemon/test/delivery-service.test.ts`
  - `apps/daemon/test/supervisor-service.test.ts`
  - `apps/web/src/features/deliveries/DeliveryBoard.test.tsx`
- 新增 Playwright：`apps/web/e2e/delivery.spec.ts` → `creates a drawing board from the delivery canvas`（App 命令上下文回归）。
- ego-lite 实跑：完整 4 阶段交付走通，终态 `done`、`4/4`、`attention=none`；`delivery-report.md` 与 `acceptance.md` 自动生成。
  - 需求：真实 Claude 产出 spec，验收 6/6，人工通过。
  - 设计：产出 `prototype.html` + `design.png`，验收 8/8，人工通过。
  - 开发：`gate=auto`，产出 19 条通过的单测，verify 用 `npm test`（不再触发 corepack），自动通过。
  - 验收：产出 `acceptance.md`，验收 8/8，人工通过。
  - 全程未出现 `supervisor.notify_failed`；总管没有 approve/reject 工具。
- 其他实跑：审批闸门卡允许、快速标注保存并被总管读取、画板保存 PNG/SVG/`.excalidraw`、停止交付级联取消、kill switch 暂停/恢复、总管汇报生成、移动端任务/总管/汇报壳。

