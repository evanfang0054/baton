---
spec_topic: m7-delivery-playbook
decision_summary: "M7 交付工作台：一条需求一块画布、4 阶段 playbook、产物 files-first、标注一等上下文、Excalidraw 画板 + 快速标注、右栏只留总管；终端/子代理后置"
design_approved: true
user_approved_at: 2026-11-22T22:37:27+08:00
gates: [design-approved, user-review-passed]
spec_ref: 2026-11-16-baton-architecture-design.md
domain_terms:
  [
    delivery,
    delivery-canvas,
    stage,
    playbook,
    artifact,
    annotation,
    drawing,
    gate,
    skill,
    annotation-context,
    supervisor-only-panel,
  ]
---

# M7 交付工作台与 SOP 流程设计

> 子 spec。回链主架构：`docs/specs/2026-11-16-baton-architecture-design.md`。
> 前置：M1-M6-5 已合并 main；本 spec 把“任务调度驾驶舱”扩展为“需求到交付的 SOP 工作台”。
> 背景材料：`baton.ai/复刻CanvasAgents工作台.md`、`baton.ai/肝了一周…`、`baton.ai/dsh-superagent-prototype-架构拆解.md`、`baton.ai/images/**`（不进仓库，只作产品方向与 UI 参考）。
> 相关 ADR：`docs/adr/0011-delivery-owned-canvas.md`（交付拥有画布）。

## 0. 文档信息

- **状态**：设计已获用户逐项确认（2026-11-22）；UI v3 已确认“右栏只留总管，其余画布化”；spec 已获用户审阅通过（2026-11-22）；尚未实现。
- **范围**：`packages/protocol/**`、`packages/core/**`、`apps/daemon/**`、`apps/web/**`、数据库 migration 0015、测试与 `docs/**`。
- **预期不改**：任务状态列表与转移语义；`task.status` 单写者；`assembleContext` 的预算/深度/敏感路径规则；`node`/`edge` 表既有列；现有 22 个总管工具的行为；审批、提问、verify、diff、worktree、AC 的既有语义。
- **不在范围**：xterm/终端/子代理树/PTY 接管；外部 Source（GitHub/飞书）；自动 PR/关单；视觉回归；多人协作；一阶段多 worker；DAG；Codex/zsh；artifact 历史版本；标注线程/协作；移动端画布。
- **文档位置**：spec 落 `docs/specs/`，contract 落 `docs/contracts/`，plan 落 `docs/plans/`；仓库没有 `docs/agent-harness/` 与 `scripts/validate-handoff.sh`，按既有约定执行。
- **ADR**：新增 `docs/adr/0011-delivery-owned-canvas.md`，记录“画布归属从 workspace 移到 delivery，workspace 画布保留为 inbox/总览”。其余变更可回滚，不新增 ADR。
- **命名**：代码用 `delivery` / `task.stageKey`；UI 文案用“交付” / “阶段”，避免与现有“任务”混淆。阶段任务在 UI 里叫“阶段任务”。

## 1. 背景

M1-M6-5 已把“单任务闭环 + 总管任务管理”做实：画布上下文、真实 Claude 执行、审批/提问、verify/diff、worktree、retry/reopen、任务历史、总管建节点/建任务/开工/售后/批量/预验收、上下文注入、AC 合同与验收报告、总管自治与注意力。

但对照 `baton.ai/images` 与目标“在一个无限画布里面搞定从需求到交付的闭环”，当前产品仍有五个断层：

1. **流程没有一等公民**：只有 task + 4 个任务意图模板，没有“需求 → 设计 → 开发 → 验收”的阶段链、playbook、阶段闸门。
2. **画布不是产物工作台**：`text` 是便签、`file` 只有路径、`image` 只能看；没有 artifact 实体、没有 Markdown/HTML/PDF/画板查看、没有标注。
3. **验收只覆盖代码**：verify + AC 只针对代码任务；需求/设计产物没有必产物检查、没有验收矩阵。
4. **组织维度停在任务**：看板、attention、digest、预算都是 task 级；没有 delivery 视图、没有阶段进度和交付 lead time。
5. **右栏信息竞争**：总管、任务详情、产物、验收、标注挤在右栏；用户注意力被切碎。

本迭代把 `baton.ai` 里最稳定的三条落到 baton：

- **项目 → 交付（一块画布）→ 阶段（一个 session）**：任务生命周期比 session 长；一条需求一块画布。
- **画布是共享内存与交付档案**：需求、spec、原型、设计、实现、验收证据、标注都在同一块画布上。
- **总管只调度、不过闸门**：总管负责分诊、建交付、派阶段、查状态、列标注、出计划；人负责说清楚、看产物、拍板。

同时按用户 UI 反馈收敛右栏：**右栏只保留精灵总管**；交付、产物、验收、标注全部变成画布对象或画布覆盖层。

## 2. 目标与非目标

**目标**

1. 新增 `delivery` 聚合：一条需求一个交付，拥有独立画布；workspace 画布保留为 inbox/总览。
2. 新增 playbook：仓库内 `.baton/playbooks/*.yaml` 定义阶段、产物、闸门、skill；创建交付时快照，内置 `standard-delivery` 4 阶段。
3. 阶段任务复用现有 `task`：一个阶段一个 task/session；阶段串行；交付状态从阶段任务推导。
4. 新增 `artifact`：workspace 文件为真源，DB 存元数据；画布 `artifact` 节点只引用；必产物检查进入 verify 路径。
5. 新增 `annotation`：strokes + note + target + bbox + 合成 PNG；总管可查询；任务携带 `annotationIds`；通过自动 resolved。
6. 新增绘图：Excalidraw 全屏画板（懒加载）+ perfect-freehand 快速标注层；统一 `.excalidraw` + PNG/SVG 产物。
7. 新增画布对象：交付概览卡、阶段分组、Agent 阶段卡、产物卡、闸门卡、验收矩阵卡、标注层、画板节点。
8. 右栏收敛：只保留精灵总管；任务详情、产物、验收、标注改为画布覆盖层；总管链接可定位/展开画布对象。
9. 新增总管工具：`create_delivery`、`list_deliveries`、`get_delivery`、`enqueue_delivery`、`list_annotations`、`get_annotation`；`create_task` 支持 `annotationIds`。
10. 覆盖 core 单测、protocol 测试、daemon 集成、web 组件、Playwright 与 ego-lite + 真实 Claude 验收。

**非目标**

- xterm/终端/子代理树/PTY 接管；本迭代后置，单独 spec/ADR。
- 外部 Source、自动 PR/关单、视觉回归、多人协作、一阶段多 worker、DAG、Codex/zsh。
- 自动通过人工闸门；总管不能 approve/reject。
- artifact 历史版本、标注线程/回复、跨交付标注。
- 移动端画布、移动端绘图。
- 画布自由绘图之外的完整白板能力（如流程图执行、脚本化图形）。
- 任务级独立画布表；delivery 画布是唯一新增画布归属。

## 3. 关键决策

| #   | 决策             | 结论                                                                                                   | 理由                                                                 |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| D1  | 画布归属         | delivery 拥有画布；workspace 画布保留为 inbox/总览；旧 canvas `delivery_id=null`                        | 一条需求一块画布；增量迁移不丢旧数据；见 ADR 0011                     |
| D2  | 流程单元         | 一条需求一个 delivery；阶段是现有 task；一阶段一个 session；阶段串行                                    | 复用状态机/验收/attention；不引入 DAG                                |
| D3  | Playbook         | `.baton/playbooks/*.yaml`；创建时快照到 delivery；内置 `standard-delivery` 4 阶段                       | 可版本化、可分享；快照保证旧交付不被 playbook 变更影响                |
| D4  | 阶段闸门         | 阶段闸门 = 该阶段 task 的 review 决策；`human` 人点；`auto` daemon 系统转移 + 审计 + kill switch        | 复用现有 review；auto 不绕过验收证据；总管不能代过                    |
| D5  | 交付状态         | 从阶段任务推导，不单独存；`cancelled > done > waiting_person > running > blocked > draft`              | 状态不存、由事实推导；与“谁最需要人，谁说了算”一致                    |
| D6  | 产物真源         | workspace 文件 + `artifact` 元数据；画布节点只引用；v1 只保留 latest，`version/sha256` 记录             | Agent 可直接读写、git 可版本化；避免大 JSON 进 DB                     |
| D7  | 标注             | 一等上下文：`annotation` 表；strokes + note + target + bbox + 合成 PNG；总管可查；任务带 `annotationIds` | 标注要驱动派活；只靠画布笔迹总管无法知道改什么                        |
| D8  | 绘图             | Excalidraw 全屏画板（懒加载）+ perfect-freehand 快速标注层；统一 artifact                               | 复用成熟画板；不抢 React Flow 手势；快速标注不加载重包                |
| D9  | 右栏             | 只保留精灵总管；交付/产物/验收/标注改为画布对象 + 覆盖层                                                | 收敛注意力；参考图也是“画布为主、右栏聊天”                            |
| D10 | Skill            | `.baton/skills/<id>/SKILL.md` 只引用不复制；阶段 prompt 注入名称/路径/摘要；Agent 自己 Read             | 保留渐进披露；不绑定 Claude Code 目录布局；workspace trust 兜底        |
| D11 | 验收             | 复用 AC/verify；新增必产物检查；④ 验收组矩阵卡；不做视觉 diff                                          | 复用既有证据链；非代码产物先做存在/结构/人工验收                      |
| D12 | 兼容             | 旧 canvas/task `delivery_id=null`；旧任务独立；旧画布 inbox；现有 22 个总管工具不变                     | 增量迁移；不迫使旧数据迁移；降低回滚风险                              |
| D13 | 安全             | 路径 jail、MIME/大小上限、HTML sandbox、SVG 当图片、无远程抓取、auto 闸门审计、kill switch              | 产物/标注是新的外部输入面；不能开通用文件/网络面                      |
| D14 | 性能             | Excalidraw 懒加载；artifact 卡只渲染缩略图；覆盖层按需挂载；标注层限流/限量；大画布降级                 | 参考图的 xterm/大画布性能坑不重演；节点保持轻                          |
| D15 | 后置             | xterm/终端/子代理树/PTY 接管、外部 Source、PR、视觉 diff、多人、多 worker、DAG、Codex/zsh、artifact 历史 | 先跑通站内交付闭环；终端与外部集成单独设计                            |

## 4. 领域模型与数据结构

### 4.1 Delivery

```ts
export const DeliveryStatus = z.enum([
  'draft',
  'running',
  'waiting_person',
  'blocked',
  'done',
  'cancelled',
])

export const Delivery = z.object({
  id: Id,
  workspaceId: Id,
  canvasId: Id,
  title: z.string().min(1).max(200),
  goal: z.string().max(2000),
  playbookId: z.string().min(1).max(64),
  playbookVersion: z.number().int().positive(),
  playbookJson: z.string(), // 创建时快照；API 详情里解析为 Playbook
  createdAt: Timestamp,
  updatedAt: Timestamp,
  cancelledAt: Timestamp.nullable(),
})
```

`DeliverySummary` 在 `Delivery` 上派生：

- `status: DeliveryStatus`
- `currentStageKey: string | null`
- `stageProgress: { done: number; total: number }`
- `attention: Attention`
- `waitingSince: Timestamp | null`
- `openAnnotationCount: number`

`DeliveryDetail` 在 `DeliverySummary` 上增加：

- `playbook: Playbook`
- `stages: StageSummary[]`
- `artifacts: Artifact[]`
- `annotations: AnnotationSummary[]`

### 4.2 Stage

阶段不是新表；由 `delivery.playbookJson` + `task.stageKey` 推导。

```ts
export const StageStatus = z.enum([
  'pending',
  'running',
  'waiting_person',
  'done',
  'failed',
  'cancelled',
])

export const StageSummary = z.object({
  key: z.string(),
  label: z.string(),
  ordinal: z.number().int().positive(),
  gate: z.enum(['human', 'auto']),
  status: StageStatus,
  taskId: Id.nullable(),
  taskStatus: TaskStatus.nullable(),
  attention: Attention,
  waitingSince: Timestamp.nullable(),
  artifactCount: z.number().int().nonnegative(),
  openAnnotationCount: z.number().int().nonnegative(),
  skillId: z.string().nullable(),
  skillStatus: z.enum(['ok', 'missing', 'disabled_untrusted']).nullable(),
})
```

推导规则：

| task.status | stage.status |
| --- | --- |
| 无 task / `todo` | `pending` |
| `queued` / `running` / `verifying` | `running` |
| `waiting_input` / `review` | `waiting_person` |
| `done` | `done` |
| `failed` | `failed` |
| `cancelled` | `cancelled` |

阶段串行：创建第 N 阶段任务前，第 N-1 阶段必须 `done`；`pending` 的下一阶段在投产后由人点“开工”。

### 4.3 Delivery 状态推导

```ts
function deriveDeliveryStatus(input: {
  cancelled: boolean
  stages: StageSummary[]
}): DeliveryStatus
```

优先级：

1. `cancelled` → `cancelled`
2. 全部 `done` → `done`
3. 任一 `waiting_person`，或“前一阶段 done 且下一阶段 pending” → `waiting_person`
4. 任一 `running` → `running`
5. 任一 `failed` → `blocked`
6. 全部 `pending` → `draft`
7. 其余 → `running`（防御性兜底）

`currentStageKey` = 第一个非 `done`/`cancelled` 的阶段；全部完成时为 `null`。

### 4.4 Artifact

```ts
export const ArtifactKind = z.enum([
  'spec',
  'prototype',
  'design',
  'drawing',
  'report',
  'screenshot',
  'annotation',
  'other',
])

export const ArtifactStatus = z.enum(['draft', 'ready', 'accepted', 'rejected'])

export const Artifact = z.object({
  id: Id,
  workspaceId: Id,
  deliveryId: Id,
  stageKey: z.string(),
  taskId: Id.nullable(),
  kind: ArtifactKind,
  name: z.string().min(1).max(120),
  path: z.string().min(1), // workspace 相对路径，主文件/预览
  sourcePath: z.string().nullable(), // .excalidraw / 源文件
  svgPath: z.string().nullable(),
  mime: z.string().nullable(),
  size: z.number().int().nonnegative(),
  sha256: z.string(),
  version: z.number().int().positive(),
  status: ArtifactStatus,
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
```

规则：

- 路径固定：`.baton/deliveries/<deliveryId>/<stageKey>/<name>`；drawing 额外 `.excalidraw` / `.svg` 同目录。
- `name` 只允许 `[A-Za-z0-9._-]`，拒绝 `..`、绝对路径、软链逃逸。
- v1 只保留 latest：同名保存时覆盖主文件、`version += 1`、更新 `sha256/size`；旧版本不留存。
- `status`：产出时 `draft`；必产物检查通过后 `ready`；阶段通过后 `accepted`；打回后 `rejected`。
- 只有 playbook 声明的 `produces` 才登记 artifact；未声明的文件不自动入库。

### 4.5 Annotation

```ts
export const AnnotationStatus = z.enum(['open', 'resolved', 'dismissed'])

export const Annotation = z.object({
  id: Id,
  workspaceId: Id,
  deliveryId: Id,
  stageKey: z.string(),
  targetNodeIds: z.array(Id).max(20),
  targetArtifactId: Id.nullable(),
  note: z.string().max(2000),
  strokesJson: z.string(), // web 渲染用；<= 2MB
  bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  imagePath: z.string(), // 合成 PNG，workspace 相对路径
  status: AnnotationStatus,
  taskId: Id.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
})

export const AnnotationSummary = Annotation.pick({
  id: true,
  deliveryId: true,
  stageKey: true,
  targetNodeIds: true,
  targetArtifactId: true,
  note: true,
  bbox: true,
  imagePath: true,
  status: true,
  taskId: true,
  createdAt: true,
})
```

规则：

- 标注是“反馈/指令”，不是普通画布笔迹；必须有 `note` 才能派活；`note` 为空时总管先问，不猜。
- `targetNodeIds` / `targetArtifactId` 默认由 web 按 bbox 命中节点/产物；用户可改。
- `imagePath` 是“目标节点或视口 bbox + 笔迹”的合成 PNG；iframe 抓不到时退化为笔迹 PNG + 目标路径 + note。
- `strokesJson` 只给 web 渲染；总管工具与任务 prompt 不塞 strokes。
- 任务带 `annotationIds` 时，prompt 只带 `note/target/bbox/imagePath`。
- 任务通过后，`annotation.taskId = task.id` 的 open 标注自动 `resolved`；打回保持 `open`；用户可手动 `dismissed`。

### 4.6 Drawing

- `artifact.kind = 'drawing'`；主文件 `path` = PNG 预览；`sourcePath` = `.excalidraw`；`svgPath` = 可选 SVG。
- 画布新增 `drawing` 节点：`data: { artifactId, title, thumbnailPath, status }`。
- 双击节点打开全屏 `DrawingEditor`（Excalidraw，懒加载）；关闭自动保存。
- 画板与快速标注是两套工具：
  - **画板**：完整 Excalidraw 工具栏（形状/箭头/文本/图片/选择/图层/撤销/导出）。
  - **快速标注**：主画布 overlay，笔/高亮/橡皮/颜色/粗细/撤销/清空；用于圈重点与批注，不替代画板。

### 4.7 Playbook

文件位置：`<workspace>/.baton/playbooks/*.yaml` 或 `*.yml`。解析用 `yaml`（ISC；npm registry 查询 2026-11-22：版本以实现时锁定为准）。

```ts
export const PlaybookStage = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  label: z.string().min(1).max(40),
  skill: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).nullable().default(null),
  gate: z.enum(['human', 'auto']),
  produces: z
    .array(
      z.object({
        kind: ArtifactKind,
        name: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),
        required: z.boolean().default(false),
      }),
    )
    .max(8)
    .default([]),
  acceptance: z
    .object({
      checklist: z.array(z.string().min(1).max(200)).max(8).default([]),
      verify: z.boolean().default(true),
    })
    .default({ checklist: [], verify: true }),
})

export const Playbook = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  version: z.number().int().positive(),
  label: z.string().min(1).max(40),
  description: z.string().max(500).optional(),
  stages: z.array(PlaybookStage).min(1).max(8),
})
```

校验：

- 阶段 key 唯一；产物 name 在同阶段唯一；只允许安全文件名。
- 最后一个阶段 `gate` 必须是 `human`（最终验收不能自动通过）。
- playbook 不写任意命令；`acceptance.verify=true` 只表示走项目现有 verify 解析链。
- 创建交付时把解析后的 playbook JSON 快照进 `delivery.playbookJson`；后续文件变更不影响旧交付。
- 内置 `standard-delivery`：

| key | label | gate | produces | skill（示例） |
| --- | --- | --- | --- | --- |
| `requirement` | 需求 | human | `spec.md` | `requirement-grooming` |
| `design` | 设计 | human | `prototype.html`、`design.png` | `hi-fi-design` |
| `build` | 开发 | auto | `build-report.md` | `implement` |
| `acceptance` | 验收 | human | `acceptance.md` | `acceptance` |

skill 在仓库内不存在时不阻断创建：阶段显示 `skill_missing` 警告，prompt 不注入 skill；workspace 未信任时显示 `skill_disabled_untrusted`。

### 4.8 Skill

- 目录：`<workspace>/.baton/skills/<skillId>/SKILL.md`；不做复制、不做软链。
- 读取：daemon 在校验阶段引用时读取文件头（最多 4KB）解析 `name/description`；`SKILL.md` 最大 64KB；路径过 jail。
- 注入：阶段 prompt 只带 `<skill id path summary="..."/>`；Agent 用 Read 工具读全文。
- 未信任 workspace 不注入；阶段 summary 标 `disabled_untrusted`。
- skill 内容视为用户提供的指令，不执行、不解析其中的命令；任务 prompt 明示来源路径。

## 5. 协议与 API 变更

### 5.1 Protocol

新增：

- `packages/protocol/src/entities/delivery.ts`：`DeliveryStatus`、`Delivery`、`DeliverySummary`、`DeliveryDetail`、`StageStatus`、`StageSummary`。
- `packages/protocol/src/entities/artifact.ts`：`ArtifactKind`、`ArtifactStatus`、`Artifact`。
- `packages/protocol/src/entities/annotation.ts`：`AnnotationStatus`、`Annotation`、`AnnotationSummary`。
- `packages/protocol/src/playbook.ts`：`Playbook`、`PlaybookStage`、`PlaybookSummary`。
- `node.ts` 新增：
  - `ArtifactNode`：`type: 'artifact'`，`data: { artifactId, kind, title, path, thumbnailPath?, status }`。
  - `DrawingNode`：`type: 'drawing'`，`data: { artifactId, title, thumbnailPath?, status }`。
  - `GroupNode.data` 增加 `stageKey?: string`（可选，旧数据兼容）。
- `task.ts` 增加 `deliveryId: Id.nullable().default(null)`、`stageKey: z.string().nullable().default(null)`。
- `TaskDetail` 增加 `annotationIds: Id[]`（从 `task.annotation_ids_json` 解析，默认空）。
- `TaskDetailResponse` 增加 `annotations: AnnotationSummary[]`、`delivery: DeliverySummary | null`。
- `TaskSummary` 增加 `deliveryId`、`stageKey`（方便看板/任务视图）。
- `TaskCreateInput` 增加 `deliveryId?: Id`、`stageKey?: string`、`annotationIds?: Id[]`。
- `TaskCreateInput.contextNodeIds` 保持必填；阶段任务由 daemon 内部创建，不经过 web 的 `task.create`。

新增 WS 命令：无。交付、标注、产物全部走 REST（二进制/大 payload 更合适）；WS 只推 `delivery.updated` / `artifact.updated` / `annotation.updated` 事件。现有 `task.*` 命令保持不变。

- 交付 REST：`POST /api/deliveries`、`POST /api/deliveries/:id/enqueue`、`POST /api/deliveries/:id/cancel`。
- 标注 REST：`POST /api/deliveries/:id/annotations`、`PATCH /api/deliveries/:id/annotations/:annotationId`；含 PNG base64。
- 产物 REST：`POST /api/deliveries/:id/stages/:stageKey/artifacts`、`PUT /api/deliveries/:id/artifacts/:artifactId`。

新增服务端事件：

```ts
delivery.updated // { deliveryId, status, currentStageKey }
artifact.updated // { artifactId, deliveryId, stageKey, status }
annotation.updated // { annotationId, deliveryId, stageKey, status }
```

- 事件只用于查询失效/轻量更新；完整数据仍走 REST。
- 断线重放沿用现有 `ws_event` 的 `sinceSeq`；旧客户端忽略未知事件类型。

### 5.2 REST

新增 `apps/daemon/src/http/deliveries.ts`、`artifacts.ts`、`annotations.ts`：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/deliveries?workspaceId=&status=` | 交付列表/看板 |
| POST | `/api/deliveries` | 创建交付（playbook 快照 + 画布 + 第一阶段 task） |
| GET | `/api/deliveries/:id` | 交付详情（stages/artifacts/annotations/attention） |
| POST | `/api/deliveries/:id/enqueue` | 开工当前阶段 |
| POST | `/api/deliveries/:id/cancel` | 取消交付 |
| GET | `/api/deliveries/:id/artifacts` | 产物列表 |
| GET | `/api/deliveries/:id/artifacts/:artifactId/content` | 读取产物内容（文本/二进制） |
| POST | `/api/deliveries/:id/stages/:stageKey/artifacts` | 创建 draft artifact（画板/标注导出） |
| PUT | `/api/deliveries/:id/artifacts/:artifactId` | 保存画板源文件 + PNG/SVG |
| GET | `/api/deliveries/:id/annotations?stageKey=&status=` | 标注列表 |
| POST | `/api/deliveries/:id/annotations` | 创建标注 |
| PATCH | `/api/deliveries/:id/annotations/:annotationId` | 更新 note/status |
| POST | `/api/deliveries/:id/annotations/:annotationId/export` | 导出标注 PNG 为 artifact（可选） |

- `GET /api/canvas` 增加可选 `deliveryId`：有则返回交付画布，无则返回 workspace inbox 画布。
- 所有路径参数过 zod；错误沿用 `{ code, message, details? }`。
- 二进制保存请求体上限：artifact 10MB、annotation PNG 10MB、drawing JSON 5MB；超限返回 `payload_too_large`。
- `GET content` 只服务 `.baton/deliveries` 下、已登记的 artifact 路径；`Content-Type` 来自 DB 的 `mime`，不信任扩展名。

### 5.3 总管工具

现有 22 个工具不变；新增：

```ts
create_delivery({
  workspaceId: string,
  title: string,
  goal: string,
  playbookId?: string,
  contextNodeIds?: string[],
  engine?: 'claude-sdk',
  budgetUsd?: number,
})

list_deliveries({
  workspaceId: string,
  status?: DeliveryStatus,
  needsPerson?: boolean,
})

get_delivery({ deliveryId: string })

enqueue_delivery({ deliveryId: string })

list_annotations({
  deliveryId: string,
  stageKey?: string,
  status?: 'open' | 'resolved' | 'dismissed',
})

get_annotation({ annotationId: string })
```

- `create_task` 增加 `annotationIds?: string[]`；`plan_tasks` / `create_tasks` 的每个候选任务也支持 `annotationIds`。
- `create_delivery` 只建第一阶段 task（`todo`），不自动开工；`enqueue_delivery` 只接受 `todo`。
- 总管仍不能 `approve/reject`、不能 `resolve_annotation`、不能执行命令、不能读 transcript。
- 工具总数 22 → 28；更新 `SUPERVISOR_POLICY.allowedTools`、prompt、engine 接线测试与工具快照。
- prompt 增加：交付/阶段词汇、标注是上下文、`list_annotations` 用法、不能过闸门、`annotationIds` 传法。

### 5.4 协议兼容

- 所有新增字段 nullable/default；旧 DB 行读取为空。
- `Node` 是 discriminated union；新增 `artifact`/`drawing` 为增量；旧 web 不识别时按未知节点降级为摘要（防御）。
- `GroupNode.data.stageKey` 可选；旧 group 不受影响。
- 旧 `task.create` 行为不变：无 `deliveryId` 时仍是独立任务。
- 旧 `CanvasQuery` 行为不变：无 `deliveryId` 时仍取 workspace 画布。

## 6. Core 纯函数

新增 `packages/core/src/delivery/`、`playbook/`、`artifact/`、`annotation/`：

- `parsePlaybook(input: unknown)`：校验 + 规范化；返回 `Result<Playbook, PlaybookIssue[]>`；无 IO。
- `validatePlaybook(playbook)`：阶段 key 唯一、产物 name 唯一且安全、最后阶段 human、gate 合法、skill/name slug 合法。
- `stageByKey(playbook, key)`、`nextStage(playbook, key)`、`stageOrdinal(playbook, key)`。
- `buildStageSummary(delivery, stage, task, artifacts, annotations)`。
- `deriveDeliveryStatus({ cancelled, stages })`、`deriveCurrentStageKey(stages)`。
- `buildStagePrompt(input)`：确定性 XML；包含 goal/stage/produces/acceptance/previous/skill/annotations；用户文本做 XML 转义；不读文件。
- `buildArtifactBlock(artifacts)`：路径、kind、name、status。
- `buildAnnotationBlock(annotations)`：id、note、target 标题、bbox、imagePath；不塞 strokes。
- `canEnqueueDelivery(delivery, stages)`、`canCancelDelivery(delivery)`。
- `resolveAnnotationsOnApprove(annotations, taskId)`：返回需要 resolved 的 id 列表。
- `validateAnnotationTargets(annotation, nodes, artifacts)`：目标必须同交付画布/同交付产物。
- `arrangeDeliveryCanvas({ stages, nodes, groups })`：阶段布局；每个阶段一个分组列/行，组内保留相对位置；输出绝对坐标。
- `artifactPath(deliveryId, stageKey, name)`：纯字符串校验 + 拼接；不访问文件系统。

要求：

- 全部无 I/O；不 import `node:*` 或 `apps/*`。
- `buildStagePrompt` / `buildAnnotationBlock` / `deriveDeliveryStatus` / `arrangeDeliveryCanvas` 必须有固定事实快照测试。
- 不允许把 strokes、transcript、diff 正文塞进 supervisor 可见的摘要。

## 7. Daemon 实现

### 7.1 数据库与 migration 0015

新增表：

```sql
CREATE TABLE delivery (
  id text PRIMARY KEY NOT NULL,
  workspace_id text NOT NULL REFERENCES workspace(id),
  canvas_id text NOT NULL REFERENCES canvas(id),
  title text NOT NULL,
  goal text NOT NULL,
  playbook_id text NOT NULL,
  playbook_version integer NOT NULL,
  playbook_json text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  cancelled_at integer
);
CREATE UNIQUE INDEX delivery_canvas_idx ON delivery(canvas_id);
CREATE INDEX delivery_workspace_idx ON delivery(workspace_id, created_at);

ALTER TABLE canvas ADD COLUMN delivery_id text;
CREATE UNIQUE INDEX canvas_delivery_idx ON canvas(delivery_id);

ALTER TABLE task ADD COLUMN delivery_id text;
ALTER TABLE task ADD COLUMN stage_key text;
ALTER TABLE task ADD COLUMN annotation_ids_json text;
CREATE INDEX task_delivery_idx ON task(delivery_id, stage_key);

CREATE TABLE artifact (
  id text PRIMARY KEY NOT NULL,
  workspace_id text NOT NULL REFERENCES workspace(id),
  delivery_id text NOT NULL REFERENCES delivery(id),
  stage_key text NOT NULL,
  task_id text REFERENCES task(id),
  kind text NOT NULL,
  name text NOT NULL,
  path text NOT NULL,
  source_path text,
  svg_path text,
  mime text,
  size integer NOT NULL,
  sha256 text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE UNIQUE INDEX artifact_name_idx ON artifact(delivery_id, stage_key, name);
CREATE INDEX artifact_delivery_idx ON artifact(delivery_id, stage_key, created_at);

CREATE TABLE annotation (
  id text PRIMARY KEY NOT NULL,
  workspace_id text NOT NULL REFERENCES workspace(id),
  delivery_id text NOT NULL REFERENCES delivery(id),
  stage_key text NOT NULL,
  target_node_ids_json text NOT NULL DEFAULT '[]',
  target_artifact_id text REFERENCES artifact(id),
  note text NOT NULL DEFAULT '',
  strokes_json text NOT NULL,
  bbox_json text NOT NULL,
  image_path text NOT NULL,
  status text NOT NULL,
  task_id text REFERENCES task(id),
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  resolved_at integer
);
CREATE INDEX annotation_delivery_idx
  ON annotation(delivery_id, stage_key, status, created_at);
CREATE INDEX annotation_task_idx ON annotation(task_id);
```

- `canvas.delivery_id` 不设 FK 约束，避免与 `delivery.canvas_id` 形成循环；由事务保证一致性。
- 旧 `canvas` / `task` 行 `delivery_id = NULL`；不回填。
- 升级测试：空库 + 已有 nodes/tasks 的 fixture DB；旧数据可读，新交付可建；回滚 drop 新表/列。
- `delivery` 与 `canvas` 创建顺序：先建 canvas（`delivery_id=null`），再建 delivery（`canvas_id`），再更新 canvas `delivery_id`；同一事务。

### 7.2 Repositories

`apps/daemon/src/db/repositories.ts` 新增：

- `insertDelivery`、`getDelivery`、`getDeliveryByCanvas`、`listDeliveries`、`updateDelivery`、`setDeliveryCancelled`。
- `insertArtifact`、`upsertArtifact`、`getArtifact`、`listArtifactsByDelivery`、`listArtifactsByStage`、`updateArtifactStatus`。
- `insertAnnotation`、`getAnnotation`、`listAnnotations`、`updateAnnotation`、`resolveAnnotationsForTask`。
- `getCanvasByDelivery`、`setCanvasDelivery`。
- `insertTask` / `getTaskDetail` / `listTasks` 支持 `deliveryId` / `stageKey` / `annotationIds`。
- 所有写操作在事务内；批量查询避免 N+1。

### 7.3 Delivery service

`apps/daemon/src/delivery/service.ts`：

- `createDelivery(input)`：
  1. 校验 workspace、trust、engine、playbook。
  2. 读取 `.baton/playbooks/<id>.yaml`（内置 fallback）；解析/校验；失败返回 `playbook_invalid`。
  3. 事务：建 canvas（delivery_id null）→ 建 delivery（playbook 快照）→ 更新 canvas.delivery_id → 建阶段分组 nodes（每个 stage 一个 `group`，带 `stageKey`）→ 建第一阶段 agent node → 建第一阶段 task（todo）。
  4. 审计 `delivery.create`；广播 `delivery.updated`、`canvas` 变更。
  5. 返回 `deliveryId/taskId`。
- `enqueueDelivery(deliveryId)`：当前阶段 task 必须 `todo`；调用现有 enqueue transfer；审计 `delivery.enqueue`。
- `cancelDelivery(deliveryId, reason?)`：取消当前非终态阶段 task；写 `cancelledAt`；审计 `delivery.cancel`；不删除产物/标注。
- `getDeliveryDetail(deliveryId)`：组装 stages/artifacts/annotations/attention；阶段 task 详情按需查询。
- `listDeliveries(workspaceId, filters)`：批量查询 + 状态推导；`needsPerson` 过滤 `waiting_person|blocked`。
- `advanceDelivery(deliveryId, stageKey)`：阶段通过后：
  - 标记该阶段 artifacts `accepted`。
  - `resolveAnnotationsForTask(taskId)`；广播 `annotation.updated`。
  - 若还有下一阶段：建下一阶段 task（todo）+ agent node；审计 `delivery.stage.advance`。
  - 若最后阶段：生成 `delivery-report.md` artifact；广播 `delivery.updated(status=done)`。
- `rejectDeliveryStage(deliveryId, stageKey, note)`：标记 artifacts `rejected`；任务走现有 `review.reject`；不建下一阶段。
- `autoApproveStage(deliveryId, stageKey)`：仅 `gate=auto` + acceptance pass + kill switch off；调用 core 转移 `review.auto_approve`；审计 `delivery.stage.auto_approve`。

### 7.4 Stage task 创建与 prompt

`apps/daemon/src/delivery/stage-task.ts`：

- 找到/创建阶段 agent node（同 stage 分组内；一阶段一个 agent node）。
- 解析 skill：`.baton/skills/<id>/SKILL.md`；读取 head；未信任/缺失分别标 `disabled_untrusted`/`missing`；不阻断创建。
- 组装 `StagePromptInput`：
  - delivery title/goal；
  - stage label/gate/produces/acceptance；
  - previous stage artifacts（路径 + kind + name + status，不读正文）；
  - skill ref（id/path/summary）；
  - annotations（若有 `annotationIds`）；
  - selected context nodes（来自 `contextNodeIds`；`assembleContext` 负责节点正文）。
- 调 `assembleContext({ taskPrompt: stagePrompt, targetNodeId, selectedNodeIds, nodes, edges, contentByNodeId })`；`stagePrompt` 由 core 转义用户文本。
- `insertTask` 写入 `deliveryId/stageKey/annotationIds`、`origin`（source=`delivery`, scope=`stage`）、policy snapshot。
- 任务 prompt 里必须写清输出路径；不允许 Agent 猜路径。

### 7.5 Artifact service

`apps/daemon/src/artifact/service.ts`：

- `checkRequiredArtifacts(deliveryId, stageKey)`：
  - 对 playbook `produces.required` 逐个检查路径存在、常规文件、非空、jail、非软链逃逸。
  - 失败返回 `{ ok:false, missing[] }`；verify 路径把它作为 `verify_fail` 的输出摘要，任务进入 review 或重试。
  - 成功：upsert artifact（`status=ready`）、计算 `size/sha256/mime`；广播 `artifact.updated`。
- `saveArtifactContent({artifactId, sourceBase64?, previewBase64?, svgBase64?})`：
  - 仅允许 `kind=drawing|annotation` 或已存在的 artifact。
  - 解码、大小上限、MIME 白名单、sha256；写入固定路径；`version += 1`；`status=ready`。
  - 事务更新 DB + 审计 `artifact.save`；广播。
- `readArtifactContent(artifactId)`：返回 `{ mime, size, stream/buffer }`；只服务已登记路径；拒绝目录/软链。
- `createDraftArtifact({deliveryId, stageKey, kind, name})`：建记录（`status=draft`, 空文件/占位）；给画板/标注导出用。
- `exportAnnotation(annotationId)`：把 annotation `imagePath` 复制/登记为 `kind=annotation` artifact；幂等。

### 7.6 Annotation service

`apps/daemon/src/annotation/service.ts`：

- `createAnnotation(input)`：
  - 校验 delivery/stage/targets；note ≤2k；strokes ≤2MB；PNG ≤10MB；bbox 合法。
  - 写 PNG 到 `.baton/deliveries/<deliveryId>/<stageKey>/annotations/<annotationId>.png`。
  - 事务插入 annotation（`status=open`）；审计 `annotation.create`；广播 `annotation.updated`。
- `updateAnnotation({annotationId, note?, status?})`：只允许 note 修改与 `open→resolved/dismissed`；写审计；广播。
- `resolveAnnotationsForTask(taskId)`：任务通过后批量把 `task_id=taskId` 的 open 标注置 resolved；广播。
- `listAnnotations(deliveryId, stageKey?, status?)`：返回 summaries；不含 strokes。
- `getAnnotationForSupervisor(annotationId)`：note/target/bbox/imagePath；不含 strokes/绝对路径。
- `validateTargets`：node 必须在 delivery canvas；artifact 必须同 delivery；target 数量 ≤20。

### 7.7 闸门与 transition

- 复用现有 `review.decide` 作为 human gate。
- 新增 daemon-only 转移 `review.auto_approve`（core state machine）：
  - 守卫：任务在 `review`；`delivery` 阶段 `gate=auto`；AC verdict=`pass`；kill switch 关闭；`delivery.cancelledAt=null`。
  - 效果：任务 `done`；写审计 `delivery.stage.auto_approve`；由 delivery service 推进下一阶段。
  - 不暴露成 WS 命令或总管工具。
- human gate 通过后同样走 `advanceDelivery`；打回走 `review.reject`，不推进。
- 最后阶段必须 human；auto 只允许在中间阶段；core 校验 playbook。
- 阶段 task 的 `review` 仍是唯一验收事实；delivery 状态只是投影。

### 7.8 总管接线

- `apps/daemon/src/supervisor/tools.ts` 新增 6 个工具；`create_task` 增加 `annotationIds`。
- `apps/daemon/src/supervisor/prompt.ts`：
  - 增加交付/阶段/产物/标注词汇；
  - 明确“标注是上下文，不是装饰；用户说按标注改时先 `list_annotations`”；
  - 明确“总管不 approve/reject；阶段通过只能人点”；
  - 明确“create_delivery 只建第一阶段 todo，不自动开工”。
- `apps/daemon/src/supervisor/engine.ts` 同步 `sdkTools` 清单；工具数 28；快照断言真实请求体包含全部工具名。
- `list_deliveries/get_delivery` 返回阶段进度、attention、未处理标注数；不返回 transcript/diff 正文。
- `plan_tasks` / `create_tasks` 的 `annotationIds` 进入任务 prompt 与计划卡摘要；apply 仍 human-only。

### 7.9 注意力与 digest

- `DeliverySummary.attention` 复用 `Attention` 枚举：
  - `needs_review`：阶段 task 在 review；
  - `needs_reply`：阶段 task waiting_input；
  - `needs_approval`：审批；
  - `needs_attention`：阶段 failed / delivery blocked；
  - `none`：其他。
- digest 增加“交付”维度：
  - 需要人的交付（waiting_person/blocked）；
  - 未处理标注数；
  - 交付等待时长；
  - 最多 20 条，计数=列表长度。
- 不新增外部推送；仍用站内 notice/digest。
- 看板/交付卡显示未处理标注数；点击打开画布标注列表。

## 8. Web 实现

### 8.1 主壳与右栏

- 主壳：顶部标题栏 + 左栏 + 中间画布/看板 + 右侧总管。
- 左栏：通知、项目、交付列表、“新建交付”；交付卡显示阶段 chips、等待时长、attention、未处理标注数。
- 中间：交付画布 / 交付看板切换；任务视图作为辅助筛选，不占右栏。
- 右栏：**只保留精灵总管**，可折叠；折叠后画布全宽，浮动按钮恢复。
- 顶部：交付标题、状态、画布/看板、连接状态。
- URL state：`workspaceId/deliveryId/stageKey/artifactId/annotationId`；深链直达画布对象。

### 8.2 交付看板

`apps/web/src/features/deliveries/DeliveryBoard.tsx`：

- 列：草稿 / 进行中 / 待我处理 / 已阻断 / 已交付 / 已取消。
- 卡片：标题、goal 摘要、阶段 chips（① 需求 … ④ 验收）、等待时长、attention、未处理标注数、主按钮（开工/继续/验收）。
- 顶部：计数、“需要我”过滤、标题搜索、按等待时长排序、stale 30 分钟标记。
- 点击卡片：进入交付画布并选中交付；任务视图保留为筛选页签。
- 无右栏交付详情；看板只做列表与入口。

### 8.3 画布对象

`apps/web/src/features/canvas/` 新增：

- **交付概览卡**：视口固定左上（不随画布平移）；标题、goal、4 段进度、当前闸门、未处理标注数、等待时长；“编辑目标”就地 popover；点击阶段 chip 聚焦阶段分组。
- **阶段分组**：`group` 节点 + `data.stageKey`；标题 `① 需求`；组头显示状态/闸门/产物数/标注数/等待时长；可折叠；阶段布局自动排布。
- **Agent 阶段卡**：现有 `AgentNode` 增加阶段 badge；双击打开 `StageSceneOverlay`。
- **产物卡**：`artifact` 节点；缩略图 + kind 图标 + 标题 + 状态；双击打开 `ArtifactViewerOverlay`。
- **画板节点**：`drawing` 节点；缩略图；双击打开全屏 `DrawingEditor`。
- **闸门卡**：派生 `review` 卡；显示阶段状态、verify、diff、证据摘要、按钮“通过阶段/打回/查看证据”；auto 阶段显示“自动通过（审计）”。
- **验收矩阵卡**：派生 `acceptance:${deliveryId}`，放在 ④ 验收组；显示用户故事/验收标准/怎么验三列；展开为覆盖层。
- **标注层**：`AnnotationLayer` 覆盖在 React Flow 视口上；笔迹按阶段过滤；open/resolved 可切换；点击笔迹弹 popover。
- **标注汇总**：交付概览卡/阶段组头的“N 条标注”打开浮动列表（不是右栏）；列表显示 note/target/status，支持定位、交给总管、标记已处理。
- **画布工具栏**：选择/平移、建组、整理画布、上传图片/文件、加文本、**快速标注**、**新建画板**；不做 Excalidraw 之外的自由绘图工具。

### 8.4 覆盖层

`apps/web/src/features/overlays/`：

- `StageSceneOverlay`：任务现场；复用 `Transcript`、`DiffViewer`、`AcceptanceReport`、`TaskHistory`、`TaskFailureCard`、`TaskActions`；关闭回画布。
- `ArtifactViewerOverlay`：Markdown（`react-markdown` + `remark-gfm`）、图片、HTML sandbox iframe、PDF `<embed>`、drawing 预览；按需挂载；Esc 关闭。
- `AcceptanceMatrixOverlay`：三列矩阵；每条 AC 带类型标签（命令/文件/人工/截图）；状态与证据。
- `AnnotationListOverlay`：open/resolved；定位；交给总管；标记已处理/忽略。
- 覆盖层统一：焦点陷阱、Esc 关闭、`aria-modal`、返回触发元素；不改变 URL 时也支持深链。

### 8.5 标注层

- 技术：`perfect-freehand` 生成笔迹轮廓；`ViewportPortal` 渲染 SVG，跟随 React Flow 缩放/平移。
- 工具：笔/高亮/橡皮/颜色/粗细/撤销/清空；快捷键 `P/H/E`，`Esc` 退出；输入框聚焦时不抢快捷键。
- 画完弹出小气泡：note 输入 + 目标 chip + “保存”/“保存并交给总管”。
- 目标：按 bbox 命中的节点/产物；默认多选最多 5 个；用户可改；无目标时归到当前阶段。
- 合成图：用 `html-to-image` 抓目标节点或视口 bbox + 笔迹；iframe 抓不到时退化为笔迹 PNG + 目标路径 + note。
- 持久化：debounce 500ms；创建走 `POST /api/deliveries/:id/annotations`，更新走 `PATCH .../annotations/:annotationId`；页面刷新恢复。
- 性能：每标注 ≤2MB；单阶段可见标注 ≤200；笔迹点简化；resolved 默认隐藏。

### 8.6 画板编辑器

- 全屏 `DrawingEditor`：懒加载 `@excalidraw/excalidraw`；`theme="dark"`；容器/工具栏用 DESIGN.md token。
- 打开：加载 `.excalidraw` JSON；无源文件时新建。
- 保存：`exportToBlob` 生成 PNG；`exportToSvg` 生成 SVG；`serializeAsJSON` 生成源文件；`PUT artifact` 保存。
- 关闭：自动保存并更新缩略图；失败提示重试，不丢本地草稿（localStorage 仅存临时草稿，不存敏感内容）。
- 画板内嵌图片：走现有 uploads；禁止远程抓取；数据 URL 上限 2MB。
- 画板节点：缩略图 + 标题 + 阶段状态；双击进编辑器；不作为 Agent 节点。

### 8.7 产物查看器

- Markdown：渲染 + 代码块等宽；不执行 HTML。
- HTML：sandbox iframe，`sandbox="allow-scripts allow-forms allow-modals allow-popups"`，不加 `allow-same-origin`；`referrerPolicy="no-referrer"`；不导航顶层窗口。
- PDF：`<embed type="application/pdf">`；PDF 归 `kind=other` + `mime=application/pdf`；失败给下载/路径。
- 图片：`<img>` + 缩放；SVG 当 `<img>`，不内联。
- 未知类型：路径 + 下载。
- 产物卡只渲染缩略图/摘要；查看器懒加载；关闭销毁。

### 8.8 验收矩阵

- 数据来源：交付 ④ 验收阶段 task 的 `TaskAcceptanceResponse` + 交付 artifacts + verify/diff。
- 三列：
  - 用户故事：交付 goal 拆出的 1-5 条（来自 acceptance contract / playbook checklist）；
  - 验收标准：AC 条目 + 状态 + 证据；
  - 怎么验：命令 / 文件 / 人工 / 截图（后置类型灰显）。
- 闸门按钮在矩阵卡/闸门卡上；点击通过调用现有 `review.decide`；不经过总管。
- 交付完成时生成 `delivery-report.md` artifact，矩阵卡显示报告链接。

### 8.9 任务详情与任务视图

- 右栏不再有任务详情；任务详情 = `StageSceneOverlay`。
- 现有 `TaskDetailPanel` 内容拆成 overlay 可复用组件；`TaskBoard` 保留为辅助视图，可筛选 `deliveryId/stageKey`。
- 任务卡显示交付/阶段 badge；点击进入交付画布并聚焦阶段。
- 旧独立任务（`deliveryId=null`）继续在 workspace inbox 画布与任务视图工作。

### 8.10 移动端

- 交付列表 + 交付详情 + 阶段状态 + 审批/验收 + 产物预览。
- 不做画布、不做标注绘制、不做画板编辑。
- 总管聊天保留；移动端可处理 approval/reply/review。
- 现有 `MobileTaskDetail` 扩展为交付/阶段详情；不新增第二套导航。

### 8.11 设计系统与可访问性

- 不新增颜色/字号/圆角 token；全部用 `DESIGN.md` 的既有 token。
- 阶段状态：`pending` 中性、`running` accent、`waiting_person` warning、`done` success、`failed` danger、`cancelled` muted；必须带文字/图标，不只靠颜色。
- 画布卡片可键盘聚焦；覆盖层焦点陷阱；按钮有明确 aria-label；对比度 WCAG AA。
- 覆盖层用 HeroUI Modal/Popover/Drawer；Excalidraw 只覆盖画板容器局部主题，不新增全局 UI 库。
- 参考 `baton.ai/images/super-agent/02.jpg`、`04.jpg`、`09.jpg`、`14.jpg`、`t01_3` 的布局与信息密度；不照搬浅色主题/xterm/Codex/zsh。

### 8.12 新增依赖

| 依赖 | 许可 | 放置 | 用途 |
| --- | --- | --- | --- |
| `@excalidraw/excalidraw` | MIT | web | 全屏画板；独立 lazy chunk |
| `perfect-freehand` | MIT | web | 快速标注笔迹轮廓 |
| `html-to-image` | MIT | web | 标注合成图（目标节点 + 笔迹） |
| `react-markdown` + `remark-gfm` | MIT | web | Markdown 产物查看器 |
| `yaml` | ISC | daemon | `.baton/playbooks/*.yaml` 解析 |

- 版本在实现时按 npm registry 与 lockfile 锁定；全部更新 `THIRD_PARTY_NOTICES.md`。
- 不引入 tldraw、Monaco、GPL/AGPL/Sustainable Use 依赖。
- Excalidraw 必须在独立 chunk；主包不得包含 `@excalidraw`。

## 9. 安全与隐私

- **路径**：artifact/annotation/drawing 全部经 `resolveWithin` + `realpath`；拒绝 `..`、绝对路径、软链逃逸；只服务 `.baton/deliveries` 下已登记路径。
- **输入**：note ≤2k；strokes ≤2MB；PNG ≤10MB；drawing JSON ≤5MB；playbook/name 走 slug/文件名白名单；zod 全量校验。
- **MIME**：白名单；不信任扩展名；HTML sandbox；SVG 只当图片；不执行脚本；PDF 用浏览器查看。
- **网络**：daemon 不抓取外链；画板图片只允许上传/受限 data URL；HTML/CSS 里的远程资源由浏览器加载，`referrerPolicy=no-referrer`。
- **总管**：只读 annotation summary（note/target/bbox/imagePath），不读 strokes/transcript/diff 正文；不能过闸门；不能执行命令。
- **auto 闸门**：仅 playbook `gate=auto`、AC pass、kill switch off；写 audit；human gate 不可自动。
- **skill**：未信任 workspace 不注入；路径 jail；最大 64KB；prompt 明示来源；不执行 skill 内容。
- **日志/审计**：不写绝对路径、token、transcript、diff 正文；错误对象脱敏；审计事件包含 deliveryId/stageKey/artifactId/annotationId。
- **截图/合成图**：可能包含敏感 UI；只存 workspace，不上传外部；证据截图脱敏后再附 PR。
- **删除**：取消交付不删产物/标注；删除画布节点不删 artifact 文件；artifact 清理后置。

## 10. 测试与验收

### 10.1 Core 单元

- playbook 解析/校验：合法、非法 YAML、重复 key、非法 name、最后阶段 auto、缺 stage、超上限。
- 状态推导：每个 task.status → stage.status；delivery 优先级矩阵；currentStageKey；needsPerson。
- `buildStagePrompt`：固定输入快照；XML 转义；previous/skill/annotations；无 I/O。
- `buildAnnotationBlock`：note/target/bbox/imagePath；不含 strokes；空 note 行为。
- `arrangeDeliveryCanvas`：阶段分组、组内相对位置、空组、旧节点。
- `resolveAnnotationsOnApprove`：只 resolved taskId 匹配的 open 标注。
- `canEnqueueDelivery` / `canCancelDelivery` / `nextStage`。
- `packages/core` 覆盖率 ≥80%。

### 10.2 Protocol

- 新 entity/命令/事件 zod round-trip。
- `Node` union 新增 `artifact`/`drawing`；旧节点解析不变。
- `TaskCreateInput.annotationIds` 兼容。
- 总管工具清单快照：22 → 28；真实引擎请求体包含全部工具；prompt 字符数不超过当前预算 +15%。

### 10.3 Daemon 集成

- migration 0015：空库、已有节点/任务库升级；旧 canvas/task `delivery_id=null`；回滚。
- 创建交付：canvas + delivery + 4 组 + 第一阶段 task；playbook 快照；审计；事件。
- 阶段推进：需求 approve → 设计 task 创建；设计 approve → 开发；开发 auto → 验收；验收 approve → delivery done + report。
- 打回：artifact rejected；不建下一阶段；标注保持 open。
- 标注：create/update/resolve；任务 `annotationIds`；prompt 含 note/imagePath；approve 自动 resolved；打回保持 open。
- 产物：必产物缺失 → verify fail；可选产物缺失 → 不失败；artifact upsert/sha256/version；drawing save。
- 总管工具：create/list/get/enqueue delivery；list/get annotation；create_task annotationIds；不能 approve/reject。
- 兼容：旧 `task.create` 独立任务；旧 workspace canvas；旧 review/acceptance。
- 安全：路径穿越/软链/超大文件/MIME 伪装/未信任 skill/auto gate 越权。

### 10.4 Web 组件

- DeliveryBoard：列、过滤、排序、计数、点击入口。
- 交付概览卡：进度、标注数、等待时长、编辑 goal。
- 阶段分组：折叠、状态、产物/标注计数。
- ArtifactCard/Viewer：Markdown/图片/HTML sandbox/PDF/未知类型；懒加载。
- GateCard：通过/打回/查看证据；auto 状态；键盘可达。
- AcceptanceMatrix：三列、类型标签、状态。
- AnnotationLayer：笔/高亮/橡皮/撤销/清空；note/目标；保存；resolved 隐藏；快捷键。
- DrawingEditor：懒加载、保存、关闭回写缩略图；主包不包含 Excalidraw。
- RightPanel：只有总管；无 tabs；折叠/恢复。
- 移动端：交付列表/详情/审批；无画布。

### 10.5 Playwright（fake adapter）

- 创建交付 → 需求阶段 → 产物 → 通过 → 设计 → 标注 → 交给总管 → 计划卡 → apply → 任务 → 通过 → 开发 auto → 验收 → done。
- 标注层：画一笔、写 note、保存、刷新恢复、列表定位。
- 产物查看：Markdown、HTML iframe、图片；关闭回画布。
- 右栏：只有总管；任务详情覆盖层可开可关。
- 移动端：交付列表 + 审批。

### 10.6 ego-lite + 真实 Claude

- 真实 Claude 跑一个需求阶段：读 skill、写 `spec.md`、必产物检查、review、人工通过。
- 真实标注：圈设计稿 + note；总管 `list_annotations`；派任务；worker 读合成图；通过后 resolved。
- 保留关键截图/页面快照；脱敏后附证据。
- `docs/evidence/2026-11-22-m7-delivery/README.md`。

### 10.7 性能与安全验收

- `vite build` 输出断言：Excalidraw 在独立 lazy chunk；主包不包含 `@excalidraw`。
- 标注层 200 条/2MB 上限；大画布 50 节点拖拽不卡；覆盖层关闭后释放。
- 路径穿越、软链、MIME 伪装、超大文件、HTML sandbox、auto gate 越权测试。
- `pnpm check:secrets` / `check:boundaries` / `check:protocol` / `format:check`。

### 10.8 命令

- `pnpm verify`
- `pnpm verify:full`
- `pnpm pack:check`
- `pnpm check:boundaries`
- `pnpm check:protocol`
- `pnpm format:check`

## 11. DoD

- [ ] migration 0015 建 `delivery`/`artifact`/`annotation` 与索引；`canvas/task` 新增 nullable 列；空库与旧库升级测试通过；回滚可用。
- [ ] 一条需求一个 delivery 一块画布；旧 workspace 画布保留为 inbox；旧任务独立可用。
- [ ] `standard-delivery` 4 阶段可创建；playbook 快照；阶段串行；阶段任务复用现有状态机。
- [ ] 阶段闸门 human/auto 正确；auto 仅中间阶段、AC pass、kill switch off、写 audit；最后阶段必须 human。
- [ ] 交付状态从阶段推导；看板 6 列；needsPerson/等待排序/计数正确。
- [ ] artifact files-first：路径固定、jail、sha256、version、状态；必产物缺失进 verify fail。
- [ ] annotation 表/创建/更新/列表/自动 resolved；note 为空总管先问；任务 prompt 含 note/target/bbox/imagePath。
- [ ] 总管 6 个新工具 + `create_task.annotationIds`；工具数 28；总管仍不能 approve/reject/resolve。
- [ ] 右栏只有总管；任务详情/产物/验收/标注均为画布对象/覆盖层；无 tabs。
- [ ] Excalidraw 画板懒加载；`.excalidraw`+PNG/SVG 保存；主包不含 Excalidraw。
- [ ] 快速标注层：笔/高亮/橡皮/撤销/清空；note/目标；持久化；resolved 过滤；快捷键。
- [ ] 交付概览卡、阶段分组、Agent 阶段卡、产物卡、闸门卡、验收矩阵卡、画板节点、标注层全部可用。
- [ ] 移动端：交付列表/详情/审批；无画布；现有移动端不回归。
- [ ] 安全：路径/MIME/大小/sandbox/SVG/skill trust/auto gate 审计全部测试通过。
- [ ] 测试：core/protocol/daemon/web/Playwright/ego-lite+真实 Claude；`pnpm verify` 与 `pnpm verify:full` 通过。
- [ ] 文档：spec/ADR/contract/plan/evidence/`docs/README.md` 更新；新增依赖更新 `THIRD_PARTY_NOTICES.md`；无 TODO/FIXME。
- [ ] 工程：`pnpm pack:check`、`check:boundaries`、`check:protocol`、`format:check` 通过。

## 12. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 画布归属迁移 | 旧数据/旧任务不可用 | nullable + 不回填；旧 workspace 画布 inbox；升级测试；回滚 drop 新表/列 |
| 画布密度上升 | 找不到东西 | 交付概览卡 + 阶段分组 + 折叠 + 覆盖层；总管链接定位；深链 |
| 产物/任务覆盖层性能 | 大画布卡顿 | 卡片只渲染缩略图；覆盖层懒加载；关闭销毁；50 节点降级 |
| Excalidraw 包体大 | 首屏变慢 | 独立 lazy chunk；bundle 断言；只在画板打开时加载 |
| 标注语义不清 | 总管派错活 | note 必填才能派活；目标 chip；总管先问；合成图 + bbox |
| auto 闸门越权 | 人未拍板就完成 | 仅中间阶段；AC pass；kill switch；审计；最后阶段必须 human |
| skill 不可信 | prompt 注入/越权 | workspace trust；只引用不复制；路径 jail；不执行 |
| 产物路径冲突 | 覆盖/丢文件 | 固定目录 + 安全 name + version/sha256；同名覆盖前校验 |
| 右栏收敛后可发现性下降 | 用户不会用 | 概览卡/组头/总管链接三入口；不超过两次点击；空状态引导 |
| 协议膨胀 | 兼容/维护成本 | 增量 nullable；旧客户端忽略未知事件；工具快照 |
| 交付/任务命名混淆 | 用户心智 | UI 用“交付/阶段”；任务视图明确“阶段任务”；文档统一 |

## 13. 实施切片

1. **M7-1 protocol + core + migration 0015**
   - delivery/artifact/annotation/playbook entities；
   - `parsePlaybook`、状态推导、`buildStagePrompt`、`buildAnnotationBlock`、`arrangeDeliveryCanvas`；
   - migration 0015 + 升级测试；
   - core/protocol 测试。
2. **M7-2 daemon 交付与产物**
   - delivery service、stage task、artifact service、annotation service；
   - REST/WS、repositories、audit/events；
   - 闸门 human/auto；delivery 推进；
   - 总管 6 个工具 + `create_task.annotationIds`；
   - daemon 集成测试。
3. **M7-3 web 壳/看板/画布**
   - 左栏项目/交付、交付看板、交付画布、阶段分组、产物卡、闸门卡；
   - 右栏只留总管；
   - StageSceneOverlay / ArtifactViewerOverlay / AcceptanceMatrixOverlay；
   - 任务视图兼容。
4. **M7-4a Excalidraw 画板**
   - drawing 节点/artifact；全屏 lazy editor；保存/缩略图；查看器；
   - bundle 断言。
5. **M7-4b 快速标注**
   - AnnotationLayer；工具条；note/target；持久化；标注列表；导出；
   - 标注进任务 prompt；自动 resolved。
6. **M7-5 验收与 skills**
   - 必产物检查；验收矩阵；交付报告；
   - `.baton/skills` 注入/trust/状态；
   - 真实 Claude 一条链路。
7. **M7-6 e2e + 文档 + 证据**
   - Playwright fake 全流程；ego-lite 真实链路；
   - spec/ADR/contract/plan/evidence/README/THIRD_PARTY_NOTICES；
   - `pnpm verify:full`、`pack:check`、边界/协议/格式检查。

每个切片独立可回滚；切片结束跑 `pnpm verify`，最后跑 `pnpm verify:full`。

## 14. 后置与未来

- **终端/子代理可见性**：只读 xterm、子代理树、PTY 接管、适配器 `parent_tool_use_id` 分流；单独 spec/ADR。当前 `translateSdkMessage` 未分流子代理，后续必须补。
- 外部 Source（GitHub/飞书）、验收后回写/关单、自动 PR。
- 视觉回归：截图 diff、设计稿对比、阈值。
- 多人协作、权限、跨 workspace 交付。
- 一阶段多 worker、条件分支、DAG。
- Codex/zsh 引擎。
- artifact 历史版本、标注线程/回复、跨交付标注。
- 移动端画布/绘图。
- 交付模板市场、skill 效果统计、成本/lead time 报表。

## 15. 评审记录

- 2026-11-22：用户逐项确认交付拥有画布、4 阶段/闸门、files-first、`.baton/skills`、交付状态推导。
- 2026-11-22：用户确认自由绘图要做；选择 Excalidraw 画板 + 快速标注层 + `.excalidraw`/PNG/SVG。
- 2026-11-22：用户指出“标注不进上下文，总管无法派活”；改为标注一等上下文、`annotation` 表、`list_annotations`、`annotationIds`、通过自动 resolved。
- 2026-11-22：用户确认终端/xterm/子代理树后置，不混入 M7。
- 2026-11-22：用户确认右栏只保留精灵总管；交付/产物/验收/标注改为画布对象与覆盖层；UI v3 三个默认通过。
- 待办：用户审阅本 spec；通过后进入 sprint contract 与 writing-plans。
