# M1-7a S2 spike 证据

日期：2026-11-18
SDK：`@anthropic-ai/claude-agent-sdk@0.3.327`
脚本：`scripts/spike-claude.ts`（本机临时运行，不进入 CI）

## 目标

验证真实 SDK 能否通过 `ClaudeAdapter` 启动、进入事件流，并把启动失败映射为可解释的 `RUN_ERROR`。

## 运行

```bash
pnpm exec tsx scripts/spike-claude.ts
```

Prompt：`Reply with exactly the word pong, then call baton_report with outcome ready.`
Trust：`{ projectSettings: false, projectHooks: false }`
预算：`maxTurns=2`、`maxBudgetUsd=0.2`

## 结果

```text
Not logged in · Please run /login
SPIKE_EVENTS ["RUN_STARTED","TEXT_MESSAGE_START","TEXT_MESSAGE_CONTENT","TEXT_MESSAGE_END","RUN_ERROR"]
SPIKE_FINISHED true
```

## 结论

- **Go（transport 边界）**：SDK 成功启动，`RUN_STARTED`、文本事件、`RUN_ERROR` 均按映射协议输出，进程无残留。
- **阻塞（真实闭环）**：本机 Claude Code CLI 当前未登录，`~/.claude/.credentials.json` 不存在，无法完成真实任务闭环。需用户在本机执行 `claude /login` 后重跑本脚本与 ego-lite 验收。
- CI 不受影响：adapter/daemon 测试使用注入 transport，不调用真实 API。
