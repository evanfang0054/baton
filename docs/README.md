# baton 文档

| 目录 | 用途 |
|---|---|
| `specs/` | 设计规格。非平凡改动先有 spec，再有实现 |
| `contracts/` | 每个里程碑的 Definition of Done，开工前谈定 |
| `adr/` | 架构决策记录。只记录难以回退、且需要向后来者解释原因的决定 |
| `runbooks/` | 运维手册：Docker 部署、故障排查、数据备份与恢复 |

## 现行 spec

- [2026-11-16 v1 架构设计与工程规范](specs/2026-11-16-baton-architecture-design.md)
- [2026-11-17 M1-1/M1-2 协议领域模型与状态机设计](specs/2026-11-17-m1-protocol-state-machine-design.md)
- [2026-11-17 M1-3/M1-4 上下文、策略与适配器契约设计](specs/2026-11-17-m1-context-policy-adapter-design.md)
- [2026-11-17 M1-5 daemon 运行时闭环设计](specs/2026-11-17-m1-daemon-runtime-design.md)

## 现行 contract

- [M0 骨架](contracts/M0-skeleton.contract.md)
- [M1-1/M1-2 协议领域模型与状态机](contracts/M1-protocol-state-machine.contract.md)
- [M1-3/M1-4 上下文、策略与适配器](contracts/M1-context-policy-adapter.contract.md)
- [M1-5 daemon 运行时闭环](contracts/M1-daemon-runtime.contract.md)

## 现行 plan

- [M0 骨架实施计划](plans/2026-11-16-m0-skeleton.md)
- [M1-1/M1-2 协议领域模型与状态机实施计划](plans/2026-11-17-m1-protocol-state-machine.md)
- [M1-3/M1-4 上下文、策略与适配器实施计划](plans/2026-11-17-m1-context-policy-adapter.md)
- [M1-5 daemon 运行时闭环实施计划](plans/2026-11-17-m1-daemon-runtime.md)

## 约定

- spec 一旦进入实现阶段不再大改；方案变更以新的 spec 或 ADR 追加，并回链旧文档。
- 每个 spec 的 frontmatter 必须含 `spec_topic`、`decision_summary`、`design_approved`、`user_approved_at`、`gates`。
- 草案与讨论记录（如 `baton.ai/`）不进仓库，只作为背景材料引用。
