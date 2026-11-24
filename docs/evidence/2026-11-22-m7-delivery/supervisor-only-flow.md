# 总管-only 需求闭环验证（2026-11-23）

## 结论

用户只通过右侧总管、不打开任务看板，无法跑通「需求 → 设计 → 开发 → 验收」闭环。

不是模型不会调度，而是当前产品边界决定了两类动作必须由人离开总管完成：

1. 工具审批（approval）：总管明确回答「审批只能你来点，我这边不能代批」，并指向任务详情/审批卡。
2. 阶段闸门（review gate）：总管明确回答「闸门只能由你本人通过，我无法代批」。
3. 交付取消：总管没有 `cancel_delivery` 工具，只能取消任务；取消阶段任务曾让交付错误地显示为 running 并指向下一阶段（已修复为 cancelled）。

因此「只通过总管、不介入任务看板」不符合当前 baton.ai 的文章预期。文章把总管定义为 Router：「只调度，不干活」「不替我过闸门」；人只出现在闸门。当前实现与这个边界一致，但人的动作仍落在任务详情/看板，而不是总管栏。

## 实测过程

环境：真实 daemon + 真实 Claude Code + `supervisor.json`（deepseek-flash）；新工作区夹具，含 skills 与 playbooks。

1. 对总管说：「创建一个交付：做一个极简登录页……创建后立即开工第一阶段。」
   - 总管调用 `create_delivery` + `enqueue_delivery`，交付创建成功，第一阶段进入 queued。
2. 第一阶段请求 Write（medium）。
   - 总管回复：第一阶段任务 `waiting_input`，原因 approval；「到任务详情或审批卡里通过/拒绝这次 Write；审批只能你来点，我这边不能代批。」
   - 用户若只看总管，闭环在此停止。
3. 人工在审批卡允许 Write 后，第一阶段进入 review。
   - 对总管说「请直接帮我通过，进入设计阶段。」
   - 总管回复：「第一阶段的闸门只能由你本人通过，我无法代批。」
   - 用户若只看总管，闭环再次停止。
4. 人工在验收卡通过需求阶段后，对总管说「请开工设计阶段。」
   - 总管成功调用 `enqueue_delivery`，设计阶段 queued。
5. 设计阶段连续出现高风险 Bash/Write 审批（ls、node 校验脚本、Chrome/Playwright 路径检查）。
   - 每次都需要人工在审批卡允许；总管无法代批。
6. 对总管说「请直接取消整个交付。」
   - 总管回复没有「取消整个交付」工具，只能取消任务；取消设计任务后，交付状态曾被推导为 running、currentStageKey=build，但 build 任务并未创建。

## 产品预期对照

baton.ai 对总管的定位：

- 「只调度，不干活。它能用的只有 canvas-agents CLI 和外部触发器，不写代码、不替我过闸门。」
- 「外面来的事先进精灵总管，它分诊、建工单；Worker 干活、报告；我只在闸门出现。」
- 「我只关心结果……第二天早上看到的是最终待审核和待验收的任务。」

当前实现与这些描述一致：总管能建交付、开工、播报状态，但不能代批 approval/review。差异在于「我只在闸门出现」的入口仍在任务详情/看板；如果产品目标是「人只停留在总管栏」，需要新增人类操作卡，而不是给总管 approve/reject 工具。

## 建议

- 保持总管不拥有 approve/reject/resolve 工具，避免模型代老板拍板。
- 若要做「不离开总管」：在总管栏增加「待我处理」人类操作卡（approval allow/deny、review 通过/打回），按钮直接发 `approval.decide` / `review.decide`；总管只负责展示与提醒，不参与决定。
- 补 `cancel_delivery` 或让阶段取消自动取消整个交付；当前已先把阶段取消的派生状态修成 cancelled。
- 设计/开发阶段的高风险命令审批过密（ls、node 校验、Chrome 路径检查），会显著增加人的点击量；需要更细的 allow 规则或把这类命令收敛到项目脚本。

## 本轮顺带修复

- 阶段任务取消后，交付状态从错误的 `running`（currentStageKey 指向未创建的下一阶段）修正为 `cancelled`，currentStageKey 为 null；补 `deriveDeliveryStatus` / `deriveCurrentStageKey` 测试。截图：`scenarios/supervisor-cancelled-delivery.png`。
- 移除任务详情里的「任务预算」预先设置入口（BudgetEditor）；预算不再作为开工前的手填参数。全局成本上限与超预算后的提额卡仍保留，用于避免失控成本和恢复被预算中断的任务。
