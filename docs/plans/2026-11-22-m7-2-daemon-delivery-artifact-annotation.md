---
spec_ref: ../specs/2026-11-22-m7-delivery-playbook-design.md
spec_topic: m7-delivery-playbook
task_count: 8
estimated_phases: [tests, implementation, verification]
dod: "daemon delivery/artifact/annotation service、REST、事件、阶段推进、总管 6 工具；daemon 集成测试与 pnpm verify 全绿"
status: active
depends_on: 2026-11-22-m7-1-protocol-core-migration.md
---

# M7 Plan 2：Daemon 交付、产物与标注

> 依赖 M7-1 的 protocol/core/migration 0015。
> 对应 spec：`docs/specs/2026-11-22-m7-delivery-playbook-design.md` §7。
> 执行图：`docs/plans/2026-11-22-m7-0-execution-map.md`。

**Goal:** 在 daemon 里把“交付 → 阶段 task → 产物 → 标注 → 阶段推进”跑通；REST/事件/总管工具可用，M7-3 可以直接接画布。

**Architecture:** repositories 先落表读写；delivery service 负责 playbook 快照、建画布/阶段/task、enqueue/cancel/advance；artifact/annotation service 负责文件与元数据；REST 薄路由；总管工具调用同一批 service。

**Tech Stack:** TypeScript ESM、Fastify 5、Drizzle/better-sqlite3、zod 4、yaml（ISC）、vitest。

**Design sync:** 本计划不做 UI；REST/事件字段必须对齐 spec §8，M7-3 直接消费。

**Contract mapping:** DoD 2/3/4/5/6/7/8/9/10/20。

**Commit strategy:** 每 task 一次 commit；分支 `feat/m7-2-daemon-delivery`。

---

### Task 1: Repositories 读写道

**Files:**
- Modify: `apps/daemon/src/db/repositories.ts`
- Test: `apps/daemon/test/delivery-repositories.test.ts`

**Interfaces (produced):**
- `insertDelivery`, `getDelivery`, `getDeliveryByCanvas`, `listDeliveries`, `updateDelivery`, `setDeliveryCancelled`
- `insertArtifact`, `upsertArtifact`, `getArtifact`, `listArtifactsByDelivery`, `listArtifactsByStage`, `updateArtifactStatus`
- `insertAnnotation`, `getAnnotation`, `listAnnotations`, `updateAnnotation`, `resolveAnnotationsForTask`
- `getCanvasByDelivery`, `setCanvasDelivery`

- [ ] 写失败测试：建 workspace/canvas → 建 delivery/artifact/annotation → 读回字段与状态；旧 canvas/task `deliveryId=null`。
- [ ] 实现 repositories；JSON 字段 `JSON.parse` 失败按空值兼容；所有写操作在事务内。
- [ ] `pnpm --filter @evanfang0054/baton test -- delivery-repositories` 通过。
- [ ] commit `feat(daemon): add delivery artifact annotation repositories`.

### Task 2: Playbook loader + Delivery service

**Files:**
- Create: `apps/daemon/src/delivery/playbook.ts`
- Create: `apps/daemon/src/delivery/service.ts`
- Modify: `apps/daemon/package.json`（`yaml`）
- Test: `apps/daemon/test/delivery-service.test.ts`

**Interfaces:**
- `loadPlaybook(workspacePath, id): { ok, playbook } | { ok:false, error }`；读 `.baton/playbooks/<id>.yml|yaml`，缺省返回内置 `standard-delivery`。
- `createDelivery({workspaceId,title,goal,playbookId,contextNodeIds,engine,budgetUsd})`
- `listDeliveries(workspaceId, filters)`、`getDeliveryDetail(id)`、`enqueueDelivery(id)`、`cancelDelivery(id, reason?)`

- [ ] 写失败测试：内置 playbook 建交付 → canvas + 4 个 stage group + 第一阶段 task(todo)；playbook 快照；不自动开工；重复 enqueue 拒绝；cancel 不改 artifact。
- [ ] 实现 `standard-delivery` 常量、YAML loader、service；事务内建 canvas/delivery/group/agent/task；写 audit。
- [ ] `pnpm --filter @evanfang0054/baton test -- delivery-service` 通过。
- [ ] commit `feat(daemon): create delivery from playbook`.

### Task 3: Stage task 与 skill

**Files:**
- Create: `apps/daemon/src/delivery/stage-task.ts`
- Create: `apps/daemon/src/delivery/skill.ts`
- Test: `apps/daemon/test/delivery-stage-task.test.ts`

**Interfaces:**
- `resolveSkill(workspacePath, skillId): { status:'ok', path, summary } | { status:'missing' } | { status:'disabled_untrusted' }`
- `createStageTask({ delivery, stage, previousStageKey? })`：建 agent node + task；prompt 用 core `buildStagePrompt` + `assembleContext`；写 `deliveryId/stageKey`。

- [ ] 写失败测试：需求阶段 prompt 含 goal/produces/acceptance/skill；skill 缺失/未信任不阻断；任务带 deliveryId/stageKey。
- [ ] 实现；skill 只读 `.baton/skills/<id>/SKILL.md` 头部，≤64KB，jail。
- [ ] commit `feat(daemon): create stage tasks with skills`.

### Task 4: Artifact service

**Files:**
- Create: `apps/daemon/src/artifact/service.ts`
- Test: `apps/daemon/test/artifact-service.test.ts`

**Interfaces:**
- `checkRequiredArtifacts(deliveryId, stageKey): { ok:true, artifacts } | { ok:false, missing }`
- `createDraftArtifact`, `saveArtifactContent`, `readArtifactContent`, `listArtifacts`
- 路径用 core `artifactPath`；jail + realpath；sha256；version；MIME 白名单；≤10MB。

- [ ] 写失败测试：必产物缺失返回 missing；成功后 artifact ready/sha256/version；同名保存 version+1；路径穿越拒绝。
- [ ] 实现；写 audit；广播 `artifact.updated`。
- [ ] commit `feat(daemon): add artifact service`.

### Task 5: Annotation service

**Files:**
- Create: `apps/daemon/src/annotation/service.ts`
- Test: `apps/daemon/test/annotation-service.test.ts`

**Interfaces:**
- `createAnnotation`（PNG base64、strokes、note、targets）
- `updateAnnotation`（note/status）
- `listAnnotations(deliveryId, stageKey?, status?)`
- `getAnnotationForSupervisor(id)`
- `resolveAnnotationsForTask(taskId)`

- [ ] 写失败测试：note ≤2k、strokes ≤2MB、PNG ≤10MB；target 校验；创建/更新/列表；审批后 resolved；打回保持 open；supervisor 读不到 strokes。
- [ ] 实现；PNG 写 `.baton/deliveries/<id>/<stage>/annotations/<id>.png`；audit/事件。
- [ ] commit `feat(daemon): add annotation service`.

### Task 6: REST + events 接线

**Files:**
- Create: `apps/daemon/src/http/deliveries.ts`
- Create: `apps/daemon/src/http/artifacts.ts`
- Create: `apps/daemon/src/http/annotations.ts`
- Modify: `apps/daemon/src/app.ts`
- Modify: `apps/daemon/src/http/canvas.ts`（可选 deliveryId）
- Test: `apps/daemon/test/delivery-rest.test.ts`

- [ ] 写失败测试：POST/GET 交付；enqueue/cancel；artifact list/content/save；annotation create/update/list；错误码。
- [ ] 实现薄路由；注入 service/broadcast/now/newId；auth 沿用现有。
- [ ] commit `feat(daemon): add delivery artifact annotation REST`.

### Task 7: 阶段推进、auto 闸门与总管工具

**Files:**
- Modify: `apps/daemon/src/delivery/service.ts`（advance/reject/auto）
- Modify: `apps/daemon/src/runtime/index.ts`（review decide 后推进）
- Modify: `apps/daemon/src/supervisor/tools.ts`
- Modify: `apps/daemon/src/supervisor/prompt.ts`
- Modify: `packages/core/src/supervisor/policy.ts`（28 工具）
- Test: `apps/daemon/test/delivery-advance.test.ts`、`apps/daemon/test/supervisor-delivery-tools.test.ts`

- [ ] 写失败测试：需求 approve → 设计 task 创建；设计 reject 不推进；开发 auto 仅在 AC pass + kill switch off；最后阶段 human；总管 6 工具 + create_task annotationIds；总管不能 approve。
- [ ] 实现 advance/reject/auto；review 决策后调用；工具接线与 prompt。
- [ ] commit `feat(daemon): advance delivery and add supervisor delivery tools`.

### Task 8: 全量验证与计划收口

- [ ] `pnpm --filter @evanfang0054/baton test`、`pnpm verify` 全绿。
- [ ] 更新 `docs/README.md` plan 索引与执行图状态。
- [ ] commit `docs(plan): complete M7-2 daemon delivery`.

---

## 收口检查

- [ ] delivery/artifact/annotation REST 与事件字段对齐 spec §5。
- [ ] 阶段 task 仍只经 core 转移函数改状态。
- [ ] 总管仍不能 approve/reject/resolve；auto 闸门有 audit + kill switch。
- [ ] 旧 canvas/task `deliveryId=null` 兼容。
- [ ] 没有 TODO/FIXME；没有越界实现 web 画布（M7-3）。
