# Sprint Contract: M1-6a 任务控制台

> 关联 spec：`docs/specs/2026-11-17-m1-web-console-design.md`
> 文档位置说明：本仓库 contract 落 `docs/contracts/`，不使用 `docs/agent-harness/contracts/`。

## Outcome（用户视角）

打开 baton 的 web 后，我能看到当前工作区的任务看板：谁在等我、等了多久、哪些任务在跑。我可以展开看板、点开任务，直接回复、审批或验收；也可以在中栏画布上创建和拖动 Agent 节点，从节点派一个任务。刷新页面后，任务状态、对话记录和节点位置都还在。整个过程不需要任何 LLM key，用 fake agent 就能跑通。

## Definition of Done

- [ ] **1. 依赖与样式冒烟**：`apps/web` 增加 Tailwind `^4.3.5`、`@tailwindcss/vite@^4.3.5`、HeroUI `^3.2.7`、TanStack Query `^5.107.1`、Zustand `^5.1.0`、`lucide-react@^1.73.0`；Vite 注册 `tailwindcss()`；CSS 先 `tailwindcss` 后 `@heroui/styles`；根元素 `class="dark" data-theme="dark"`；一个 HeroUI Button/Input/Chip 冒烟页可见且无控制台错误。
- [ ] **2. 应用壳**：三栏（64px 看板 rail、中画布、右详情 360–440px）；顶栏含 baton 字标、workspace 下拉、连接状态、「新建工作区」、「新建 Agent 节点」；1280px 下无横向溢出。
- [ ] **3. 工作区**：`GET /api/workspaces` 列表；`POST /api/workspaces` 创建（`name + relPath`）；创建后自动选中；URL 带 `?workspace=`；刷新后仍选中；`invalid_path` / `conflict` 在表单内显示。
- [ ] **4. 看板 rail**：默认 64px，显示待审批 / 待回复 / 待验收计数与总任务数；点击或 `B` 展开，`Esc` 收起；展开为 `min(960px, 72vw)` 覆盖层；pin 后 520–640px 并排，画布缩窄；点击任务卡选中任务、看板收起、详情打开；键盘可达。
- [ ] **5. 7 列看板**：未规划、待办、进行中、待审核、待验收、已完成、已取消；列计数正确；未规划来自无 task 引用的 agent 节点；其余列按 `TaskSummary` 状态投影正确；空列有引导态。
- [ ] **6. 任务卡**：标题两行截断、状态 Chip、attention 徽标、engine chip、等待时长；`needs_approval/needs_reply` 用 warning + 图标 + 文案，`needs_review` 用 accent；等待时长由 `waitingSince` 计算并每 30 秒刷新；状态不只靠颜色。
- [ ] **7. `TaskSummary` API**：`TaskListResponse` 返回 `TaskSummary[]`，含 `attention` 与 `waitingSince`；`waiting_input/review` 的 `waitingSince` 非空、其余为 `null`；protocol round-trip 与 daemon 路由测试通过。
- [ ] **8. Session events API**：`GET /api/sessions/:id/events?sinceSeq=&limit=` 返回 `{ sessionId, events, nextSeq, hasMore }`；按 `seq` 升序；`limit` 边界、`sinceSeq` 分页、404/400 测试通过。
- [ ] **9. 任务详情与 transcript**：打开任务加载 `GET /api/tasks/:id` 与最新 session 历史；角色标签（你/Agent/工具/系统）、内容、时间戳；工具输出/命令/diff 用 mono 块；刷新后历史仍在；实时 `session.event` 追加且按 `sessionId+seq` 去重；多 session 可切换；长日志虚拟滚动。
- [ ] **10. 人闸门**：`waiting_input(approval)` 显示审批卡，允许/拒绝调用 `approval.decide`；`waiting_input(question/stalled/dropped)` 显示回复框，发送调用 `session.reply` 并回到 `running`；`review` 显示退出码/diffStat/输出尾部，通过/打回调用 `review.decide`，打回必填反馈；`todo` 显示「立即开工」调用 `task.enqueue`；`running/queued` 可取消；终态只读。
- [ ] **11. 节点命令**：`node.create/update/delete` 可 round-trip；6a 只接受 text/file/agent；`node.update` 只改位置/尺寸与允许的 data（text.content、agent.title），未知字段拒绝；`node.delete` 被任务引用时返回 `node_in_use`；`image/review/group` 返回 `unsupported_node_type`。
- [ ] **12. 可编辑画布**：可创建 text/file/agent 节点；可拖动/缩放；松手发 `node.update` 并在 ack 后重拉 canvas；刷新后位置/尺寸保留；选中 agent 节点可创建任务；已有边只读渲染；删除节点有确认与错误提示。
- [ ] **13. 任务创建与开工**：从 agent 节点创建任务（title/prompt/verifyCommand 可选）；创建后进「待办」，不自动开工；点「立即开工」后 `task.enqueue`；任务卡与详情同步出现；`task.create` 的 `contextNodeIds` 为 `[]`。
- [ ] **14. WS 实时与重连**：连接 `/ws`；`resume { sinceSeq }`；`lastSeq` 更新；`ack.data.hasMore` 时继续 resume；断线指数退避重连；事件按帧合并；命令 10s 无 ack 视为失败；状态转移不做乐观更新；刷新/重连不重复事件。
- [ ] **15. 错误与安全**：401 显示未认证提示并引导 `/auth?token=...`；WS `error` toast；transcript 不使用 `dangerouslySetInnerHTML`；审批命令只展示不执行；token 不写 localStorage；仓库内无 key。
- [ ] **16. E2E**：Playwright + `agent-fake` 覆盖 `新建 workspace → 添加 Agent 节点 → 创建任务 → 立即开工 → blocked → 回复 → verify → review → 通过`；另覆盖刷新后 transcript/状态、拖动后位置保留、删除被任务引用节点返回 `node_in_use`。
- [ ] **17. 全量质量**：`pnpm verify`、`pnpm verify:full`、`pnpm pack:check`、`pnpm check:boundaries`、`pnpm check:protocol`、`pnpm format:check` 全绿；`apps/web` 源码无 `TODO`/`FIXME`；组件源码不硬编码颜色（HeroUI token 优先）。
- [ ] **18. 文档与配置**：spec/contract/plan 互链；`docs/README.md` 索引更新；`THIRD_PARTY_NOTICES.md` 增加 HeroUI/Tailwind/TanStack/Zustand/lucide 许可；`~/.baton/supervisor.json` 空模板已创建（仓库外、0600、`{ baseUrl, apiKey, model }`）。

## Boundary Conditions

- **Must support**：Node 22 与 24；React 19；Tailwind 4.3.5；HeroUI 3.2.7；Chrome（Playwright `channel: 'chrome'`）；桌面 1280px+；本机 `127.0.0.1` + token 模式。
- **Must not break**：M1-5/M1-5a 的 REST/WS 契约；`task.status` 单写者；auth cookie；路径 jail；verify 环境脱敏；现有 core/protocol/daemon 测试（除明确变更的 `TaskListResponse` 形状）。
- **No LLM**：6a 不读取 `ANTHROPIC_API_KEY` 或总管 key；不接真实 Claude；不接总管。
- **Performance**：50 个任务、7 列看板可交互；30 个画布节点拖动无明显卡顿；transcript 首屏 500 条使用虚拟滚动；WS 事件按帧合并，不因单个 chunk 触发全页重渲染。
- **Security**：token 只在 httpOnly cookie；不把 token/key 写 localStorage/仓库；transcript 纯文本渲染；审批命令不执行；`~/.baton/supervisor.json` 在仓库外且 0600。
- **Scope**：只改 `packages/protocol/**`、`apps/daemon/**`、`apps/web/**`、`docs/**`、lockfile、`THIRD_PARTY_NOTICES.md`；不改 `packages/core` 状态机语义；不做 6b/M1-7/M2 内容。

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
pnpm --filter @baton/web build
pnpm exec playwright test
```

补充检查：

```bash
grep -RIn "TODO\|FIXME" apps/web/src packages/protocol/src apps/daemon/src   # 输出为空
```

### Inferential

- 人工对照 spec §7.2：7 列映射、rail 展开/pin、attention 文案与图标一致。
- 人工对照 spec §7.3/§7.4：画布节点 CRUD、拖动持久化、任务创建/开工、审批/回复/验收分流正确。
- 人工对照 spec §6.3：刷新、重连、`resume` 后状态与 transcript 一致，无重复事件。
- 人工对照 `DESIGN.md`：HeroUI 默认暗色主题、状态色只用于状态、没有硬编码品牌色。
- 人工评审范围：没有提前实现 6b/M1-7/M2；没有改 core 状态机语义；没有引入 LLM key。
- 人工评审安全：token 不在 localStorage；transcript 无 raw HTML；审批命令不执行；supervisor 模板不在仓库。

## Negotiation Record

**Round 1 — Generator（初版，10 条）**

1. 接入 Tailwind + HeroUI。
2. 三栏壳 + 工作区。
3. 7 列看板。
4. 任务详情。
5. 回复/审批/验收。
6. 可编辑画布。
7. 节点 CRUD。
8. 任务创建。
9. WS 实时。
10. E2E 与全量命令。

**Round 1 — Evaluator（挑战）**

- 太粗：没有 workspace 创建错误、rail 展开/pin、等待时长刷新、transcript 刷新/多 session。
- 没有 API 形状：`TaskSummary`、session events、node 命令、错误码。
- 没有边界：`node_in_use`、`unsupported_node_type`、`node.update` data 校验。
- 没有重连/去重/命令超时。
- 没有安全/性能/版本 pin/文档与 supervisor 模板。
- 没有明确「任务创建后不自动开工」。

**Round 2 — Generator（修订，18 条）**

- 补 `TaskSummary`、session events、node 命令与错误码。
- 补 rail 展开/pin、等待时长 30s 刷新、多 session 下拉。
- 补 `node_in_use`、`unsupported_node_type`、`node.update` data 白名单。
- 补 WS `lastSeq`/`hasMore`/重连/去重/10s 超时。
- 补 401/安全/无 raw HTML/无 key/localStorage。
- 补性能边界、版本 pin、文档/notices、supervisor 空模板。

**Round 2 — Evaluator（再次挑战）**

- 「看板可展开」还不够可测：必须写明默认 64px、覆盖层宽度、pin 宽度、`B`/`Esc`。
- 「任务详情可用」还不够：必须写明历史接口、刷新保留、实时追加、去重。
- 「画布可编辑」还不够：必须写明拖动/缩放松手持久化、刷新保留、边只读。
- 「审批/回复/验收」必须写成状态分流与命令映射，避免两个实现都自称正确。
- 必须明确 6a 不需要 LLM key，且 supervisor 模板不读取。

**Round 3 — Generator（最终，18 条）**

- 按上述挑战逐条写成可验证的 18 条 DoD。
- 明确 rail/看板/pin 尺寸与键盘；transcript 历史/实时/去重；节点拖动持久化与边只读。
- 明确状态分流、命令映射、`node_in_use`、`node.update` 白名单。
- 明确 no-LLM、scope、安全、性能与全量命令。

**Final consensus**：18 条 DoD，3 轮 generator-evaluator，无剩余挑战。验收以命令退出码、Playwright 结果、人工对照 spec 与截图为准。
