# baton 文档

| 目录 | 用途 |
|---|---|
| `specs/` | 设计规格。非平凡改动先有 spec，再有实现 |
| `contracts/` | 每个里程碑的 Definition of Done，开工前谈定 |
| `adr/` | 架构决策记录。只记录难以回退、且需要向后来者解释原因的决定 |
| `runbooks/` | 运维手册：Docker 部署、故障排查、数据备份与恢复 |

## 现行 spec

- [2026-11-16 v1 架构设计与工程规范](specs/2026-11-16-baton-architecture-design.md)

## 现行 contract

- [M0 骨架](contracts/M0-skeleton.contract.md)

## 现行 plan

- [M0 骨架实施计划](plans/2026-11-16-m0-skeleton.md)

## 约定

- spec 一旦进入实现阶段不再大改；方案变更以新的 spec 或 ADR 追加，并回链旧文档。
- 每个 spec 的 frontmatter 必须含 `spec_topic`、`decision_summary`、`design_approved`、`user_approved_at`、`gates`。
- 草案与讨论记录（如 `baton.ai/`）不进仓库，只作为背景材料引用。
