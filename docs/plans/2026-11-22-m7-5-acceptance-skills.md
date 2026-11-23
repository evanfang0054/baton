---
spec_ref: ../specs/2026-11-22-m7-delivery-playbook-design.md
spec_topic: m7-delivery-playbook
task_count: 3
dod: "验收矩阵覆盖层、阶段闸门按钮、交付报告 artifact、skill 状态可见"
status: completed
depends_on: 2026-11-22-m7-3-web-shell-board-canvas.md, 2026-11-22-m7-4b-quick-annotation.md
---

# M7 Plan 5：验收矩阵与 skills

- [x] 验收矩阵覆盖层：用户故事 / 验收标准 / 怎么验三列；AC 条目与证据。
- [x] 闸门按钮调用现有 `review.decide`，不经过总管。
- [x] 交付最后阶段完成后写 `delivery-report.md` artifact。
- [x] 阶段分组头显示 skill id 与 `ok/missing/disabled_untrusted`。
- [x] 覆盖层里的“通过/打回”在 AC 未过时强制 overrideReason 的 UI。
- [x] 验收矩阵 Playwright + 报告链接直达。

## 已知偏离

- 验收矩阵按阶段 key `acceptance` 查找任务；自定义 playbook 的最后一个阶段暂未泛化。
