# ADR 0003：v1 移除 Docker 分发

- 状态：accepted
- 日期：2026-11-17
- 关联：`docs/specs/2026-11-16-baton-architecture-design.md`、`docs/constitution.md`
- 取代：主架构 spec §6.3（Docker）、§6.4 的 `docker.yml`、§6.5 的 GHCR 镜像行，以及 §7 中 M0/M3 的 Docker 相关交付

## 背景

主架构最初选择 **npm + Docker 双分发**：

- npm 面向本机 `npx`；
- Docker 面向服务器/NAS 一键部署，并计划在 M1 接入 Claude Agent SDK 后由平台包带入约 348MB 二进制。

后续验证发现三个前提不成立：

1. **容器无法可靠复用宿主 Claude Code 配置**。`compose.yaml` 挂的是命名卷，不是宿主 `~/.claude`；macOS 的 OAuth 凭据通常在 Keychain，Linux 容器读不到；即使 bind mount，uid、路径与写权限也会带来额外摩擦。
2. **真实引擎的运行时应该在本机**。Claude Code、后续的 Codex/DSH 都依赖本机登录态、工具链、skills 与文件系统；容器化会把它们和宿主环境切开。
3. **Docker 的“一键网页”价值被高估**。`apps/web` 构建成静态文件，由 daemon 通过 `BATON_WEB_ROOT` 提供；`npx @evanfang0054/baton` 本身就已经同时提供 daemon 与网页。Docker 打包的是完整 daemon，不是“只有网页”。

同时，把约 371MB 的专有平台二进制预装进镜像会带来体积、许可与再分发问题；而 v1 的核心场景是本地单用户，Docker 不是必需品。

## 选项

1. **保留 Docker + Claude**：在容器内装 SDK，用 API key 或挂载配置。代价是配置隔离、镜像体积、许可与双份认证路径。
2. **保留 Docker 但不装 Claude**：容器只跑 fake/演示/未来 server-mode。保留现有产物，成本低，但产品叙事容易误导。
3. **v1 移除 Docker**：只保留 npm/host-native；远程访问由用户自行用反向代理或 Tailscale。删除 Dockerfile、compose、docker workflow、smoke 与 runbook。

## 决定

选 3。

- v1 唯一分发渠道是 npm：`npx @evanfang0054/baton` / `pnpm dev`。
- 真实引擎以 host-native 运行，直接复用本机 Claude Code 的登录态、settings、skills 与历史。
- 删除 `Dockerfile`、`.dockerignore`、`compose.yaml`、`.github/workflows/docker.yml`、`scripts/docker-smoke.mjs`、`docs/runbooks/docker.md` 与 `package.json` 的 `docker:smoke`。
- CI 保留 required check `build`，由 `ci.yml` 中新增的 `build` job 提供，避免分支保护失效。
- 远程访问不再由 Docker 承担；默认只监听 `127.0.0.1`，需要时由用户用 Tailscale / Caddy / Nginx 反向代理 `7317` 并设置 `BATON_TOKEN`。

## 后果

**优点**

- 真实引擎路径与用户日常使用一致：本机 Claude Code、本机登录态、本机配置。
- 不再维护 Dockerfile/compose/docker workflow/smoke，减少一条分发与测试链路。
- 默认分发不包含专有平台二进制，体积、许可与再分发问题消失。
- CI 更简单；`build` 仍是独立 required check。

**代价**

- 失去 `docker compose up -d` 一键部署；NAS/服务器用户暂时没有容器化路径。
- 远程访问需要用户自行配置反向代理/TLS；不是开箱即用。
- 历史 M0/M1 的 plan、contract 与验收记录中仍有 Docker 条目；这些作为当时的实施记录保留，不代表当前能力。

## 何时重新评估

出现以下任一情况时，再开新 spec/ADR：

- 有明确的“服务器/NAS 常驻 + 容器化”需求；
- 需要“网页在容器、引擎在本机”的分离架构；
- 需要 API key 模式的多用户/远程部署；
- 有稳定的 host-agent/控制面-数据面方案，而不是仅把 daemon 塞进容器。

## 回退路径

1. 按新 spec 设计 host-agent 或 server-mode，明确认证、配置与数据流；
2. 重新引入 Dockerfile/compose/CI smoke，但不复用“容器内 Claude 复用宿主配置”的假设；
3. 在 `THIRD_PARTY_NOTICES.md` 与分发文档中重新声明专有二进制的许可与再分发口径。
