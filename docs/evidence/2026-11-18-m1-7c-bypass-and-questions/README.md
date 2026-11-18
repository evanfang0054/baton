# M1-7c 跳过审批与结构化提问：验收证据

- 日期：2026-11-18
- 分支：`feat/m1-7c-bypass-and-questions`（基于 `feat/m1-7a-web-acceptance`）
- 关联：ADR 0005

## 自动化

`pnpm verify` 全绿（typecheck、lint、format、boundaries、protocol、145 个 daemon 测试、82 个 web 测试、build）。

新增覆盖：

- `apps/daemon/test/questions.test.ts`：答案校验/规范化、非法选项、单选/多选、拒绝无需答案、响应容错解析。
- `apps/daemon/test/session-runner-approval.test.ts`：`AskUserQuestion` 的答案经 `answerQuestion` 下发，而不是走普通 `approve`。
- `apps/daemon/test/transition-runner.test.ts`：`approval.decide` 在落状态前校验并写入 `response_json`；缺答案与非法选项返回 `invalid_payload`。
- `apps/daemon/test/task-service.test.ts`：全局开关关闭 → `bypass_not_allowed`；workspace 未信任 → `workspace_untrusted`；成功时落库并写 `task.bypass_permissions` 审计。
- `packages/adapters/test/claude/transport.test.ts`：`bypassPermissions` 打开时移除 `disableBypassPermissionsMode`，并设置 `allowDangerouslySkipPermissions`。
- `apps/web/src/features/tasks/QuestionCard.test.tsx`：选项提交、多选逗号拼接、补充说明、拒绝、非法 payload 回退。
- `apps/web/src/features/tasks/TaskDetailPanel.test.tsx`：`AskUserQuestion` 审批渲染为问题卡片，提交后发送带 `answers` 的 `approval.decide`。

## 真实 SDK 冒烟（本机 Claude Code 登录态）

直接调用 `createSdkClaudeTransport`，工作目录为临时目录，`bypassPermissions: true`，提示模型先问颜色再写文件：

```
EVENT tool_use AskUserQuestion {"questions":[{"header":"颜色","multiSelect":false,"options":[{"description":"选择红色","label":"Red"},{"description":"选择蓝色","label":"Blue"}],"question":"请选择要使用的颜色？"}]}
EVENT approval_request AskUserQuestion
EVENT tool_use Write {"file_path":"<tmp>/answer.txt","content":"Red\n"}
EVENT tool_use mcp__baton__baton_report {"outcome":"ready"}
EVENT outcome
ANSWER_FILE "Red\n"
ASKED true
```

结论：

- bypass 模式下普通工具不再进入 `canUseTool`（SDK 给出 `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` 警告），符合「跳过审批」预期。
- `AskUserQuestion` 在 bypass 下仍会进入 `canUseTool`；`updatedInput.answers` 被 SDK 接受，模型确实收到 `Red` 并写入文件。
- 冒烟脚本未入库；输出中的临时路径已脱敏。

## UI 全链路（ego-lite + 构建产物）

1. 用临时 `BATON_DATA_DIR` / `BATON_WORKSPACES_ROOT` 启动 `apps/daemon/dist/bin.js`，设置 `BATON_ALLOW_BYPASS_PERMISSIONS=1`。
2. 浏览器创建工作区并信任；新建 Agent 节点；任务选择 `claude-sdk`，勾选「跳过权限确认」。
3. 任务提示模型先提问颜色再写文件；等待后出现选项卡片（Red / Blue），任务详情同时显示「跳过权限确认」徽标。
4. 选择 Red 并提交；模型写入 `answer.txt`（内容 `Red`），通过 `baton_report` 报告 ready，任务进入验收；人工通过后状态为「已完成」。

截图：

- [01-question.png](01-question.png)：问题卡片与 bypass 徽标
- [02-done.png](02-done.png)：提交选择后的完成态与工具记录

## 打包修复

全链路验收时发现：daemon 构建把 adapters（连同 SDK 源码）一起内联，但 `apps/daemon` 未声明 SDK 依赖，导致

- 打包后的引擎探测误报 `Claude Agent SDK is not installed`，UI 禁用 `claude-sdk`；
- `dist` 内联了 SDK 源码，与 `THIRD_PARTY_NOTICES.md` 的「不再分发其源码」不符。

修复：把 `@anthropic-ai/claude-agent-sdk@0.3.327` 声明为 daemon 的运行时依赖。构建后 SDK 保持 external，`claude-*.js` 从 1.48 MB 降到 16 KB，引擎探测恢复正常。
