# ADR 0005：按任务跳过审批与结构化提问

- 状态：accepted
- 日期：2026-11-18
- 关联：`docs/specs/2026-11-17-m1-claude-adapter-design.md` §5.3、§6.3、§14
- 修正：M1-7b 中的「会话级 allow」与「AskUserQuestion 禁用」

## 背景

实际使用中暴露两个缺口：

1. 某些任务需要长时间无人值守（批量重构、生成脚手架）。逐条审批会让任务停在 `waiting_input`，用户必须一直盯着。需要可选地使用 SDK 的 `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions`。
2. `AskUserQuestion` 是 Claude Code 的交互式选择工具。禁用后模型只能以纯文本提问，无法把结构化选项反馈给引擎；用户看不到可选项，模型也收不到答案。后续精灵总管也需要一个可编程的「问题-答案」接口。

## 决定

### 跳过审批

- 粒度：**按任务**，默认关闭；不能全局默认开启。
- 前置条件：workspace 必须已信任；全局 `BATON_ALLOW_BYPASS_PERMISSIONS=1` 必须开启，否则 `task.create` 返回 `bypass_not_allowed`。
- UI：建任务表单提供「跳过所有权限审批（危险）」开关，默认关；任务详情显示「跳过权限」徽标。
- 审计：创建任务时写 `task.bypass_permissions`。
- SDK：`permissionMode: 'bypassPermissions'`、`allowDangerouslySkipPermissions: true`；仍保留读写目录边界与 hooks 开关。显式 ask 规则与 `AskUserQuestion` 仍会进入 `canUseTool`。
- 风险：跳过审批后 baton policy 不再是闸门；文件写入、Bash 等由 Claude Code 自行执行。必须由用户逐任务确认。

### 结构化提问

- 允许 `AskUserQuestion`，不再放入 `disallowedTools`。
- transport 把它当作一种审批请求：`canUseTool` 收到 `questions` 后挂起，生成 `approval.request`；请求落在既有 `approval` 表，刷新后可恢复。
- 用户选择后，web 发送 `approval.decide`，附带 `answers`（question text → label / 逗号分隔 labels）与可选 `response`。
- daemon 把答案写入 `approval.response_json`，走既有 `approval_allow` 转移；session-runner 检测到该审批是 `AskUserQuestion` 时调用 adapter 的 `answerQuestion`，否则走 `approve`。
- 答案通过 `updatedInput: { ...input, answers }` 回给 SDK；不新增工具、不改 AG-UI 事件。
- 未来精灵总管可以在 `resolveApproval` 之前填入 `answers`，无法决策时再落回人工。

## 后果

**优点**

- 无人值守任务可以显式、可审计地跳过审批。
- 结构化问题能直接反馈给模型，不再因纯文本提问丢失选项。
- 复用 approval 表与既有状态机，刷新可恢复，改动面小。
- 精灵总管已有可编程接口。

**代价**

- 跳过审批是真实的高风险能力；依赖用户逐任务确认与全局开关。
- `approval.response_json` 只保存答案，不保存问题快照；问题文本仍在 `request_json`。
- `AskUserQuestion` 的 freeform/annotations 仅支持基础答案；未实现逐题 unanswered 标注。

## 回退路径

- 关闭 `BATON_ALLOW_BYPASS_PERMISSIONS` 即禁用跳过审批；已有任务不受影响。
- 若结构化问题出现兼容问题，可把 `AskUserQuestion` 重新加入 `disallowedTools`，不影响其他审批。
