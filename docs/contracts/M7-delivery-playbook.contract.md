# Sprint Contract: M7 交付工作台与 SOP 流程

> 仓库没有 `docs/agent-harness/`，按既有约定落 `docs/contracts/`。
> 对应 spec：`docs/specs/2026-11-22-m7-delivery-playbook-design.md`。
> 对应 ADR：`docs/adr/0011-delivery-owned-canvas.md`。

## Outcome

我打开 baton，看到的是交付看板，而不是任务列表。点开一条需求，画布上四个阶段已经排好；总管替我建阶段、派活、列标注、催验收；我只在需求、设计、验收三个闸门看产物、写标注、拍板。右栏只有精灵总管，产物、任务现场、验收、标注都在画布上点开，不再切 tab。

## Definition of Done

- [ ] migration 0015 创建 `delivery`、`artifact`、`annotation` 与索引；`canvas.delivery_id`、`task.delivery_id/stage_key/annotation_ids_json` 为 nullable；空库与已有 nodes/tasks 的 fixture DB 升级通过；回滚可 drop 新表/列；旧数据 `delivery_id=null` 可读。
- [ ] 创建交付：同一事务建 canvas（`delivery_id=null`）→ delivery（playbook 快照）→ 更新 canvas `delivery_id` → 4 个阶段分组 → 第一阶段 agent node + task（`todo`）；不自动开工；写 audit；广播 `delivery.updated`。
- [ ] 阶段串行：只有前一阶段 `done` 才创建下一阶段 task；`enqueue_delivery` 只接受当前阶段 `todo`；`cancel_delivery` 取消当前非终态 task，不删除 artifact/annotation。
- [ ] playbook：`.baton/playbooks/*.yaml` 可解析/校验；`standard-delivery` 4 阶段；阶段 key/产物 name 唯一且安全；最后阶段必须 `human`；非法 playbook 返回 `playbook_invalid`；skill 缺失/未信任不阻断创建，阶段标 `missing`/`disabled_untrusted`。
- [ ] 闸门：human 走现有 `review.decide`；auto 仅中间阶段、AC pass、kill switch off、写 audit `delivery.stage.auto_approve`；最后阶段必须 human；总管不能 approve/reject；`review.auto_approve` 不是 WS 命令/总管工具。
- [ ] 交付状态：按 `cancelled > done > waiting_person > running > blocked > draft` 推导；`currentStageKey` 正确；看板 6 列；“需要我”= `waiting_person|blocked`；计数=列表长度；等待排序；批量查询无 N+1。
- [ ] artifact：固定路径 `.baton/deliveries/<deliveryId>/<stageKey>/<name>`；安全 name、jail、realpath、sha256、version、status；必产物缺失进 verify fail，可选产物缺失不失败；drawing 保存 `.excalidraw`+PNG+SVG；`GET content` 只服务已登记路径。
- [ ] annotation：表 + 创建/更新/列表；note ≤2k、strokes ≤2MB、PNG ≤10MB；target 必须在同交付画布/产物；note 为空时总管先问；任务通过自动 `resolved`，打回保持 `open`；支持手动 `dismissed`。
- [ ] 标注上下文：`create_task.annotationIds`、`plan_tasks/create_tasks` 支持；任务 prompt 含 note/target/bbox/imagePath，不含 strokes；`list_annotations/get_annotation` 只返回 summary；`create_delivery` 不自动带全部 open 标注。
- [ ] 总管工具：新增 6 个（create/list/get/enqueue delivery、list/get annotation）；`create_task` 支持 `annotationIds`；工具数 22→28；`SUPERVISOR_POLICY`、prompt、engine 接线快照同步；总管不能 approve/reject/resolve。
- [ ] 右栏：只保留精灵总管；无交付/产物/验收/标注 tab；可折叠；任务详情=StageSceneOverlay；产物=ArtifactViewerOverlay；验收=AcceptanceMatrixOverlay；标注=浮动列表；深链 `deliveryId/stageKey/artifactId/annotationId` 可直达。
- [ ] 画布对象：交付概览卡（视口固定）、阶段分组（`stageKey`/状态/产物数/标注数/折叠）、Agent 阶段卡、artifact 卡、闸门卡、验收矩阵卡、drawing 节点、标注层；阶段布局 `arrangeDeliveryCanvas` 可用；旧 workspace 画布仍可自由布局。
- [ ] 产物查看器：Markdown、图片、HTML sandbox iframe（无 same-origin/顶层导航）、PDF、未知类型；按需挂载；Esc 关闭；SVG 只当图片；关闭销毁。
- [ ] Excalidraw：独立 lazy chunk；主包不包含 `@excalidraw`；打开/保存/关闭；缩略图；`.excalidraw`+PNG/SVG；暗色；图片上传/受限 data URL；bundle 断言有测试。
- [ ] 快速标注层：笔/高亮/橡皮/颜色/粗细/撤销/清空；快捷键 `P/H/E`、`Esc`；debounce 持久化；resolved 默认隐藏；单标注 ≤2MB、单阶段 ≤200 条；iframe 抓不到时退化为笔迹 PNG + 目标路径 + note。
- [ ] 验收矩阵：用户故事/验收标准/怎么验三列；AC 类型标签（命令/文件/人工/截图）；闸门按钮在卡上；交付 done 生成 `delivery-report.md` artifact。
- [ ] skill：`.baton/skills/<id>/SKILL.md` 只引用不复制；阶段 prompt 注入 id/path/summary；workspace 未信任不注入；缺失/未信任状态在阶段 summary/UI 可见；≤64KB；不执行 skill 内容。
- [ ] 移动端：交付列表/详情/审批/验收/产物预览；无画布、无标注绘制、无画板编辑；现有移动端任务/总管不回归。
- [ ] 安全：路径穿越/软链/MIME 伪装/超大文件/HTML sandbox/SVG/skill trust/auto gate 越权均有测试或可计算断言；日志/审计不含绝对路径、token、transcript、diff 正文。
- [ ] 测试：core 单测与快照；protocol round-trip；daemon 集成（真实临时 DB + fake/脚本适配器）；web 组件；Playwright 4 阶段 + 标注 + 画板 + 右栏；ego-lite + 真实 Claude 一条需求阶段 + 一条标注链路；`pnpm verify` 与 `pnpm verify:full` 通过。
- [ ] 文档：spec/ADR/contract/plan/evidence/`docs/README.md` 更新；新增依赖更新 `THIRD_PARTY_NOTICES.md`；`Design.md` 无新增 token（若新增必须先改）；新增源码无 TODO/FIXME。
- [ ] 工程：`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 通过。
- [ ] 负空间：不新增 xterm/终端/子代理树/PTY 接管、外部 Source、PR/关单、视觉回归、多人、多 worker、DAG、Codex/zsh、artifact 历史；grep/测试证明未越界。

## Boundary Conditions

- **Must support**：单 workspace；host-native Claude SDK；旧独立任务/旧 workspace 画布；现有移动端；单用户本地 SQLite。
- **Must not break**：任务状态机与转移语义；`task.status` 单写者；`assembleContext` 的预算/深度/敏感路径规则；现有 22 个总管工具行为；审批/提问/verify/diff/worktree/AC；`node`/`edge` 既有列；旧 review/acceptance。
- **Must not leak**：transcript、diff 正文、文件正文、strokes、绝对路径、token、用户身份信息进入总管/日志/审计/PR。
- **Performance**：Excalidraw 独立 chunk；主包不包含；50 节点画布拖拽不卡；单阶段 200 条标注可开关；交付列表批量查询；prompt 字符数不超过当前预算 +15%。
- **Compatibility**：旧 `canvas.delivery_id=null`、旧 `task.delivery_id=null`；旧 `GroupNode.data` 无 `stageKey`；旧客户端忽略未知 `delivery.updated/artifact.updated/annotation.updated` 事件。

## Acceptance Criteria

### Computational

- `pnpm verify`：typecheck / lint / format / boundaries / protocol / 单测 / build 全绿。
- `pnpm verify:full`：Playwright 全绿。
- `pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿。
- migration 0015 空库/旧库升级 + 回滚测试；旧 canvas/task 读取测试。
- core 快照：playbook 校验、交付/阶段状态矩阵、stage prompt、annotation block、delivery canvas layout。
- 工具快照：28 个工具全部接线；prompt 字符数上限 +15%。
- bundle 断言：主 chunk 不含 `@excalidraw`；Excalidraw 在独立 chunk。
- 安全测试：路径穿越/软链/MIME/大小/sandbox/SVG/auto gate。
- `grep -RIn "TODO\|FIXME"` 在本次新增源码范围内为空。

### Inferential

- 代码审查逐条对照 spec D1-D15 与 DoD；偏离先改 spec/实现，不静默漂移。
- ego-lite 真实链路：创建交付 → 需求阶段读 skill → 产物 → 人工通过；标注 → 总管 `list_annotations` → 任务 → worker 读合成图 → 通过 resolved；截图脱敏附证据。
- 至少两名评审者（或作者自审 + code review）确认：总管不能 approve/reject；auto gate 有审计且最后阶段 human；右栏只有总管。
- 手动 UX 走查：从交付卡到产物/闸门/标注不超过两次点击；画布未因卡片/标注过载而不可用。

## Negotiation Record

- **Generator round 1**：提出 18 条 DoD，覆盖 migration、交付/画布、playbook、阶段、闸门、状态、artifact、annotation、总管工具、右栏、画布对象、查看器、Excalidraw、标注层、验收、skill、移动端、安全。
- **Evaluator round 1**：指出 10 个缺口——交付状态优先级未给矩阵；auto gate 的触发者/守卫/kill switch 未写死；标注 note 为空的行为不明确；artifact 同名覆盖/version 语义不清；右栏“只有总管”没有可测断言；Excalidraw 懒加载没有 bundle 断言；HTML sandbox 没有 no-same-origin/顶层导航约束；旧 canvas/task/standalone 兼容未列；28 工具与 prompt 预算没有快照；负空间（xterm/外部/DAG）没有检查。
- **Generator round 2**：把 DoD 扩到 23 条；补状态矩阵、auto gate 守卫与审计、note 为空先问、artifact 覆盖/version、右栏无 tabs 断言、bundle 断言、sandbox 约束、兼容矩阵、工具/prompt 快照、负空间 grep；补 Boundary Conditions 与计算/推断两类传感器。
- **Evaluator round 2**：接受修订版；没有新的阻塞挑战。保留监督点：每个切片结束重跑 `pnpm verify`；最后统一跑 `pnpm verify:full` + `pnpm pack:check`；右栏收敛与标注语义在 code review 中单独复核。
