# 0011. 交付拥有画布，workspace 画布作为 inbox/总览

- 状态：已采纳
- 日期：2026-11-22

## 背景

主架构 spec 把画布限制为“每个 workspace 一张”（`canvas.workspace_id`）。M6-1 的“任务现场”是在这张 workspace 画布上做派生聚焦，任务本身没有自己的画布。

但目标产品是“一条需求一块画布”：需求、spec、原型、设计、实现、验收证据、标注都在同一块画布上；多条需求并行时，不能把所有节点混在一张 workspace 画布里。`baton.ai` 的文章也把产品形态定义为“项目 → 任务（一块画布）→ 多个 window”。

可选方案：

1. **workspace 但画布 + 交付泳道**：改动最小，但多条交付仍共享一张图，任务现场只能靠筛选，和“一条需求一块画布”不一致。
2. **每个交付一块画布 + workspace 总览画布**：新增 `delivery` 聚合拥有画布；旧 workspace 画布保留为 inbox/总览；增量迁移，不丢旧数据。
3. **每个任务一块画布**：任务数量多，画布碎片化；阶段任务不需要各自一块画布。

## 决策

- 新增 `delivery` 聚合；`delivery.canvas_id` 唯一；`canvas.delivery_id` 可空且唯一。
- 新建交付时创建独立画布；workspace 原有画布 `delivery_id = NULL`，保留为 inbox/总览。
- 阶段任务（`task.delivery_id` 非空）使用所属交付的画布；旧任务（`delivery_id = NULL`）继续使用 workspace 画布。
- `task` 增加 `delivery_id`、`stage_key`；`canvas` 增加 `delivery_id`；均为 nullable，不回填旧数据。
- 任务现场（M6-1）的输入从“workspace 画布”改为“任务所属画布”；派生逻辑不变。
- 迁移 0015 只加表/列/索引；回滚 drop 新表/列，旧数据不受影响。

## 后果

- 一条需求一块画布；交付之间物理隔离；画布可以按交付聚焦、归档、导出。
- 旧 workspace 画布仍然可用；旧任务、旧节点、旧 review 卡不需要迁移。
- 画布查询需要 `deliveryId` 维度；`GET /api/canvas` 增加可选 `deliveryId`；不传时仍返回 workspace 画布。
- 画布布局需要区分“交付画布”（阶段分组布局）和“workspace 画布”（自由/inbox 布局）。
- 交付删除/取消不自动删除画布与产物；清理策略后置。
- 该决定改变主架构 spec 的“每个 workspace 一张画布”语义；后续以本 ADR + M7 spec 为准。

## 相关文档

- M7 spec：`docs/specs/2026-11-22-m7-delivery-playbook-design.md`
- 主架构：`docs/specs/2026-11-16-baton-architecture-design.md`（§2.4 领域模型、§2.7 上下文装配）
- 任务现场：`docs/specs/2026-11-21-m6-task-scene-design.md`
- 迁移：`apps/daemon/migrations/0015_m7_delivery_playbook.sql`（实现时新增）
