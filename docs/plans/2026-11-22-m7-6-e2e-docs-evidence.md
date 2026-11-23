---
spec_ref: ../specs/2026-11-22-m7-delivery-playbook-design.md
spec_topic: m7-delivery-playbook
task_count: 3
dod: "交付工作台 e2e、证据落盘、verify:full 与 pack:check"
status: completed
depends_on: 2026-11-22-m7-5-acceptance-skills.md
---

# M7 Plan 6：E2E、证据与收口

- [x] 新增 `apps/web/e2e/delivery.spec.ts`：交付看板 → 交付画布 → 快速标注层。
- [x] `pnpm verify` 全绿（含 Excalidraw bundle 断言）。
- [x] `pnpm pack:check` 通过。
- [x] `pnpm verify:full` 全绿：Playwright 54 passed；旧三栏/右栏 e2e 已按新交付壳与覆盖层重写。
- [ ] ego-lite 截图与真实 Claude 交付链路证据（需本机 Claude 登录态，后置）。

## 说明

- 旧 e2e 已对齐“右栏只留总管 + 覆盖层”；无交付时回退 workspace inbox 画布以兼容旧任务。
- 证据见 `docs/evidence/2026-11-22-m7-delivery/README.md`。
