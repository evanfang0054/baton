---
spec_ref: ../specs/2026-11-22-m7-delivery-playbook-design.md
spec_topic: m7-delivery-playbook
task_count: 3
dod: "交付工作台 e2e、证据落盘、verify:full 与 pack:check"
status: active
depends_on: 2026-11-22-m7-5-acceptance-skills.md
---

# M7 Plan 6：E2E、证据与收口

- [x] 新增 `apps/web/e2e/delivery.spec.ts`：交付看板 → 交付画布 → 快速标注层。
- [x] `pnpm verify` 全绿（含 Excalidraw bundle 断言）。
- [x] `pnpm pack:check` 通过。
- [ ] `pnpm verify:full` 全绿：当前 24 passed / 30 failed；失败集中在 M7 前的旧三栏/右栏任务详情 e2e，需要按新 UI 覆盖层重写。
- [ ] ego-lite 截图与真实 Claude 交付链路证据。

## 阻塞

- 旧 e2e 大量断言 `board-rail`、右栏任务 tab、任务详情在右栏；M7-3 已按 spec 收敛为“右栏只留总管 + 覆盖层”。需要逐个更新断言，不能靠兼容层绕过。
