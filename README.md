# baton

它不演奏，只定拍子。

一个本地优先的 Agent 调度驾驶舱：画布是共享内存，看板是状态投影，总管只负责派活与验收。

## 状态

M0 骨架：可安装、可启动、可打包、可容器化。M1 起接入 Claude Code 与验收闭环。

## 本地运行

```bash
pnpm install
pnpm build
npx @evanfang0054/baton
```

打开终端输出的地址；需要 token 时用 `/?token=` 配对。

## Docker

```bash
cp .env.example .env
# 填入 BATON_TOKEN 与 ANTHROPIC_API_KEY
docker compose up -d
```

详见 [Docker 部署](docs/runbooks/docker.md)。

## 开发

```bash
pnpm verify       # typecheck + lint + format + 守卫 + 测试 + build
pnpm verify:full  # verify + e2e
pnpm pack:check   # npm pack 安装链路自检
pnpm docker:smoke # 镜像构建与容器健康检查
```

## 文档

- [架构设计与工程规范](docs/specs/2026-11-16-baton-architecture-design.md)
- [M0 骨架合同](docs/contracts/M0-skeleton.contract.md)
- [M0 实施计划](docs/plans/2026-11-16-m0-skeleton.md)
- [项目宪法](docs/constitution.md)
