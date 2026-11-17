# ADR 0001：不做完整事件溯源，`task.status` 作为投影

- 状态：proposed
- 日期：2026-11-17
- 关联：`docs/specs/2026-11-17-m1-attention-semantics-design.md`

## 背景

baton 已经有 `task.status`、`ws_event`、`event` 与会话 transcript。
M1-5a 需要让任务状态可解释（`cause` / `attention` / `waitingSince`），
但当前仍是本地单用户、单 daemon、单写者、默认 `maxConcurrency=1` 的场景。

## 选项

1. **完整事件溯源**：只存领域事件，任务状态每次折叠得出；需要 event store、版本/upcaster、snapshot、projection rebuild 与最终一致性读模型。
2. **状态投影 + 事件历史**：`task.status` 由 core 的 `transition()` 单写者、事务更新；`ws_event` 保存可重放的状态历史；事件不承担唯一事实来源。
3. **不存状态，每次现算**：每次读看板都从事件折叠。

## 决定

选 2。

`task.status` 是**物化投影**，不是第二事实来源；`transition()` 是唯一写入口。
任务状态历史由 `ws_event` 承担；本轮不新增 `task_event`。
会话的 `outcome`、`waitingReason`、`cause` 与 `attention` 是同一条事实链上的字段，
不改变「状态机唯一写入口」的约束。

## 后果

**优点**

- 看板列表直接读 `task.status`，没有投影延迟，符合本地驾驶舱的即时反馈。
- 不需要 event store、upcaster、snapshot 与 projection rebuild 的基础设施。
- 迁移只加可空列；旧数据不需要回填。
- 隐私面更小：不需要让 prompt、审批输入永久进入领域事件。

**代价**

- 不能任意时间点回放任务状态；`ws_event` 只是可重放的状态消息，不是完整领域事件。
- 如果未来出现绕过 `transition()` 写 `task.status` 的代码，历史无法自动纠正。
- 任务级统计/审计如果超出 `ws_event` 的能力，需要补投影或补表。

**约束**

- 任何 `task.status` 写入必须经 `applyTransition()`；repository 不暴露通用状态写方法。
- `task.status` 事件必须带 `previousStatus`、`cause`、`attention`，保证可解释。
- `ws_event` 的 payload 变更必须保持向后兼容（新字段可空）。

## 何时重新评估

出现以下任一情况时，再考虑只对 **task aggregate** 做事件溯源（不是全系统）：

- 多 daemon 或多用户同时写同一任务；
- 一个任务多 session 并发，需要聚合；
- 合规要求任意时间点回溯或完整审计；
- 投影 bug 频繁，需要常态化 replay 修复；
- 任务历史 UI/统计需要比 `ws_event` 更细的领域事实。

## 回退路径

1. 新增 `task_event` 追加表，与 `task.status` 同事务写入。
2. 增加「折叠 `task_event` 能重建当前 status」的等价测试。
3. 有真实消费者后，再把 `task.status` 降级为纯缓存。
