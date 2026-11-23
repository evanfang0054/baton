# M7 交付工作台证据（2026-11-22）

## M8 追加（2026-11-24）

- 预算彻底移除：UI、SDK 上限、budget 等待/提额、成本展示全部删除；migration 0016 删除 `task.budget_usd`，内部 cost/turn 仍采集。
- 工作区授权：已信任 + 自动驾驶开启 + kill switch 关闭时，所有非 deny 工具自动批准；deny 永远优先；审计含 `authority=workspace`。
- 交付取消：人可通过交付卡「停止交付」二次确认取消；总管 `cancel_delivery` 首次必须确认；阶段任务级联取消。
- 总管闸门卡：审批/验收卡内联出现在总管栏「待我处理」，支持允许/拒绝、通过/打回与 override 理由。
- 真实链路：deepseek-flash 总管 + 真实 Claude 从需求到验收完成 4/4；3 个人工闸门在总管栏处理，开发阶段自动闸门放行；总管 toolCalls 无 approve/reject/resolve。见 [`m8-real-chain.md`](m8-real-chain.md)。
- 真实链路暴露并修复：daemon 重启后 `waiting_input(stalled)` 任务无法由总管 `enqueue_task` 重新入队。

## 已验证

- `pnpm verify`：typecheck / lint / format / boundaries / protocol / 单测 / build / bundle 断言全绿。
- daemon：97 test files / 450 tests。
- web：68 test files / 319 tests。
- Playwright：57 passed（本轮无 flake；`canvas-group` headless 偶发仍保留 retry）。
- `pnpm pack:check`：通过。
- bundle 断言：主 chunk 不含 `@excalidraw/excalidraw`，`DrawingEditor-*` 懒加载 chunk 存在。
- 自动化门明细见 [`m8-e2e.md`](m8-e2e.md)。
- 新交付 e2e：交付看板 → 交付画布 → 快速标注层。
- 真实 Claude 全链路：4 阶段全部完成，验收 A1–A8 全 PASS，见 [`real-chain/README.md`](real-chain/README.md)。
- 全场景覆盖矩阵：工作区信任、交付推进/取消、产物/画板、验收矩阵、ReviewCard、审批、自动化、标注、移动端、实时事件，见 [`coverage-matrix.md`](coverage-matrix.md)。
- 总管-only 闭环验证：真实 deepseek-flash 总管完成建交付、阶段开工与终态确认；3 个人工闸门在总管栏闸门卡完成，见 [`m8-real-chain.md`](m8-real-chain.md)；任务详情/审批中心入口仍保留。

## 已知后置

- `canvas-group` 拖拽在 headless 下偶发，已用 retry 兜底；后续可改成分帧驱动或等待 move 命令稳定。
- Excalidraw 画板的 Playwright 保存链路未单独覆盖；ego-lite 已手工覆盖新建/保存/重开，见 `coverage-matrix.md`。
- 闸门卡是前端从 task attention 派生的视图，不持久化进总管消息/模型上下文；刷新后由查询重建。
- 验收矩阵仍用 `window.prompt` 收集 overrideReason（任务详情入口）；总管闸门卡已是内联 HeroUI 输入区。
- 浏览器实测较重的验收阶段会接近默认 `claudeMaxTurns=30`；本次真实验收用 `BATON_CLAUDE_MAX_TURNS=60` 完成。
- 工作区授权是“所有非 deny”语义，host MCP 工具也会被自动批准；如需按工具域收窄，后续新增策略维度。
- REST 交付路由没有 workspace 维度，仍按本地单工作区假设；总管交付工具已校验 workspace 归属。
- `packageManager` 缺失时 verify runner 默认 pnpm；corepack 不可用的环境会失败，可后续按 lockfile 推断默认包管理器。
- 外部提醒推送（系统通知/IM）后置；本迭代只做应用内提醒。

## 命令

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
```
