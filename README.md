# baton

它不演奏，只定拍子。

一个本地优先的 Agent 调度驾驶舱：画布是共享内存，看板是状态投影，总管只负责派活与验收。

## 状态

M2 已收口：总管 Router v0、无人值守与汇报、移动端响应式控制台。
M3-1 交付验收增强（diff 视图、worktree 隔离、retry/reopen 与任务历史）已实现，分支 `feat/m3-1-diff` 待合并。v1 不使用 Docker。

## 本地运行

```bash
pnpm install
pnpm build
npx @evanfang0054/baton
```

打开终端输出的地址；需要 token 时用 `/?token=` 配对。

## 远程访问

v1 默认只监听 `127.0.0.1`。需要从其他设备访问时，自行用 Tailscale / Caddy / Nginx 反向代理 `7317`，并设置 `BATON_TOKEN`。详见 [本地运行与运维](docs/runbooks/local.md)。

## 开发

```bash
pnpm verify       # typecheck + lint + format + 守卫 + 测试 + build
pnpm verify:full  # verify + e2e
pnpm pack:check   # npm pack 安装链路自检
```

## 文档

- [架构设计与工程规范](docs/specs/2026-11-16-baton-architecture-design.md)
- [M0 骨架合同](docs/contracts/M0-skeleton.contract.md)
- [M0 实施计划](docs/plans/2026-11-16-m0-skeleton.md)
- [项目宪法](docs/constitution.md)
