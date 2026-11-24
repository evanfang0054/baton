---
spec_topic: supervisor-chat-only-digest
decision_summary: "总管右栏收敛为单一聊天流：汇报由 daemon 落成 assistant 消息并带内联决策动作；移除红框内的头部摘要、DigestCard、生成汇报/历史按钮与独立审批/验收卡带"
design_approved: true
user_approved_at: 2026-11-24T10:59:35+08:00
gates: [design-approved, user-review-passed]
spec_ref: 2026-11-22-m6-5-supervisor-autonomy-design.md
domain_terms:
  [supervisor-chat, digest-message, attention-item, inline-action, unread-notice]
---

# 总管右栏收敛为聊天流设计

> 子 spec。回链：`docs/specs/2026-11-22-m6-5-supervisor-autonomy-design.md`（注意力与 digest）、`docs/specs/2026-11-19-m2-autopilot-design.md`（定时汇报）。
> 本文只改展示与投递通道，不改任务状态机、验收语义与策略求值。

## 0. 文档信息

- **状态**：用户已逐项确认（2026-11-24），设计通过，进入实现。
- **范围**：`packages/protocol/**`、`apps/daemon/**`（digest / supervisor store）、`apps/web/**`（总管右栏）、相关单测与 e2e。
- **不改**：`notice` 表与 `/api/notices`、自动汇报 cron、`supervisor.action.decide` 的权限与审计、任务详情里的审批/验收操作。

## 1. 问题

右栏红框内同时存在四块信息：头部“上下文 / 目标 Agent”摘要、`DigestCard`（本轮汇报统计 + 需要你决定 + 生成汇报/历史）、输入区上方的审批/验收卡带，以及真正的聊天记录。

结果是：

- 同一条注意力信息在汇报卡、看板、审批卡中重复出现；
- 汇报卡把聊天区挤到很窄，用户看到的首屏不是对话；
- “生成汇报 / 历史”与“对总管说‘汇报一下’”是两套并行入口；
- 汇报的 notice 与聊天消息是两条时间线，刷新/重放/跨设备后无法对齐。

## 2. 已确认决策

1. **汇报即消息**：digest 生成（manual / schedule / attention）时，daemon 往该 workspace 的总管 thread 落一条 `role=assistant` 的消息，并广播 `supervisor.message`。聊天记录天然成为汇报历史；不再依赖前端把 notice 画成消息。
2. **消息内联轻动作**：汇报消息附带结构化的注意力项快照（`AttentionItem[]`），前端在消息下方渲染“去验收 / 打开任务 / 应用建议”。批准、拒绝、打回等重操作仍进任务详情，不在消息里做。
3. **移除手动入口**：删除“生成汇报 / 历史”按钮；用户想主动要汇报时对总管说“汇报一下”，走同一条聊天链路。`POST /api/workspaces/:id/digest` 保留给自动化与 CLI。
4. **移除头部摘要**：删除右栏内“总管 / 上下文 N 个 · 目标 Agent X”整块；上下文与目标 Agent 只在输入区 chips 呈现，保持单一真源。
5. **移除独立操作卡带**：`SupervisorGateCards` 不再挂在右栏；审批/验收从消息动作或任务详情进入。避免“聊天区上方再压一条卡片带”。

## 3. 协议

`SupervisorMessage.meta` 增加可选 `digest` 快照（additive，旧消息缺省为 `null`）：

```ts
SupervisorDigestMeta = {
  noticeId: Id
  trigger: 'manual' | 'schedule' | 'attention'
  generatedAt: Timestamp
  items: AttentionItem[]   // 最多 20 条，沿用注意力协议
}

SupervisorMessageMeta = {
  contextNodeIds: Id[]
  targetNodeId: Id | null
  digest: SupervisorDigestMeta | null
}
```

- 消息正文只放简短统计摘要；待决策项的标题、原因、动作由 `meta.digest.items` 渲染，避免正文与卡片重复。
- 不新增表、不加 migration；`supervisor_message.meta_json` 已能存该结构。

## 4. daemon

digest 服务生成 notice 后，追加一步“投递到会话”：

1. `getOrCreateThread(workspaceId)`（与聊天共用同一个 thread；首次只有汇报也会建 thread）。
2. `insertNotification({ threadId, dedupeKey: 'digest:<noticeId>', content, meta })`，复用现有去重索引 `(thread_id, trigger_id)`，重复投递不会产生第二条。
3. 组装 `SupervisorMessage` 并广播 `supervisor.message`。
4. 正文格式（示例）：

```
本轮汇报 · 11/24 21:00
共 13 个任务：待处理 0，待验收 0，进行中 0
变化：新增 5 · 完成 5 · 失败 1 · 重试 0
需要你决定 3 件（见下方）。
```

- `attention.items` 为空时不追加“需要你决定”行，消息只有统计。
- 定时汇报在 0 任务时仍按现状返回 `null`，不落消息。
- 消息写入与 notice 写入分成两个事务：notice 失败不阻塞聊天，聊天失败只记 warn，不影响汇报生成本身。

## 5. web

`SupervisorPanel` 收敛为：状态栏 → 消息列表 → 输入框。

- 删除 `DigestCard`、`SupervisorGateCards` 的渲染与 import；组件文件与旧单测同步删除。
- 删除右栏内的头部摘要块；保留外层 `RightPanel` 的“精灵总管 + 收起”。
- `SupervisorMessage` 在 `meta.digest` 存在时渲染注意力项：
  - 每项显示标题、原因、“等待中”时长；
  - 动作：`open_review` → “去验收”，`open_task` → “打开任务”，`apply_proposal` → “应用建议”（调用 `supervisor.action.decide` 后刷新任务/notice）；
  - 动作区最多展示 5 项，其余提示“其余 N 件到任务详情处理”。
- 未读汇报：保留外层“有未读汇报”圆点。总管面板挂载且收到新 digest notice 时调用 `readNotice` 并刷新 notices 查询；面板收起时圆点保留，用于提示“有新汇报进了聊天”。

## 6. 非目标

- 不做消息级已读/未读游标；
- 不做汇报消息的编辑、删除或手动置顶；
- 不把审批的允许/拒绝搬进消息；
- 不删除 `notice` 表与汇报 REST；
- 不调整汇报 cron 与 attention 收敛策略。

## 7. 验收

- 单测：
  - protocol：带 `meta.digest` 的消息可解析；旧消息（无 digest）仍可解析。
  - daemon：manual/schedule/attention 三种 trigger 都会落一条消息，内容含统计，meta 快照与 notice 的 attention 一致；重复调用不重复落消息。
  - web：`SupervisorPanel` 不再出现“本轮汇报 / 需要你决定 / 生成汇报 / 历史 / 待我处理”区块；带 digest 的消息显示动作并回调打开任务。
- e2e：`automation.spec.ts` 与 `supervisor-autonomy.spec.ts` 改为断言聊天里出现汇报消息与内联动作，红框元素不存在。
- 视觉：右栏首屏只有状态栏、聊天消息、输入框；对照 `DESIGN.md` 使用 `text-muted` / `border-separator` / `bg-surface`，不新增颜色。
