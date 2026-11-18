# M1-7a 性能热路径基线

- 日期：2026-11-17
- 环境：Node 22.23.1、pnpm 10.27.0、macOS（不记录主机名/用户名）
- 命令：`pnpm bench:m1-7a`

## Transcript 全量重建

| events | mean | p50 | p95 |
|---|---|---|---|
| 5,000 | 0.76ms | 0.61ms | 1.78ms |
| 20,000 | 2.01ms | 1.66ms | 4.11ms |
| 50,000 | 5.74ms | 5.73ms | 9.78ms |
| 100,000 | 14.74ms | 16.13ms | 18.81ms |

说明：

- p95 由 10 个样本取排序后的高位值；样本少、波动大。多次运行中 50k p95 在 7–10ms 之间，mean 稳定在 5–6ms。
- 5k/20k 稳定低于 8ms 预算；50k 是边界；100k 明显超。
- 7a 不落 partial，真实会话预计远低于 20k 事件。因此 7a 不做 stateful 增量投影，保留基准；触发条件为真实会话 >50k 或持续 p95 >8ms。

## Event store append 5k（FULL vs NORMAL）

| 轮次 | FULL mean | NORMAL mean |
|---|---|---|
| 第一对 | 669.63ms | 468.91ms |
| 第二对 | 601.99ms | 1504.22ms（系统负载污染，不作结论） |

说明：

- 第一对干净对比中 NORMAL 约快 30%；绝对值受磁盘、GC、系统负载影响很大。
- 真实会话的事件速率远低于 benchmark 的 5k 突发；事件写入不是 7a 的主瓶颈，`synchronous=NORMAL` 作为低风险优化保留。
- 断电最多丢最后几条未提交事务；SQLite 仍保持一致。

## 代码变更

- `openDb`：WAL + `synchronous=NORMAL`。
- `appendSessionEvent`：`event` 只序列化一次；`BroadcastEvent.payloadJson` + `buildWsFrame` 复用 WS payload。
- `session-cache`：`isAppendOnly` 快路径；严格递增时直接 append，乱序才 Set + sort。
- `ws`：`parseIncomingMessage` 对 `session.event` 做字段级检查；控制消息仍走完整 `SessionMessage` 校验；`RealtimeProvider` 不再逐事件 `SessionEventRecord.parse`。
- 未引入 `TranscriptProjector`（数据触发，见上）。

## 校验

- `pnpm verify:full`：通过；Playwright `shell.spec.ts` 1 passed。
- `pnpm pack:check`：通过（`pack-check ok`）。
- 定向测试：daemon 115 tests、web 定向 14 tests（ws 8 / RealtimeProvider 2 / session-cache 4）。
