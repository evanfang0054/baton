# ADR 0004：不可信 workspace 仍加载 user settings

- 状态：accepted
- 日期：2026-11-18
- 关联：`docs/specs/2026-11-17-m1-claude-adapter-design.md` §6.1、`docs/adr/0003-drop-docker-from-v1.md`
- 修正：spec §6.1 中不可信 workspace `settingSources: []` 的矩阵

## 背景

M1-7a 的 trust 矩阵最初规定：不可信 workspace 使用 `settingSources: []`，以完全隔离项目配置。实现后用真实 SDK 验证发现：**清空 `settingSources` 同时切断了本机 Claude Code 的 OAuth 登录态**，SDK 返回 `Not logged in · Please run /login`。二分验证结果：

- `settingSources: []` → 失败；
- `settingSources: ['user']` → 成功；
- `strictMcpConfig: true`、`plugins: []` 单独不影响登录。

原因：host-native OAuth 凭据由 user settings 路径加载；`'user'` 指本机全局 `~/.claude`，不是被打开的项目。

## 选项

1. **保持 `[]`**：安全边界最严，但真实 Claude 不可用，与 host-native 目标冲突。
2. **不可信也加载 `['user']`**：只暴露用户自己的全局配置；项目 `.claude/settings.json`、`.claude/settings.local.json`、`.mcp.json` 仍不加载。
3. **要求 API key / OAuth env**：可用，但破坏「直接复用本机登录态」的产品前提，并增加配置负担。

## 决定

选 2。

- 不可信 workspace：`settingSources: ['user']`、`strictMcpConfig: true`、`disableAllHooks: true`。
- 可信 workspace：`settingSources: ['user', 'project']`、`strictMcpConfig: false`，hooks 由 workspace 开关与全局 kill switch 决定。
- 两种都保留 `allowManagedPermissionRulesOnly`、`disableBypassPermissionsMode`、读写目录边界。
- project/local settings 与 `.mcp.json` 仍只在显式 trust 后加载；trust 弹窗的承诺不变。

## 后果

**优点**

- host-native 登录态可用，真实 Claude 闭环不再被 trust 隔离误伤。
- 信任边界仍围绕「项目代码」：用户全局配置视为用户已授权。
- 不需要让用户额外配置 API key。

**代价**

- 不可信 workspace 会加载用户级 settings/plugins；若用户全局配置本身不可信，属于用户自担风险。
- 与 spec §6.1 的原始矩阵不一致；以本 ADR 为准，后续 spec 评审时回写。

## 回退路径

若未来要求「连 user settings 也不加载」，需要先提供独立的凭据注入路径（API key / OAuth token / credential helper），再恢复 `settingSources: []`。
