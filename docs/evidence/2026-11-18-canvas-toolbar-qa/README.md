# 画布工具栏与画布交互：用户视角 QA（2026-11-18）

- 环境：构建产物 `apps/daemon/dist/bin.js` + `apps/web/dist`，临时 `BATON_DATA_DIR` / `BATON_WORKSPACES_ROOT`
- 工具：ego-lite（`ego-browser`）
- 范围：顶部工作区栏、左侧看板计数、画布工具栏（文本/文件/Agent、适应视图、放大、缩小）、节点拖拽/缩放/删除、文本与 Agent 节点编辑

## 验证通过

- 工作区切换：会清空当前任务与节点选中，URL 同步更新；切到未信任工作区会弹出信任对话框。
- 连接状态：daemon 停止显示「离线」，重启后自动回到「在线」。
- 看板计数：fake 任务进入待审批时，「待审批」与「总任务」实时变为 1。
- 工具栏：文本、文件、Agent 三种节点均可创建；未命名 Agent 按数量递增（Agent 1、Agent 2）。
- 缩放：放大/缩小/适应视图都改变 React Flow transform；适应视图能框住全部节点。
- 拖拽与缩放：松手后位置/尺寸写库，刷新后保留。
- 删除：两步确认；被任务引用的节点返回「节点被任务引用，先处理任务」，节点保留。
- 文本节点：可编辑内容并保存，画布卡片实时更新。
- Agent 节点：可编辑标题并保存，画布卡片与详情标题同步；任务表单标题在未手动修改时跟随节点标题。

## 发现并修复

### 1. 连续新建节点叠成一坨

原实现按 `32px` 级联偏移，320×200 的节点几乎完全重叠（[01-before-overlap.png](01-before-overlap.png)）。适应视图后缩放被推到 2 倍，画面更像“坏掉了”。

修复：`nextNodePosition` 以视口中心为基准，按「中 → 右 → 左 → 更右 → 更左 → 下一行」找空位，并跳过视口外的槽位（[02-after-placement.png](02-after-placement.png)）。三个新节点并排且都在可视区内。

### 2. 文本/Agent 节点内容不可编辑

工具栏能加文本节点，但详情面板只读，用户只能得到「新文本节点」；Agent 标题也只能停在 Agent N。

修复：详情面板增加编辑框与「保存修改」：
- text → `node.update data.content`
- agent → `node.update data.title`

保存后重拉 canvas，画布卡片、详情标题同步（[03-text-edit.png](03-text-edit.png)）。

### 3. 重命名 Agent 后任务表单标题不跟随

`CreateTaskForm` 的标题只在挂载时取一次 `defaultTitle`。重命名节点后，任务表单仍显示旧标题。

修复：未手动编辑过任务标题时跟随节点标题；用户一旦手动修改，就不再覆盖。

### 4. 撤销信任一键生效且立刻再次弹信任框

原实现点「撤销」立即 PATCH；由于 `trustPromptedFor` 在刷新后为空，信任弹窗马上又弹出，容易误点「信任并加载」把信任加回去。

修复：
- 撤销改为内联二次确认（返回 / 确认撤销）。
- 撤销成功后标记该工作区已提示过，不再自动弹信任框；需要时可手动点「信任工作区」。

### 5. 删除失败的提示在视口外

`node_in_use` 的内联错误在面板底部，默认滚动位置看不到。用户会以为点击没反应。

修复：错误同时以 toast 展示（[04-delete-toast.png](04-delete-toast.png)），内联提示保留。

### 6. 图标工具栏没有悬停提示

六个图标按钮只有 `aria-label`，鼠标悬停没有任何文字。为每个按钮补原生 `title`（添加文本节点 / 添加文件节点 / 添加 Agent 节点 / 适应视图 / 放大 / 缩小）。

## 已知限制（本次不修）

- 画布 pan/zoom 位置不持久化：刷新回到 `viewport` 初始值。需要新增 `canvas.patch` 或等价命令，属 M1-6b。
- 只要存在任意历史任务引用，节点就不能删除（spec 锁定的 `node_in_use`，不级联删除）；失败/已完成任务也算引用，目前没有任务删除入口。
- 新建文件节点的名称与路径默认都是 `README.md`，修改路径不会联动名称。
- 跳过权限勾选在“已信任 + 服务端开关关闭”时仍可点击，创建任务才返回 `bypass_not_allowed`；后续可由能力接口提前禁用。
- 文本/文件节点尚未作为任务上下文（`contextNodeIds` 仍为空），属 M1-6b。

## 验证命令

- `pnpm verify`
- `pnpm --filter @baton/web test`（87 tests）
- `pnpm exec playwright test apps/web/e2e/journey.spec.ts`
