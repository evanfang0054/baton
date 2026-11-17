---
version: alpha
name: baton-design
description: "baton 的暗色任务驾驶舱设计系统：近黑画布、四级表面阶梯、单一薰衣草蓝主色，语义状态色只用于任务状态与 attention。"
colors:
  primary: "#5e6ad2"
  primary-hover: "#828fff"
  primary-focus: "#5e69d1"
  on-primary: "#ffffff"
  canvas: "#010102"
  surface-1: "#0f1011"
  surface-2: "#141516"
  surface-3: "#18191a"
  surface-4: "#191a1b"
  hairline: "#23252a"
  hairline-strong: "#34343a"
  hairline-tertiary: "#3e3e44"
  ink: "#f7f8f8"
  ink-muted: "#d0d6e0"
  ink-subtle: "#8a8f98"
  ink-tertiary: "#62666d"
  success: "#27a644"
  warning: "#f2c94c"
  danger: "#eb5757"
  info: "#4ea7fc"
  neutral: "#8a8f98"
  success-soft: "rgba(39, 166, 68, 0.14)"
  warning-soft: "rgba(242, 201, 76, 0.14)"
  danger-soft: "rgba(235, 87, 87, 0.14)"
  info-soft: "rgba(78, 167, 252, 0.14)"
  primary-soft: "rgba(94, 106, 210, 0.16)"
  overlay: "rgba(0, 0, 0, 0.60)"
typography:
  font-ui: "Inter, system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
  font-mono: "'JetBrains Mono', 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
  caption:
    fontSize: 12px
    lineHeight: 1.4
    fontWeight: 400
  body-sm:
    fontSize: 14px
    lineHeight: 1.5
    fontWeight: 400
  body:
    fontSize: 16px
    lineHeight: 1.5
    fontWeight: 400
  card-title:
    fontSize: 20px
    lineHeight: 1.3
    fontWeight: 500
  headline:
    fontSize: 24px
    lineHeight: 1.25
    fontWeight: 600
  mono:
    fontSize: 13px
    lineHeight: 1.5
    fontWeight: 400
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 9999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
components:
  app-shell:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
  top-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    height: 56px
    borderBottom: "1px solid {colors.hairline}"
  task-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px
    border: "1px solid {colors.hairline}"
  task-card-hover:
    backgroundColor: "{colors.surface-2}"
    border: "1px solid {colors.hairline-strong}"
  task-card-selected:
    backgroundColor: "{colors.surface-2}"
    border: "1px solid {colors.primary}"
  status-badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: 32px
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: 32px
    border: "1px solid {colors.hairline}"
  button-ghost:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
    height: 32px
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: 32px
  text-input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: 32px
    border: "1px solid {colors.hairline}"
  detail-panel:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    borderLeft: "1px solid {colors.hairline}"
  transcript-block:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.mono}"
    padding: 12px
  approval-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.warning}"
  review-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.primary}"
---

# baton DESIGN.md

这是 baton web 的**唯一视觉真源**。所有 `apps/web` 的页面、组件、状态色、间距与字体都从这里取；不要在组件里临时发明颜色或尺寸。

设计基线取自 `VoltAgent/awesome-design-md` 的 Linear 分析（MIT，2026-11-17 获取），并针对 baton 的**暗色任务驾驶舱**场景做了收敛：去掉营销页的 hero / pricing / testimonial 结构，只保留适合高密度任务、日志、看板与画布的表面阶梯、排版和状态语义。

## 1. 设计意图

baton 是"老板视角"的工作台，不是营销站。视觉要满足三件事：

1. **一眼看到谁在等我**：任务状态与 attention 必须比装饰更醒目。
2. **长时间盯着不累**：暗色、低对比噪音、细边框、无阴影、无渐变。
3. **信息密度优先**：同一屏尽量多放任务、状态、等待时长和日志；靠层级与留白区分，不靠大卡片和大圆角。

关键词：**近黑、冷静、精密、密集、单一主色、语义色克制**。

## 2. 颜色

### 2.1 表面阶梯

暗色层级由四级表面承担，不靠阴影：

| Token | 值 | 用途 |
|---|---|---|
| `canvas` | `#010102` | 页面底色、看板列底色、transcript 背景 |
| `surface-1` | `#0f1011` | 卡片、详情面板、输入框、代码块 |
| `surface-2` | `#141516` | hover、选中卡片、popover、次级容器 |
| `surface-3` | `#18191a` | 下拉菜单、嵌套面板 |
| `surface-4` | `#191a1b` | 最深抬升面，少用 |
| `hairline` | `#23252a` | 1px 分隔线、卡片边框、输入框边框 |
| `hairline-strong` | `#34343a` | hover / focus 边框 |
| `hairline-tertiary` | `#3e3e44` | 嵌套容器的第三级边界 |

规则：

- 不用 `#000000` 纯黑；`canvas` 的微弱蓝调是有意的。
- 不用 drop shadow、玻璃拟态、渐变、发光。层级只靠表面阶梯 + 1px hairline。
- 卡片默认 `surface-1` + `hairline`；hover 升到 `surface-2` + `hairline-strong`。

### 2.2 文本

| Token | 值 | 用途 |
|---|---|---|
| `ink` | `#f7f8f8` | 标题、主要文本 |
| `ink-muted` | `#d0d6e0` | 次级文本、日志正文 |
| `ink-subtle` | `#8a8f98` | 元信息、placeholder、空态 |
| `ink-tertiary` | `#62666d` | 禁用、脚注、时间戳 |

### 2.3 主色

`primary` `#5e6ad2` 是唯一品牌色，只用于：

- 主按钮（新建任务、发送回复、通过验收）
- 焦点环（`primary-focus`，2px，50% 透明度）
- 选中态边框 / 当前导航项
- 链接强调

hover 用 `primary-hover` `#828fff`。**不要把主色用于卡片填充、页面背景或大面积装饰。**

### 2.4 语义色

语义色只服务于任务状态、attention 和风险，不做装饰：

| Token | 值 | 用途 |
|---|---|---|
| `success` | `#27a644` | `done`、verify 通过、成功提示 |
| `warning` | `#f2c94c` | `waiting_input`、待审批、待回复、stalled |
| `danger` | `#eb5757` | `failed`、verify 失败、高风险、删除 |
| `info` | `#4ea7fc` | `running` / `verifying`、进行中指示 |
| `neutral` | `#8a8f98` | `todo` / `queued`、未知、无状态 |

浅底用对应的 `*-soft`（14% 透明度）做 badge 背景；文字用语义色本身。**不要用实心高饱和填充做大面积色块。**

### 2.5 状态与 attention 映射

看板对外 7 列，内部 9 态按下表投影：

| 看板列 | 内部状态 | 列头色 | 卡片状态点 |
|---|---|---|---|
| 未规划 | canvas 上没有任务的 agent 节点 | `neutral` + 虚线边框 | `neutral` |
| 待办 | `todo`、`queued` | `ink-subtle` | `neutral` |
| 进行中 | `running`、`verifying` | `info` | `info` |
| 待审核 | `waiting_input` | `warning` | `warning` |
| 待验收 | `review` | `primary` | `primary` |
| 已完成 | `done` | `success` | `success` |
| 已取消 | `cancelled`、`failed` | `ink-tertiary` / `danger` | `neutral` / `danger` |

attention 徽标：

| attention | 颜色 | 图标 + 文案 | 说明 |
|---|---|---|---|
| `needs_approval` | `warning` | 盾牌 + 「待审批」 | `waitingReason=approval` |
| `needs_reply` | `warning` | 对话 + 「待回复」 | `question/stalled/dropped` |
| `needs_review` | `primary` | 验收 + 「待验收」 | `review` |
| `none` | — | 不渲染 | 其他状态 |

规则：

- **状态不能只靠颜色表达**：必须同时有文字或图标；色盲用户要能区分。
- 审批与回复同为 `warning`，靠图标 + 文案区分，不要新增第三种黄色。
- `stalled`（停了没说明）仍属于「待回复」，不要误标成 `danger`；只有真正 `failed` 才用红色。
- 失败卡片允许在标题左侧加 2px `danger` 竖线；其他状态不加。

## 3. 字体

- UI：`Inter, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
- 等宽：`"JetBrains Mono", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace`
- 中文回退优先 `PingFang SC` / `Microsoft YaHei`；不要引入只覆盖拉丁字符的展示字体。

| Token | 字号 / 行高 / 字重 | 用途 |
|---|---|---|
| `caption` | 12 / 1.4 / 400 | 时间戳、元信息、badge |
| `mono` | 13 / 1.5 / 400 | ID、命令、日志、diff、退出码 |
| `body-sm` | 14 / 1.5 / 400 | 默认 UI 文本、按钮、表格 |
| `body` | 16 / 1.5 / 400 | 详情正文、长文本 |
| `card-title` | 20 / 1.3 / 500 | 卡片/面板标题 |
| `headline` | 24 / 1.25 / 600 | 页面标题，少量使用 |

规则：

- 字重只用 400 / 500 / 600；不堆 700+。
- 负字距只用于 20px 以上的标题（-0.2 ~ -0.4px）；正文 0。
- 日志、命令、路径、diff、退出码一律 mono；不要用 mono 做正文。
- 行高保持 1.4–1.5，密度靠间距和字号，不靠压行高。

## 4. 布局与密度

- 基准单位 4px；间距只用 `4 / 8 / 12 / 16 / 24 / 32 / 48`。
- 顶栏 56px；左侧导航/看板 240–280px；中心画布自适应；右侧详情 360–440px。
- 看板列最小 280px，列间距 12px；列头 40px；卡片间距 8px；卡片内边距 12px。
- 详情面板：sticky 头部 56px；section 间距 16px；section 之间用 1px hairline，不用大块留白。
- 画布节点：卡片风格与任务卡一致；折叠态只渲染摘要；不要给节点加阴影。
- 内容最大宽度：表单/长文 720px；日志/transcript 占满面板宽度，靠虚拟滚动控制性能。
- 触控目标：桌面最小 32px；移动/触控最小 44px。

## 5. 圆角与边框

| Token | 值 | 用途 |
|---|---|---|
| `xs` | 4px | 小 chip、状态点容器 |
| `sm` | 6px | 标签、短代码 |
| `md` | 8px | 按钮、输入框、任务卡 |
| `lg` | 12px | 面板、弹窗、drawer |
| `xl` | 16px | 大容器（少用） |
| `pill` | 9999px | 状态 badge、计数 badge |

边框默认 1px；焦点环 2px `primary-focus`（50% 透明度）+ 1px 外扩偏移。不要用 2px 以上的装饰边框，审批/验收卡片的 2px 语义左边线除外。

## 6. 组件规范

### 6.1 顶栏 / 应用壳

- 背景 `canvas`，底部 1px `hairline`。
- 左侧：baton 字标 + workspace 切换器。
- 右侧：连接状态（在线/重连中/离线）、主按钮「新建任务」。
- 连接状态用 8px 圆点 + 文案，不要只放颜色。

### 6.2 看板列

- 列头：列名 14/500 + 计数 12 `ink-subtle` + 状态点。
- 列体：`canvas` 背景，卡片之间 8px；列不画外框，用 1px 右分隔线区分。
- 空列：居中 `ink-subtle` 文案 + 虚线边框占位，不放大插画。

### 6.3 任务卡

- 背景 `surface-1`，1px `hairline`，圆角 8，内边距 12。
- 第一行：任务标题 14/500，最多两行截断；右上角 attention badge。
- 第二行：状态 badge + engine chip（`claude-sdk` / `fake` / `pty`）+ retryCount（>0 才显示）。
- 第三行：等待时长 / 更新时间，12 `ink-subtle`；等待中时用 `warning` 文案「已等 12 分钟」。
- hover：`surface-2` + `hairline-strong`；选中：`surface-2` + 1px `primary` 边框。
- 不做整卡渐变色、不做大阴影、不做圆角 16 的大卡片。

### 6.4 状态 badge

- `caption` 12px，`pill` 圆角，padding 2px 8px。
- 背景用 `*-soft`，文字用语义色；可选 6px 圆点。
- 不写死 hex；用 `status-*` / `attention-*` token。

### 6.5 按钮

- 主按钮：`primary` 背景 + `on-primary` 文字，高 32，圆角 8，padding 8/14。
- 次按钮：`surface-1` + `hairline`，文字 `ink`。
- Ghost：透明/`canvas` 背景，文字 `ink-muted`，hover 升 `surface-2`。
- 危险：`danger` 背景 + 白字，只用于删除/取消等不可逆动作。
- 禁用：opacity 0.5，不改变色相。
- 焦点：2px `primary-focus` 环，键盘可达。

### 6.6 输入框 / 文本域

- 背景 `surface-1`，1px `hairline`，圆角 8，高 32（文本域自适应）。
- placeholder 用 `ink-subtle`；focus 用 `primary-focus` 环。
- 错误用 `danger` 边框 + 12px 错误文案；不要只变红不加文字。

### 6.7 Transcript（会话记录）

- 不用聊天气泡；用**密集日志流**：左侧角色标签（你 / Agent / 工具 / 系统），右侧内容。
- 角色标签 12/500；内容 14/400；工具输出、命令、路径、diff 用 mono 13。
- 时间戳 12 `ink-tertiary`，默认弱化。
- 工具输出块：`canvas` 背景、1px `hairline`、圆角 8、padding 12；长输出折叠 + 虚拟滚动。
- 用户回复用左侧 2px `primary` 竖线标记，不加气泡。

### 6.8 审批卡

- `surface-1` + 1px `warning` 边框，左侧 2px `warning` 竖线。
- 头部：「需要授权」14/500 + 风险 badge（low/medium/high）。
- 命令/参数用 mono 块展示；按钮为「允许」「拒绝」，拒绝为次按钮。
- 高风险时把「允许」降为次按钮，并在文案中说明风险；不要默认聚焦允许。

### 6.9 验收卡

- `surface-1` + 1px `primary` 边框，左侧 2px `primary` 竖线。
- 头部：「待验收」+ 退出码 badge（0 = success，非 0 = danger）。
- 展示 diffStat（文件数/增删行）、输出尾部（mono，可滚动）。
- 操作：「通过」主按钮；「打回」次按钮 + 必填反馈文本域。

### 6.10 空态 / 加载

- 空态：`ink-subtle` 文案 + 一个主按钮（如「新建任务」），不放插画。
- 加载：骨架屏用 `surface-2` 脉冲；局部加载用 16px spinner；不要全屏 loading 遮罩。
- 错误：`danger` 文案 + 重试按钮；不要只弹 toast。

### 6.11 图标

- 统一用 `lucide-react`（shadcn/ui 默认），1.5px stroke，16/20px。
- 不用 emoji 当图标；不用彩色图标包。
- 图标按钮必须有 `aria-label` 或 tooltip。

## 7. 动效

- 只做状态过渡：hover、展开、面板滑入。时长 120–160ms，`ease-out`。
- 不做循环动画、粒子、发光、视差。
- 尊重 `prefers-reduced-motion`：关闭非必要过渡。
- 运行中指示用 16px spinner 或状态点呼吸，不做整卡闪烁。

## 8. 可访问性

- 文本对比度达到 WCAG AA；`ink-subtle` 只用于次要信息，不用于关键操作。
- 焦点必须可见：2px `primary-focus` 环；不要 `outline: none`。
- 所有操作可键盘完成；看板卡片可 Tab 聚焦，Enter 打开详情。
- 状态/attention 不能只靠颜色：必须有文字或图标。
- 触控目标 ≥ 44px（移动）；桌面 ≥ 32px。
- 日志/transcript 的滚动区域要有可聚焦容器和 `aria-label`。

## 9. Tailwind 4 / shadcn/ui 落地

目标：组件只写语义类名，不写 hex。实现时在 `apps/web/src/styles.css` 定义 CSS 变量，再映射到 Tailwind 4 / shadcn/ui。

| shadcn token | baton token |
|---|---|
| `--background` | `canvas` |
| `--foreground` | `ink` |
| `--card` | `surface-1` |
| `--card-foreground` | `ink` |
| `--popover` | `surface-2` |
| `--popover-foreground` | `ink` |
| `--primary` | `primary` |
| `--primary-foreground` | `on-primary` |
| `--secondary` | `surface-2` |
| `--secondary-foreground` | `ink` |
| `--muted` | `surface-2` |
| `--muted-foreground` | `ink-subtle` |
| `--accent` | `surface-3` |
| `--accent-foreground` | `ink` |
| `--destructive` | `danger` |
| `--border` | `hairline` |
| `--input` | `hairline` |
| `--ring` | `primary-focus` |
| `--radius` | `8px` |

自定义状态 token：

```css
--status-todo: #8a8f98;
--status-running: #4ea7fc;
--status-waiting: #f2c94c;
--status-review: #5e6ad2;
--status-done: #27a644;
--status-failed: #eb5757;
--status-cancelled: #62666d;

--attention-approval: #f2c94c;
--attention-reply: #f2c94c;
--attention-review: #5e6ad2;
```

规则：

- v1 只做暗色；不实现主题切换。要加亮色主题，先扩展本文件，再改代码。
- 不引入第二套 UI 库；shadcn/ui 组件按上表覆盖主题。
- 组件里禁止出现 `#hex`、`rgb()`、`hsl()` 字面量；只允许 `bg-background`、`text-foreground`、`border-border`、`bg-card`、`text-muted-foreground`、`bg-status-waiting/15`、`text-status-waiting` 这类语义类名。
- 新增状态色/attention 色时，先加 `--status-*` / `--attention-*`，再改组件。
- 图表/画布如果需要额外颜色，从语义色派生并限制在 5 种以内；不要引入新的品牌色。

## 10. Do / Don't

### Do

- 用表面阶梯 + 1px hairline 表达层级。
- 把 `primary` 留给主操作、焦点、选中和链接。
- 把语义色限制在状态、attention、风险、验收结果。
- 保持高密度：12px 卡片内边距、8px 卡片间距、14px 默认字号。
- UI 文案中文，代码标识符英文。
- UI 改动附截图，并说明用到的 DESIGN.md token。

### Don't

- 不要渐变、阴影、玻璃拟态、霓虹发光。
- 不要纯黑 `#000000` 画布。
- 不要第二个品牌色；不要用语义色做装饰。
- 不要用颜色作为状态的唯一表达。
- 不要把按钮做成 pill；按钮圆角 8px，badge 才用 pill。
- 不要在组件里硬编码颜色、字号、圆角、间距。
- 不要为了"好看"加大卡片、大留白、大标题；这是驾驶舱，不是落地页。
- 不要用 emoji 当图标。
- v1 不要做亮色主题。

## 11. 变更流程

1. `DESIGN.md` 是 web 视觉的唯一真源；任何新颜色、状态色、字体、圆角、间距先改这里。
2. 新增组件先在 `components:` 里加 token，再写实现；不要先在代码里试颜色。
3. UI PR 必须附截图或 gif，并在描述里列出使用的 token；验收时对照本文件。
4. 一次性样式不是例外：如果确实需要，新增组件 token，而不是 inline style。
5. 修改本文件后，运行 `pnpm verify`；如果引入了新依赖（如 `lucide-react`），同步更新 `THIRD_PARTY_NOTICES.md`。

## 12. 来源与许可

本文件基于 `VoltAgent/awesome-design-md` 中 `design-md/linear.app/DESIGN.md` 的公开设计分析（MIT License，Copyright (c) 2026 VoltAgent，2026-11-17 获取），针对 baton 的任务驾驶舱场景做了裁剪与扩展：

- 源仓库：https://github.com/VoltAgent/awesome-design-md
- 源文件：https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md
- 源许可：https://github.com/VoltAgent/awesome-design-md/blob/main/LICENSE

Linear 名称与品牌归其所有者；本项目仅借鉴公开设计分析中的色板、排版与表面层级，不代表与 Linear 存在关联或背书。
