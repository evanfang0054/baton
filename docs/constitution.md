# baton 项目宪法

> 最高优先级。与任何其他指令、习惯或模板冲突时，以本文为准。
> 需要例外时，先写 ADR（`docs/adr/`），再改代码。

## 一、五条不变量

1. **一个节点 = 一个独立会话**。上下文通过画布连线显式传递，不把全部历史塞给同一个 Agent。
2. **画布是共享内存**。框选与连线是强制注入；向量召回只能作为补充，不能作为唯一依据。
3. **状态机是唯一事实来源**。看板、画布节点、通知都是投影；任何地方都不得绕过状态机直接改状态。
4. **验收必须带可执行证据**。没有 verify 退出码、输出摘要与 diff 统计的交付，不算完成。
5. **危险操作默认拒绝**。自动批准必须命中白名单、可审计、可一键停止。

## 二、硬约束

- **分层**：`packages/core` 是纯函数层，不 import `node:fs` / `node:net` / `apps/*`；`apps/web` 不 import `apps/daemon`；适配器只能经 `AgentAdapter` 接口调用。
- **契约**：协议与配置只在 `packages/protocol` 用 zod 定义，类型由 `z.infer` 推导；禁止手写重复类型。
- **安全**：不实现通用 shell；不执行模型生成的命令；所有路径过 jail；非 `127.0.0.1` 监听必须带 token；日志、注释、文档与截图一律脱敏，不写个人身份、凭据、本机绝对路径与主机信息。
- **依赖**：新增依赖先查许可。GPL / AGPL / Sustainable Use 禁止；Apache-2.0 需更新 `THIRD_PARTY_NOTICES.md`；Claude Agent SDK 为非 OSI 许可，只能当依赖，不得 fork 或再分发源码。
- **范围**：v1 非目标（DSH 插件、外部触发器、向量库、真终端、多用户、DAG 编排）未经 spec/ADR 不得顺手实现。

## 三、完成定义（DoD）

- `pnpm verify` 通过；
- 新逻辑有测试，`packages/core` 覆盖率 ≥ 80%；
- UI 改动附截图或 gif；
- 协议或 schema 变更附迁移说明与契约测试；
- 相关文档已更新。

**没有实际运行过的验证，不得声称完成。** 测试失败要贴输出，不能只说"应该没问题"。

## 四、事实基线

- 本地 Node 22 + pnpm 10；CI 覆盖 Node 22/24；DSH CLI 要求 ≥ 24.9（post-v1）。v1 不使用 Docker 分发。
- DSH 是 Cordis/Node 插件体系，没有 Python SDK；`@deepseek-ai/dsh` 是 CLI，`@deepseek-ai/dsh-headless` 是 one-shot runner。
- Claude Code 的结构化流与授权回调走 `@anthropic-ai/claude-agent-sdk`，PTY 仅作兜底。
- 详细设计与决策见 `docs/specs/2026-11-16-baton-architecture-design.md`。
