---
name: HeroUI Default Theme
library: "@heroui/react"
styles: "@heroui/styles"
modes:
  - light
  - dark
source: "https://github.com/heroui-inc/heroui/blob/v3/packages/styles/themes/default/variables.css"
---

# HeroUI Default Theme

Use this file as the visual implementation contract when building a product with HeroUI v3. It describes the default HeroUI theme for designers and coding agents. The theme CSS remains the source of truth.

## Setup

Install `@heroui/react` and import HeroUI after Tailwind CSS:

```css
@import "tailwindcss";
@import "@heroui/styles";
```

Apply the semantic canvas colors at the application root:

```tsx
<body className="bg-background text-foreground">{children}</body>
```

Use `class="light"` or `data-theme="light"` for light mode and `class="dark"` or `data-theme="dark"` for dark mode. The `default` theme is the light theme.

## Design Direction

- Build calm, modern interfaces with a clear content hierarchy.
- Prefer whitespace, typography, and surface levels over decoration.
- Use one strong accent for primary actions and reserve status colors for meaning.
- Compose interfaces from HeroUI components before creating custom primitives.
- Keep interactions accessible, keyboard friendly, and visibly focused.
- Let semantic tokens adapt the interface between light and dark modes.

## Colors

Use semantic HeroUI tokens and Tailwind utilities in product code. Raw values are included for design handoff and visual QA only. Do not branch component code by color mode.

| Role | Tailwind utilities | CSS variables | Light | Dark | Purpose |
| --- | --- | --- | --- | --- | --- |
| Canvas | `bg-background text-foreground` | `--background`, `--foreground` | `oklch(0.9702 0 0)`, `oklch(0.2103 0.0059 285.89)` | `oklch(12% 0.005 285.823)`, `oklch(0.9911 0 0)` | Page background and primary content |
| Surface | `bg-surface text-surface-foreground` | `--surface`, `--surface-foreground` | white, foreground | `oklch(0.2103 0.0059 285.89)`, foreground | Cards and non-floating containers |
| Secondary surface | `bg-surface-secondary` | `--surface-secondary` | `oklch(0.9524 0.0013 286.37)` | `oklch(0.257 0.0037 286.14)` | Nested or lower-emphasis regions |
| Tertiary surface | `bg-surface-tertiary` | `--surface-tertiary` | `oklch(0.9373 0.0013 286.37)` | `oklch(0.2721 0.0024 247.91)` | Stronger surface separation |
| Overlay | `bg-overlay text-overlay-foreground` | `--overlay`, `--overlay-foreground` | white, foreground | `oklch(0.2103 0.0059 285.89)`, foreground | Popovers, menus, dialogs, and tooltips |
| Backdrop | `bg-backdrop` | `--backdrop` | black at 50% | black at 60% | Content dimming behind overlays |
| Muted content | `text-muted` | `--muted` | `oklch(0.5517 0.0138 285.94)` | `oklch(70.5% 0.015 286.067)` | Supporting text and secondary icons |
| Neutral action | `bg-default text-default-foreground` | `--default`, `--default-foreground` | `oklch(94% 0.001 286.375)`, eclipse | `oklch(27.4% 0.006 286.033)`, snow | Neutral controls and selected states |
| Accent | `bg-accent text-accent-foreground` | `--accent`, `--accent-foreground` | `oklch(0.6204 0.195 253.83)`, snow | same as light | Primary actions, focus, and emphasis |
| Success | `bg-success text-success-foreground` | `--success`, `--success-foreground` | `oklch(0.7329 0.1935 150.81)`, eclipse | same as light | Positive outcomes and completed states |
| Warning | `bg-warning text-warning-foreground` | `--warning`, `--warning-foreground` | `oklch(0.7819 0.1585 72.33)`, eclipse | `oklch(0.8203 0.1388 76.34)`, eclipse | Caution and attention |
| Danger | `bg-danger text-danger-foreground` | `--danger`, `--danger-foreground` | `oklch(0.6532 0.2328 25.74)`, snow | `oklch(0.594 0.1967 24.63)`, snow | Errors and destructive actions |
| Field | `bg-field text-field-foreground` | `--field-background`, `--field-foreground` | white, eclipse | eclipse, foreground | Inputs and interactive fields |
| Border | `border-border` | `--border` | `oklch(90% 0.004 286.32)` | `oklch(28% 0.006 286.033)` | Component boundaries |
| Separator | `border-separator` | `--separator` | `oklch(92% 0.004 286.32)` | `oklch(25% 0.006 286.033)` | Quiet structural dividers |

Hover, focus, soft, inverse, and secondary or tertiary border colors are derived with `color-mix()`. Use utilities such as `bg-accent-hover`, `bg-accent-soft`, `text-accent-soft-foreground`, `border-border-secondary`, and `border-separator-secondary` instead of recreating those formulas.

## Typography

HeroUI inherits the application's font family and uses Tailwind's type scale. Preserve the component defaults unless the product has its own type system.

- Use concise, descriptive headings in sentence case.
- Use `text-foreground` for primary content and `text-muted` for supporting content.
- Keep body copy readable with a comfortable line height and constrained line length.
- Use tabular numbers for changing metrics, prices, counters, and aligned numeric data.
- Avoid all-caps labels except for short, established conventions.

## Layout

The spacing base is `--spacing: 0.25rem`, giving the system a 4px rhythm through Tailwind spacing utilities.

- Use consistent Tailwind gaps and padding rather than one-off values.
- Keep related controls and content visually grouped.
- Constrain wide reading layouts and size containers to their content.
- Avoid doubling parent and child padding in the same direction.
- Align sibling cards, controls, labels, and metrics to shared visual anchors.

## Shapes

The base radius is `--radius: 0.5rem` (8px). The default field radius is `--field-radius: calc(var(--radius) * 1.5)` (12px).

| Utility | Formula | Default value |
| --- | --- | --- |
| `rounded-xs` | `calc(var(--radius) * 0.25)` | 2px |
| `rounded-sm` | `calc(var(--radius) * 0.5)` | 4px |
| `rounded-md` | `calc(var(--radius) * 0.75)` | 6px |
| `rounded-lg` | `calc(var(--radius) * 1)` | 8px |
| `rounded-xl` | `calc(var(--radius) * 1.5)` | 12px |
| `rounded-2xl` | `calc(var(--radius) * 2)` | 16px |
| `rounded-3xl` | `calc(var(--radius) * 3)` | 24px |
| `rounded-4xl` | `calc(var(--radius) * 4)` | 32px |

Use the scale consistently. Inner media and nested surfaces should have a visibly related, usually smaller, radius than their parent.

## Elevation and Depth

- Use `shadow-surface` for cards and raised page content.
- Use `shadow-overlay` for floating layers such as dialogs, menus, and popovers.
- Use `shadow-field` for form controls when the component applies it.
- Dark mode intentionally removes surface and field shadows and gives overlays a subtle inset edge.
- Do not stack custom shadows on HeroUI components that already provide elevation.

## Components

- **Buttons:** Use semantic variants. `primary` is the main action, `secondary` is an alternative, `tertiary` is dismissive or low emphasis, `outline` is a bordered low-emphasis action, `ghost` is an unbordered low-emphasis action, `danger` is destructive, and `danger-soft` is a quieter destructive action. Prefer one primary action per context and reach for an existing variant instead of restyling a button.
- **Cards and surfaces:** Use `Card`, `Surface`, and semantic surface utilities. Create hierarchy with surface levels and spacing before adding borders.
- **Forms:** Use HeroUI field components so background, foreground, placeholder, border, focus, radius, validation, and disabled states stay consistent.
- **Status:** Use success, warning, and danger only for their semantic meanings. Pair color with text or an accessible label.
- **Overlays:** Use HeroUI `Modal`, `Popover`, `Dropdown`, and `Tooltip` components so focus management, dismissal, and keyboard behavior remain accessible.
- **Compound components:** Compose exported parts instead of replacing component behavior with custom divs. Preserve labels, roles, and keyboard interactions.

## Interaction

- Use HeroUI and React Aria states, including `data-hovered`, `data-pressed`, `data-focus-visible`, `data-disabled`, and `data-invalid`.
- Every interactive element needs a visible focus indicator. The default focus color is the accent, with a 2px ring offset.
- The default disabled opacity is `0.5`; disabled controls use a not-allowed cursor.
- Use motion to clarify state changes, not as decoration. Respect reduced-motion preferences.
- Keep icon-only and touch controls large enough to target and give them accessible labels.

## Do

- Use HeroUI components and their documented variants before writing custom primitives.
- Use semantic tokens as implementation handles and raw values only for reference or migration.
- Use the same token in light and dark modes and let CSS resolve the current value.
- Establish hierarchy with content order, spacing, type, and surface level.
- Reserve accent for meaningful emphasis and keep status colors semantic.
- Use separators sparingly; prefer spacing for ordinary grouping.
- Keep active, selected, loading, invalid, and disabled states visible and accessible.

## Don't

- Don't hardcode colors, shadows, radii, or spacing when a HeroUI token or Tailwind utility exists.
- Don't use raw neutral palette classes such as `gray-*` where a semantic surface or content token applies.
- Don't use color alone to communicate state or hierarchy.
- Don't mix unrelated radius, padding, or elevation systems in one view.
- Don't make static content look interactive with hover or pressed effects.
- Don't overuse cards, borders, badges, icons, accent color, or nested heavy surfaces.
- Don't bypass HeroUI interaction behavior with inaccessible custom markup.

## Source of Truth

- Default theme variables: https://github.com/heroui-inc/heroui/blob/v3/packages/styles/themes/default/variables.css
- Tailwind token mappings: https://github.com/heroui-inc/heroui/blob/v3/packages/styles/themes/shared/theme.css
- Component documentation: https://heroui.com/docs/react/components
- Colors: https://heroui.com/docs/react/getting-started/colors
- Theming: https://heroui.com/docs/react/getting-started/theming
- Design principles: https://heroui.com/docs/react/getting-started/design-principles

When this file and the current package disagree, follow the installed HeroUI version and its theme CSS.

---

# baton addendum

以下内容是 baton 在 HeroUI 默认主题之上的项目约定。与上面的 HeroUI 默认值冲突时，以本 addendum 为准。

## 1. 范围与主题

- v1 **只做暗色**：`<html class="dark" data-theme="dark">`；不实现主题切换。
- 使用 HeroUI 默认的 `--background`、`--surface`、`--accent`、`--success`、`--warning`、`--danger`，不自定义品牌色。
- 如后续需要品牌化，先改本 addendum，再在 `apps/web/src/styles.css` 覆盖变量；不要直接改 HeroUI 官方部分。
- UI 文案中文，代码标识符英文。

## 2. 任务状态 → 看板列

对外 7 列，内部 9 态按下表投影：

| 看板列 | 内部状态 | 列头/卡片表达 |
|---|---|---|
| 未规划 | canvas 上没有任务的 agent 节点 | `Chip color="default" variant="soft"`；空列用虚线边框 |
| 待办 | `todo`、`queued` | `Chip color="default" variant="soft"` |
| 进行中 | `running`、`verifying` | `Chip color="accent" variant="soft"` + spinner |
| 待审核 | `waiting_input` | `Chip color="warning" variant="soft"` + 图标 |
| 待验收 | `review` | `Chip color="accent" variant="soft"` + check 图标 |
| 已完成 | `done` | `Chip color="success" variant="soft"` |
| 已取消 | `cancelled`、`failed` | 已取消用 `default` + `text-muted`；失败用 `danger` |

规则：

- 状态不能只靠颜色表达，必须有文字或图标。
- `running` 与 `review` 都用 accent，靠图标与列名区分；不要为了区分再加第二种蓝色。
- `failed` 才用 danger；`stalled` 仍属于「待审核」，不要误标成失败。

## 3. attention

| attention | 表达 | 说明 |
|---|---|---|
| `needs_approval` | `Chip color="warning"` + 盾牌图标 + 「待审批」 | `waitingReason=approval` |
| `needs_reply` | `Chip color="warning"` + 对话图标 + 「待回复」 | `question/dropped` |
| `needs_attention` | `Chip color="warning"` + 警示图标 + 「需关注」 | `waitingReason=stalled` |
| `needs_review` | `Chip color="accent"` + check 图标 + 「待验收」 | `review` |
| `none` | 不渲染 | 其他状态 |

审批与回复同为 warning，靠图标 + 文案区分，不新增第三种黄色。

## 4. 组件约定

- **应用壳**：顶栏 56px，`bg-background`，底部 `border-b border-separator`；左侧导航/看板 240–280px；中心画布自适应；右侧详情 360–440px。
- **看板列**：最小 280px，列间距 12px，列头 40px，卡片间距 8px；列体用 `bg-background`，不画外框，用 1px `border-separator` 分隔。
- **任务卡**：`Card` / `Surface`，`bg-surface`，`rounded-lg`，`p-3`，1px `border-separator`；标题 `text-sm font-medium` 两行截断；右上角 attention badge；元信息 `text-xs text-muted`；等待中显示「已等 12 分钟」，用 `text-warning`。
- **状态 badge**：HeroUI `Chip`，`size="sm"`，`variant="soft"`；不要用整块高饱和填充。
- **详情面板**：`bg-surface`，sticky 头部 56px；section 间距 16px；section 之间用 `border-separator`。
- **Transcript**：不用聊天气泡；左侧角色标签（你 / Agent / 工具 / 系统），右侧内容；角色 12/500，正文 14/400，工具输出、命令、diff 用 mono 13；工具输出块 `bg-background` + `border border-separator` + `rounded-lg` + `p-3`；长输出折叠 + 虚拟滚动。
- **审批卡**：`Card` + `border-warning`，左侧 2px warning 竖线；头部「需要授权」+ 风险 `Chip`；命令/参数用 mono 块；按钮「允许」「拒绝」，高风险时「允许」降为次按钮。
- **验收卡**：`Card` + `border-accent`；退出码 `Chip`（0 = success，非 0 = danger）；diffStat + 输出尾部（mono，可滚动）；「通过」主按钮，「打回」次按钮 + 必填反馈。
- **输入框**：HeroUI `Input` / `TextArea`，`bg-field`，`border-border`；focus 用 HeroUI 默认焦点环。
- **按钮**：HeroUI 语义变体；每个场景只有一个 `primary`；取消/跳过用 `tertiary`；破坏性操作才用 `danger`。
- **图标**：统一 `lucide-react`（HeroUI 不自带图标），1.5px stroke，16/20px；不用 emoji。
- **动效**：120–160ms，只做状态过渡；尊重 `prefers-reduced-motion`。

## 5. 规则

- 组件里禁止出现 `#hex`、`rgb()`、`hsl()` 字面量；只允许 HeroUI 语义类名：`bg-background`、`text-foreground`、`bg-surface`、`text-surface-foreground`、`bg-surface-secondary`、`bg-overlay`、`text-muted`、`bg-default`、`bg-accent`、`bg-success`、`bg-warning`、`bg-danger`、`bg-field`、`border-border`、`border-separator`、`text-accent-soft-foreground` 等。
- 不引入第二套 UI 库；图标只用 `lucide-react`。
- 状态/attention 的颜色只用于状态语义，不做装饰。
- 新增颜色、状态色、字体、圆角前，先改本 addendum，再改代码。
- UI 改动必须附截图，并在 PR 描述里列出使用的 token。
- HeroUI 版本以 `package.json` 为准；升级前先读官方 `DESIGN.md` 与 migration notes，并跑视觉回归。

## 6. 维护方式

- 本文件 = HeroUI 官方 `DESIGN.md` + baton addendum。
- HeroUI 升级时，重新下载官方部分，保留并重新应用 addendum；不要直接改官方段落。
- 官方 `DESIGN.md` 来源：https://heroui.com/react/DESIGN.md （Apache-2.0）。
