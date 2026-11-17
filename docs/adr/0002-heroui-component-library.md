# ADR 0002：web 组件库选择 HeroUI v3

- 状态：accepted
- 日期：2026-11-17
- 关联：`docs/specs/2026-11-16-baton-architecture-design.md`、`DESIGN.md`

## 背景

M1-6a 要开始做 web 任务控制台：看板、任务详情、回复、审批、验收。
需要一个能在 React 19 + Tailwind 4 下工作的组件库，满足：

- 无障碍（键盘、焦点、屏幕阅读器）；
- 暗色主题可深度定制，能落到根目录 `DESIGN.md` 的 token；
- 数据密集型界面（看板、表格、日志）的组件覆盖；
- 支持按组件导入，避免把整套 UI 打进首屏；
- 许可允许商用，且维护活跃。

架构 spec §3.1 原先列的是 shadcn/ui。M1-6a 开工前重新评估组件库。

## 选项

1. **shadcn/ui**：复制代码到仓库，基于 Radix + Tailwind；定制自由，但组件要自己长期维护，且没有统一的组件 API 与升级路径。
2. **HeroUI v3**：`@heroui/react` + `@heroui/styles`，基于 React Aria + Tailwind 4；复合组件 API，无需 Provider，支持按组件子路径导入；Apache-2.0。
3. **MUI / Chakra / Mantine**：成熟，但分别带 CSS-in-JS 运行时、Emotion 或自有样式体系，与 Tailwind 4 的 token 体系重复。
4. **Headless（React Aria Components）+ 全自建样式**：无障碍最好，但 M1-6a 要同时写行为与视觉，成本过高。

## 决定

选 2，组件库锁定 **HeroUI v3**（`@heroui/react` + `@heroui/styles`）。根目录 `DESIGN.md` 以 HeroUI 官方 `DESIGN.md` 为基础，只追加 baton 的产品状态、看板与组件 addendum。

关键事实（2026-11-17 通过 npm registry 与 GitHub 仓库核实）：

- `@heroui/react` 最新稳定版 `3.2.7`（2026-10-28 发布），Apache-2.0。
- peer dependencies：React `>=19.0.0`、Tailwind CSS `>=4.0.0`、React Aria 系列。
- 支持按组件子路径导入（`@heroui/react/button`、`@heroui/react/card`），`sideEffects: false`。
- 默认主题通过 CSS 变量提供，暗色用 `.dark` 或 `[data-theme="dark"]`；HeroUI 官方也提供 `DESIGN.md` 给编码代理。
- GitHub `heroui-inc/heroui` 默认分支 `v3`，活跃维护，31k+ stars。

## 后果

**优点**

- React 19 / Tailwind 4 原生，无需 Provider，接入成本低。
- React Aria 承担键盘、焦点、屏幕阅读器等无障碍行为，符合 baton 的验收标准。
- 复合组件 API（`Card.Header`、`Select.Item`）比深嵌套 props 更容易组合。
- 按组件导入 + `sideEffects: false`，避免整库进入首屏。
- Apache-2.0，可商用；只需在 `THIRD_PARTY_NOTICES.md` 保留声明。

**代价**

- v1 直接使用 HeroUI 默认暗色主题，不自定义品牌色；baton 只在 addendum 里约束 7 列、attention 与看板/详情/审批/验收的布局。
- `@heroui/styles` 整包 CSS 约 1.1MB（unpacked）；M1-6a 先用整包，体积成为问题时再切按组件 CSS。
- v3 仍较新，升级可能带 breaking change；版本以 `package.json` 为准，升级前读官方 migration notes 并跑视觉回归。
- peer 依赖包含 React Aria 系列，依赖树比 shadcn/ui 大；由 pnpm 解析，CI 需验证没有 missing peer。

**约束**

- `apps/web` 不引入第二套 UI 库；图标统一 `lucide-react`。
- 组件内禁止硬编码颜色、字号、圆角、间距；只能使用 `DESIGN.md` 的 token 与 HeroUI 语义类名。
- 新增状态色/attention 色先改 `DESIGN.md`，再改代码。
- UI 改动必须附截图，并在 PR 描述里列出使用的 token。

## 何时重新评估

- HeroUI v3 出现阻塞性 breaking change 或维护停滞；
- 整包 CSS 或依赖树显著拖慢首屏，按组件导入也无法收敛；
- 关键组件（看板、虚拟列表、diff、命令面板）HeroUI 不覆盖且自建成本高；
- 需要亮色主题，而 HeroUI 的主题覆盖无法满足 `DESIGN.md`。

## 回退路径

`DESIGN.md` 的 baton addendum 与组件库解耦。若需要回退：

1. 保留 baton addendum 与语义类名；
2. 把 HeroUI 组件替换为 shadcn/ui 或 React Aria Components；
3. 保持 `apps/web` 只消费 `bg-background`、`text-foreground`、`bg-surface` 等语义类名，减少迁移面。

## 来源

- npm registry：`@heroui/react@3.2.7` 元数据（许可、peer dependencies、发布时间）
- GitHub：https://github.com/heroui-inc/heroui （默认分支 `v3`）
- 官方 quick-start：https://heroui.com/docs/react/getting-started/quick-start
- 官方主题文档：https://heroui.com/docs/react/getting-started/theming
- HeroUI DESIGN.md：https://heroui.com/react/DESIGN.md
- 默认主题变量：https://github.com/heroui-inc/heroui/blob/v3/packages/styles/themes/default/variables.css
