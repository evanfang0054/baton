# M1-7a S2 spike 证据

日期：2026-11-18
SDK：`@anthropic-ai/claude-agent-sdk@0.3.327`
脚本：`scripts/spike-claude.ts`（本机临时运行，不进入 CI）

## 目标

验证真实 SDK 能否通过 `ClaudeAdapter` 启动、进入事件流，并完成 `baton_report` 到 `RUN_FINISHED` 的闭环。

## 运行

```bash
pnpm exec tsx scripts/spike-claude.ts
```

Prompt：`Reply with exactly the word pong, then call baton_report with outcome ready.`
Trust：`{ projectSettings: false, projectHooks: false }`
预算：`maxTurns=5`、`maxBudgetUsd=0.2`

## 第一次失败与根因

第一次运行返回：

```text
Not logged in · Please run /login
```

二分 SDK options 后确认：`settingSources: []` 会同时切断本机 OAuth 登录态；`['user']`、`strictMcpConfig: true`、`plugins: []` 均正常。修复见 `docs/adr/0004-untrusted-loads-user-settings.md`：不可信 workspace 保留 `['user']`，只隔离 project/local settings 与项目 MCP。

## 最终结果

```text
pongpong 已回复，baton_report 已上报（outcome: ready）。
SPIKE_EVENTS ["RUN_STARTED","TEXT_MESSAGE_START","TEXT_MESSAGE_CONTENT","TEXT_MESSAGE_END","TOOL_CALL_START","TOOL_CALL_ARGS","TOOL_CALL_END","TOOL_CALL_RESULT","TOOL_CALL_START","TOOL_CALL_ARGS","TOOL_CALL_END","CUSTOM:session.outcome:{\"outcome\":\"ready\"}","TOOL_CALL_RESULT","TEXT_MESSAGE_START","TEXT_MESSAGE_CONTENT","TEXT_MESSAGE_END","RUN_FINISHED"]
SPIKE_FINISHED true
```

## 结论

- **Go**：真实 Claude 可通过 adapter 启动、回复、调用 `baton_report`，`session.outcome=ready` 后正常 `RUN_FINISHED`。
- `maxTurns=2` 时回复 + 上报会触发 `Reached maximum number of turns (2)`；默认 30 足够。
- 未执行完整 UI 真实闭环（建任务 → 审批 → verify → review）；CI 与 Playwright 仍不依赖真实 API。
