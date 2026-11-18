# Sprint Contract: M1-6b 画布上下文与关系

> 关联 spec：`docs/specs/2026-11-18-m1-6b-canvas-context-design.md`
> 文档位置说明：本仓库 contract 落 `docs/contracts/`，不使用 `docs/agent-harness/contracts/`。

## Outcome（用户视角）

我在画布上选中几份需求/设计稿、用连线标出它们之间的关系，打开 Agent 节点建任务时，这些节点以 chips 出现并可增删；开工后 Agent 能看到节点内容和关系。任务创建后，我在详情里能核对注入了哪些节点、排除了哪些、关系是否被截断，确认无误再点「立即开工」。删节点时会连同连线一起清理，但被任务引用的节点仍会被拦住。

## Definition of Done

- [ ] **1. 边命令契约**：`ClientCommand` 增加 `edge.create { sourceId, targetId, type? }` 与 `edge.delete { edgeId }`；`type` 省略时默认 `context`，其他值在协议解析层拒绝；成功 ack 分别为 `{ edgeId }` 与 `{}`。
- [ ] **2. 边校验与唯一性**：`edge.create` 对不存在端点返回 `node_not_found`（details 含 `nodeIds`）、跨画布返回 `edge_cross_canvas`、自环返回 `edge_self_loop`、同向重复返回 `edge_duplicate`；反向边（A→B 与 B→A）允许；DB 唯一索引 `(canvas_id, source_id, target_id, type)` 兜底并发。
- [ ] **3. 边删除语义**：`edge.delete` 删除指定边并 ack `{}`；不存在返回 `edge_not_found`；删除边不修改任何已存在任务的 `prompt` 或 `context_json`。
- [ ] **4. 快照协议**：`ContextSnapshot`、`ContextNodeRef`、`ContextDropped`、`ContextRelation`、`DropReason` 从 `packages/protocol/src/context.ts` 导出；`TaskDetail = Task.extend({ context: ContextSnapshot.nullable() })`；`TaskDetailResponse.task` 使用 `TaskDetail`。
- [ ] **5. 列表不变**：`TaskSummary` 与 `GET /api/tasks` 的形状不变，响应项不包含 `context` 字段；`GET /api/tasks/:id` 返回的 `task.context` 存在（旧任务为 `null`）。
- [ ] **6. 迁移 0005**：`task.context_json` nullable；迁移先去重同 `(canvas_id, source_id, target_id, type)` 的边，再建唯一索引；fixture DB 升级测试覆盖「含重复边 → 迁移成功且索引存在」。
- [ ] **7. 关系范围**：`assembleContext` 返回 `relations` 与 `relationsTruncated`；候选边满足 `sourceId` 或 `targetId` 属于 `included ∪ {targetNodeId}`；目标 Agent 不作为内容注入，但直接连到它的边必须出现在关系列表。
- [ ] **8. 关系渲染**：仅当关系非空时输出 `<relations>`；未截断时不输出 `truncated` 属性，截断时输出 `<relations truncated="true">`；每条边固定属性顺序 `from, to, type, from_title, to_title`；所有 title 做 XML 转义；无内容泄漏给未注入端点（只给 title）。
- [ ] **9. 排序与预算**：关系按「两端都注入优先，其次 `from`、`to`、`type` 升序」；最多 200 条，且每条 `<edge .../>` 行的 UTF-16 长度之和（不含缩进与换行）不超过 4000；4k 字符边界行为测试通过；200 条为防御上限，由 `RELATION_LIMITS` 常量断言锁定；关系字符不占用内容 48k 预算。
- [ ] **10. 标题规则**：text 取首个非空行截 60 字符；file 取 `data.name`；image 取 `data.alt ?? 'image'`；agent 取 `data.title`；group 取 `data.label`；review 回落 `review`；快照 `included` 的 `title` 与 prompt 中 `<node title>` 一致。
- [ ] **11. 快照内容**：`included` 含 `id/type/title/depth/chars`；`dropped` 含 `reason` 与可选 `title`；`redactedPaths` 保留相对路径；`relations` 含 `from/to/type/fromTitle/toTitle/includedFrom/includedTo`。
- [ ] **12. daemon 边服务**：新增 `edge-service`，`runtime/index.ts` 只做命令分发；创建/删除均在事务内完成；并发重复插入由唯一索引兜底并映射为 `edge_duplicate`。
- [ ] **13. 任务快照写入**：`task.create` 用同一次 `assembleContext` 结果写 `context_json`，不重新读画布、不二次计算；prompt 中出现的注入节点 id 与快照 `included` 完全一致。
- [ ] **14. 快照读取降级**：旧任务 `context_json` 为 `NULL` 时详情返回 `context: null`；非法 JSON 或 schema 不匹配时返回 `null` 并记录 `context_snapshot_invalid` 警告，详情其余字段正常。
- [ ] **15. 删节点级联**：`node.delete` 同事务删除该节点的全部边后再删节点；被任务引用仍返回 `node_in_use / task`；原「被边引用」拦截与其测试同步移除/更新。
- [ ] **16. 选择模型**：画布支持 Shift 框选与 Cmd/Ctrl 点击多选；`selectedNodeIds` 反映当前选择；`contextNodeIds` 为粘性选择，仅当选择包含 text/file/image/group 时更新，选择为空或只有 Agent/Review 时保留旧值；存在显式「清空」。
- [ ] **17. 建任务 chips**：`CreateTaskForm` 读取粘性选择并过滤目标 Agent；chips 显示类型 + 标题、可单个移除、显示数量；提交发送真实 `contextNodeIds`；空选择显示框选引导；测试断言 WS payload。
- [ ] **18. 画布连线**：所有节点类型可连接；`isValidConnection` 拒绝自环与同向重复；`onConnect` 发 `edge.create`，ack 后重拉画布，失败 toast 且不插入乐观边；边可通过 Delete/Backspace 或选中后的「删除连线」按钮删除，删除走 `edge.delete`。
- [ ] **19. 详情快照 UI**：详情页显示注入数/排除数/字符总数/截断状态；列出注入项、排除原因、关系徽标（两端注入/仅一端/目标）、敏感路径；旧任务显示未记录；坏快照显示不可用；键盘可达、焦点可见、状态不只靠颜色、只用 `DESIGN.md` token。
- [ ] **20. 测试与证据**：core 快照测试覆盖范围/排序/转义/预算/标题；daemon 测试覆盖边校验/唯一性/级联/快照写入与降级；web 测试覆盖粘性选择/chips/连线/详情；Playwright 新增 `apps/web/e2e/canvas-context.spec.ts`（route-mocked）断言 `contextNodeIds` 与详情快照；ego-lite 真实 Claude 用 `ALPHA-42`/`BETA-17` 两个文本节点 + 一条关系跑通，transcript 同时出现两个标记，快照显示 2 个注入 + 1 条关系，证据落 `docs/evidence/2026-11-18-m1-6b-canvas-context/`。
- [ ] **21. 全量质量**：`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；改动范围源码无 `TODO`/`FIXME`；无新增依赖（如有则更新 `THIRD_PARTY_NOTICES.md`）；`docs/README.md` 的 spec/contract/plan 索引完整互链。

## Boundary Conditions

- **Must support**：Node 22 与 24；React 19；Chrome（Playwright `channel: 'chrome'`）；桌面 1280px+；`127.0.0.1` + token 模式；单用户单 daemon。
- **Must not break**：M1-5/M1-5a/M1-6a/M1-7a/M1-7c 的 REST/WS 契约；`task.status` 单写者；auth cookie；路径 jail；verify 环境；敏感文件排除；现有测试（除本 contract 明确变更的 `node.delete` 边拦截、`TaskDetailResponse.task` 类型、`DropReason` 上移）。
- **Performance**：50 节点 / 100 边画布可交互；关系 200 条 / 4000 字符上限生效；prompt 总长仍受内容 48k + 关系 4k 约束；画布拖动无新增明显卡顿。
- **Security / Privacy**：快照只记录画布节点标题、相对路径与关系，不记录文件内容或凭据；敏感文件内容永不进入 prompt；截图与证据脱敏，不写真实绝对路径、身份或 token。
- **Scope**：只改 `packages/protocol/**`、`packages/core/src/context/**`、`apps/daemon/**`、`apps/web/**`、migration、lockfile、`docs/**`；不改状态机语义；不做运行中 `context.inject`、typed edges、`canvas.patch`、总管、M1-7b。

## Acceptance Criteria

### Computational

以下命令均以退出码 0 为准：

```bash
pnpm verify
pnpm verify:full
pnpm pack:check
pnpm check:boundaries
pnpm check:protocol
pnpm format:check
pnpm exec playwright test apps/web/e2e/canvas-context.spec.ts
```

补充检查：

```bash
grep -RIn "TODO\|FIXME" packages/protocol/src packages/core/src/context apps/daemon/src apps/web/src   # 输出为空
grep -RIn "context_json" apps/daemon/migrations/0005_*.sql                                             # 命中列与索引
```

### Inferential

- 人工对照 spec §6-§8：关系范围、渲染格式、排序与预算、粘性选择、chips、连线删除、详情快照逐项一致。
- 人工对照 spec §9：错误码与降级路径与表格一致。
- 人工对照 `DESIGN.md`：详情快照与画布新增控件使用 token、焦点可见、键盘可达、状态不只靠颜色。
- 人工评审范围：没有提前实现 `context.inject`、typed edges、`canvas.patch`、总管或 M1-7b；没有改状态机语义。
- 人工评审证据：ego-lite 截图与 README 已脱敏；`ALPHA-42`/`BETA-17` 在 transcript 中同时出现；快照计数与关系数正确。

## Negotiation Record

**Round 1 — Generator（初版，11 条）**

1. 加边命令与校验。
2. 加快照 schema 与详情字段。
3. 加迁移与唯一索引。
4. core 关系渲染与预算。
5. daemon 边服务与任务快照。
6. 删节点级联。
7. web 多选与粘性选择。
8. 建任务 chips。
9. 画布连线与删除。
10. 详情快照 UI。
11. 测试、e2e 与真实证据。

**Round 1 — Evaluator（挑战）**

- 「加边命令」不可测：必须写明 ack 形状、错误码、反向边是否允许、并发重复如何兜底。
- 「快照 schema」缺少 `title` 自包含、旧任务与坏 JSON 行为、列表是否受影响。
- 「关系渲染」缺少范围定义（目标 Agent 不算内容但关系必须保留）、属性顺序、转义、空关系行为。
- 「预算」不可测：必须定义 200/4000 的边界、字符如何计数、是否占内容预算。
- 「多选/粘性」不可测：必须定义哪些类型算内容、点到 Agent 时是否保留、如何清空。
- 「连线」缺少乐观更新策略、失败行为、键盘删除与可访问性。
- 「测试与证据」缺少 Playwright 文件名、断言对象、真实链路的可判定标记。

**Round 2 — Generator（修订，21 条）**

- 写明命令 ack、错误码、反向边允许、唯一索引兜底。
- 写明 `TaskDetail`、旧任务 null、坏 JSON 降级、列表不带 `context`。
- 写明关系范围 `included ∪ target`、属性顺序、转义、空关系、未注入端点只给 title。
- 写明 200/4000 边界、UTF-16 行长度、独立于 48k。
- 写明粘性选择的内容类型、Agent/Review 不清空、显式清空。
- 写明不插入乐观边、失败 toast、Delete/Backspace 与按钮删除。
- 写明 Playwright 文件、`contextNodeIds` 断言、ego-lite 标记与证据目录。

**Round 2 — Evaluator（再次挑战）**

- 「同向重复」与「反向边」必须分开写，否则实现会误拒反向边。
- 「prompt 与快照一致」必须可验证：注入节点 id 必须与快照 `included` 完全一致。
- 「关系字符不占内容预算」必须明确，否则两个实现都能自称正确。
- 「坏 JSON」必须写明 JSON 语法错误与 schema 不匹配都降级。
- 「删节点级联」必须写明同事务与任务引用仍拦截。
- 「全量质量」必须包含 `pack:check` 与无新增依赖的说明。
- 证据标记必须是固定字符串（`ALPHA-42`/`BETA-17`），不能依赖主观判断「引用到了」。

**Round 3 — Generator（最终，21 条）**

- 按上述挑战逐条写成可验证的 21 条 DoD。
- 明确同向重复/反向边、prompt-快照一致性、字符计数口径、坏 JSON 双分支、级联事务。
- 明确 Playwright 文件与断言、ego-lite 固定标记、证据目录与脱敏。
- 明确全量命令、`pack:check`、无新增依赖与文档互链。

**Final consensus**：21 条 DoD，3 轮 generator-evaluator，无剩余挑战。验收以命令退出码、Playwright 结果、ego-lite 证据与人工对照 spec 为准。
