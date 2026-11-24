# baton 文档

| 目录 | 用途 |
|---|---|
| `specs/` | 设计规格。非平凡改动先有 spec，再有实现 |
| `contracts/` | 每个里程碑的 Definition of Done，开工前谈定 |
| `adr/` | 架构决策记录。只记录难以回退、且需要向后来者解释原因的决定 |
| `runbooks/` | 运维手册：本地启动、故障排查、数据备份与恢复 |

## 现行 runbook

- [本地运行与运维](runbooks/local.md)
- [总管模型配置](runbooks/supervisor-config.md)
- [移动端访问与运维](runbooks/mobile-access.md)

## 现行 spec

- [2026-11-16 v1 架构设计与工程规范](specs/2026-11-16-baton-architecture-design.md)
- [2026-11-17 M1-1/M1-2 协议领域模型与状态机设计](specs/2026-11-17-m1-protocol-state-machine-design.md)
- [2026-11-17 M1-3/M1-4 上下文、策略与适配器契约设计](specs/2026-11-17-m1-context-policy-adapter-design.md)
- [2026-11-17 M1-5 daemon 运行时闭环设计](specs/2026-11-17-m1-daemon-runtime-design.md)
- [2026-11-17 M1-5a 任务注意力语义设计](specs/2026-11-17-m1-attention-semantics-design.md)
- [2026-11-17 M1-6a 任务控制台设计](specs/2026-11-17-m1-web-console-design.md)
- [2026-11-17 M1-7a Claude 适配器与安全基线设计](specs/2026-11-17-m1-claude-adapter-design.md)
- [2026-11-18 M1-6b 画布上下文与关系设计](specs/2026-11-18-m1-6b-canvas-context-design.md)
- [2026-11-18 M2-1 总管 Router v0 设计](specs/2026-11-18-m2-supervisor-design.md)
- [2026-11-19 M2-2a 无人值守与汇报设计](specs/2026-11-19-m2-autopilot-design.md)
- [2026-11-19 M2-2b 移动端响应式控制台设计](specs/2026-11-19-m2-2b-mobile-console-design.md)
- [2026-11-19 M3-1 交付验收增强设计](specs/2026-11-19-m3-delivery-acceptance-design.md)
- [2026-11-20 M4 总管秘书化设计](specs/2026-11-20-m4-supervisor-secretary-design.md)
- [2026-11-20 工作区目录选择器](specs/2026-11-20-workspace-directory-picker.md)
- [2026-11-20 总管画布感知](specs/2026-11-20-supervisor-canvas-awareness.md)
- [2026-11-20 M5-1 总管售后与批量设计](specs/2026-11-20-m5-supervisor-aftersales-design.md)
- [2026-11-21 M5-3 上下文交接设计](specs/2026-11-21-m5-3-context-handoff-design.md)
- [2026-11-21 M6-1 任务现场 v0 设计](specs/2026-11-21-m6-task-scene-design.md)
- [2026-11-21 M6-2 上下文再注入与轻验收证据设计](specs/2026-11-21-m6-2-context-injection-design.md)
- [2026-11-21 M6-3 验收证据与放权护栏设计](specs/2026-11-21-m6-3-acceptance-evidence-design.md)
- [2026-11-22 M6-5 总管自治与注意力设计](specs/2026-11-22-m6-5-supervisor-autonomy-design.md)
- [2026-11-22 M7 交付工作台与 SOP 流程设计](specs/2026-11-22-m7-delivery-playbook-design.md)
- [2026-11-24 总管右栏收敛为聊天流设计](specs/2026-11-24-supervisor-chat-only-digest-design.md)
- [2026-11-24 工作区标注与画布删除设计](specs/2026-11-24-workspace-annotations-canvas-delete-design.md)
- [2026-11-24 标注文字与验收清单反馈设计](specs/2026-11-24-annotation-text-and-acceptance-feedback-design.md)

## 现行 ADR

- [0001 不做完整事件溯源，task.status 作为投影](adr/0001-no-full-event-sourcing.md)
- [0002 web 组件库选择 HeroUI v3](adr/0002-heroui-component-library.md)
- [0003 v1 移除 Docker 分发](adr/0003-drop-docker-from-v1.md)
- [0004 不可信 workspace 仍加载 user settings](adr/0004-untrusted-loads-user-settings.md)
- [0005 按任务跳过审批与结构化提问](adr/0005-bypass-permissions-and-questions.md)
- [0006 M2-2a 契约实现校正](adr/0006-m2-autopilot-contract-adjustments.md)
- [0007 移动端从只读改为响应式控制台](adr/0007-mobile-control-console.md)
- [0008 总管委派验收与委派审批（代验收被 0009 取代）](adr/0008-supervisor-delegated-authority.md)
- [0009 总管预验收与人工终审](adr/0009-supervisor-preliminary-review.md)
- [0011 交付拥有画布](adr/0011-delivery-owned-canvas.md)

## 现行 contract

- [M0 骨架](contracts/M0-skeleton.contract.md)
- [M1-1/M1-2 协议领域模型与状态机](contracts/M1-protocol-state-machine.contract.md)
- [M1-3/M1-4 上下文、策略与适配器](contracts/M1-context-policy-adapter.contract.md)
- [M1-5 daemon 运行时闭环](contracts/M1-daemon-runtime.contract.md)
- [M1-5a 任务注意力语义](contracts/M1-attention-semantics.contract.md)
- [M1-6a 任务控制台](contracts/M1-web-console.contract.md)
- [M1-7a Claude 适配器与安全基线](contracts/M1-claude-adapter.contract.md)
- [M1-6b 画布上下文与关系](contracts/M1-6b-canvas-context.contract.md)
- [M2-1 总管 Router v0](contracts/M2-supervisor-v0.contract.md)
- [M2-2a 无人值守与汇报 v0](contracts/M2-autopilot-v0.contract.md)
- [M2-2b 移动端响应式控制台](contracts/M2-2b-mobile-console.contract.md)
- [M3-1 交付验收增强](contracts/M3-1-delivery-acceptance.contract.md)
- [M5-1 总管售后与批量](contracts/M5-1-supervisor-aftersales.contract.md)
- [M5-3 上下文交接](contracts/M5-3-context-handoff.contract.md)
- [M6-1 任务现场](contracts/M6-1-task-scene.contract.md)
- [M6-2 上下文再注入与轻验收证据](contracts/M6-2-context-injection.contract.md)
- [M6-3 验收证据与放权护栏](contracts/M6-3-acceptance-evidence.contract.md)
- [M6-5 总管自治与注意力](contracts/M6-5-supervisor-autonomy.contract.md)
- [M7 交付工作台与 SOP 流程](contracts/M7-delivery-playbook.contract.md)

## 现行 plan

- [M0 骨架实施计划](plans/2026-11-16-m0-skeleton.md)
- [M1-1/M1-2 协议领域模型与状态机实施计划](plans/2026-11-17-m1-protocol-state-machine.md)
- [M1-3/M1-4 上下文、策略与适配器实施计划](plans/2026-11-17-m1-context-policy-adapter.md)
- [M1-5 daemon 运行时闭环实施计划](plans/2026-11-17-m1-daemon-runtime.md)
- [M1-5a 任务注意力语义实施计划](plans/2026-11-17-m1-attention-semantics.md)
- [M1-6a 契约层实施计划](plans/2026-11-17-m1-web-console-contracts.md)
- [M1-6a Web 壳与看板实施计划](plans/2026-11-17-m1-web-ui.md)
- [M1-6a 任务详情与人闸门实施计划](plans/2026-11-17-m1-web-detail-gates.md)
- [M1-6a 可编辑画布与任务创建实施计划](plans/2026-11-17-m1-web-canvas.md)
- [M1-7a 性能热路径实施计划](plans/2026-11-17-m1-7a-performance.md)
- [M1-7a 契约与并发基座实施计划](plans/2026-11-17-m1-7a-foundation.md)
- [M1-7a Claude adapter 与 daemon 接线实施计划](plans/2026-11-18-m1-7a-adapter-wiring.md)
- [M1-7a Web UX 与验收实施计划](plans/2026-11-18-m1-7a-web-acceptance.md)
- [M1-6b 后端实施计划](plans/2026-11-18-m1-6b-context-core.md)
- [M1-6b Web 实施计划](plans/2026-11-18-m1-6b-context-web.md)
- [M2-1 总管契约层实施计划](plans/2026-11-18-m2-supervisor-contracts.md)
- [M2-1 总管 daemon 实施计划](plans/2026-11-18-m2-supervisor-daemon.md)
- [M2-1 总管 Web 实施计划](plans/2026-11-18-m2-supervisor-web.md)
- [M2-1 总管验收实施计划](plans/2026-11-18-m2-supervisor-acceptance.md)
- [M2-2a 契约层实施计划](plans/2026-11-19-m2-autopilot-contracts.md)
- [M2-2a daemon 实施计划](plans/2026-11-19-m2-autopilot-daemon.md)
- [M2-2a web 实施计划](plans/2026-11-19-m2-autopilot-web.md)
- [M2-2a 验收实施计划](plans/2026-11-19-m2-autopilot-acceptance.md)
- [M2-2b 移动端响应式控制台：基础壳实施计划](plans/2026-11-19-m2-2b-mobile-foundation.md)
- [M2-2b 移动端响应式控制台：任务与闸门实施计划](plans/2026-11-19-m2-2b-mobile-tasks.md)
- [M2-2b 移动端响应式控制台：控制面实施计划](plans/2026-11-19-m2-2b-mobile-controls.md)
- [M2-2b 移动端响应式控制台：验收实施计划](plans/2026-11-19-m2-2b-mobile-acceptance.md)
- [M3-1 diff 视图实施计划](plans/2026-11-19-m3-1-diff.md)
- [M3-1 worktree 隔离实施计划](plans/2026-11-19-m3-1-worktree.md)
- [M3-1 retry/reopen/任务历史实施计划](plans/2026-11-19-m3-1-aftersales-history.md)
- [M3-1 验收与文档收口实施计划](plans/2026-11-19-m3-1-acceptance.md)
- [M5-1 总管售后 daemon 实施计划](plans/2026-11-20-m5-1-aftersales-daemon.md)
- [M5-1 总管售后 web 实施计划](plans/2026-11-20-m5-1-aftersales-web.md)
- [M5-1 总管售后验收实施计划](plans/2026-11-20-m5-1-aftersales-acceptance.md)
- [M5-3 交接 core + daemon 实施计划](plans/2026-11-21-m5-3-handoff-core-daemon.md)
- [M5-3 交接 web 实施计划](plans/2026-11-21-m5-3-handoff-web.md)
- [M5-3 交接验收实施计划](plans/2026-11-21-m5-3-handoff-acceptance.md)
- [M6-1 protocol + core + migration 0010 实施计划](plans/2026-11-21-m6-1-protocol-core.md)
- [M6-1 daemon 实施计划](plans/2026-11-21-m6-1-daemon.md)
- [M6-1 web 画布实施计划](plans/2026-11-21-m6-1-canvas-web.md)
- [M6-1 web 看板实施计划](plans/2026-11-21-m6-1-board-attention.md)
- [M6-1 验收实施计划](plans/2026-11-21-m6-1-acceptance.md)
- [M6-2 protocol + core + migration 0011 实施计划](plans/2026-11-21-m6-2-protocol-core.md)
- [M6-2 daemon 实施计划](plans/2026-11-21-m6-2-daemon.md)
- [M6-2 web 画布实施计划](plans/2026-11-21-m6-2-canvas-web.md)
- [M6-2 web 任务实施计划](plans/2026-11-21-m6-2-tasks-web.md)
- [M6-2 验收实施计划](plans/2026-11-21-m6-2-acceptance.md)
- [M6-3 protocol + core + migration 0012 实施计划](plans/2026-11-21-m6-3-protocol-core.md)
- [M6-3 daemon 验收实施计划](plans/2026-11-21-m6-3-daemon-acceptance.md)
- [M6-3 daemon 护栏实施计划](plans/2026-11-21-m6-3-daemon-guardrails.md)
- [M6-3 web 任务实施计划](plans/2026-11-21-m6-3-tasks-web.md)
- [M6-3 画布与验收实施计划](plans/2026-11-21-m6-3-canvas-acceptance.md)
- [M6-5 治理底座实施计划](plans/2026-11-22-m6-5-governance.md)
- [M6-5 注意力与失败摘要实施计划](plans/2026-11-22-m6-5-attention-failure.md)
- [M6-5 计划、模板与批量实施计划](plans/2026-11-22-m6-5-plan-templates-batch.md)
- [M6-5 验收收口实施计划](plans/2026-11-22-m6-5-acceptance.md)
- [M7 交付工作台执行图](plans/2026-11-22-m7-0-execution-map.md)
- [M7-1 protocol + core + migration 0015 实施计划](plans/2026-11-22-m7-1-protocol-core-migration.md)
- [M7-2 daemon 交付、产物与标注实施计划](plans/2026-11-22-m7-2-daemon-delivery-artifact-annotation.md)
- [M7-3 Web 交付工作台实施计划](plans/2026-11-22-m7-3-web-shell-board-canvas.md)

## 验收证据

- [M2-1 总管真实链路验收（阻塞，待模型配置）](evidence/2026-11-18-m2-supervisor/README.md)
- [M2-2a 无人值守与汇报验收](evidence/2026-11-19-m2-autopilot/README.md)
- [M2-2b 移动端响应式控制台验收](evidence/2026-11-19-m2-2b-mobile-console/README.md)
- [M3-1 交付验收增强验收](evidence/2026-11-19-m3-1-delivery-acceptance/README.md)
- [工作区目录选择器验收](evidence/2026-11-20-workspace-picker/README.md)
- [M5-1 总管售后与批量验收](evidence/2026-11-21-m5-supervisor-aftersales/README.md)
- [M5-3 上下文交接验收](evidence/2026-11-21-m5-3-context-handoff/README.md)
- [M6-1 任务现场验收](evidence/2026-11-21-m6-task-scene/README.md)
- [M6-2 上下文再注入验收](evidence/2026-11-21-m6-2-context-injection/README.md)
- [M6-3 验收证据真实链路](evidence/2026-11-21-m6-3-acceptance/README.md)
- [M6-5 总管自治与注意力真实链路](evidence/2026-11-22-m6-5/README.md)

## 约定

- spec 一旦进入实现阶段不再大改；方案变更以新的 spec 或 ADR 追加，并回链旧文档。
- 每个 spec 的 frontmatter 必须含 `spec_topic`、`decision_summary`、`design_approved`、`user_approved_at`、`gates`。
- 草案与讨论记录（如 `baton.ai/`）不进仓库，只作为背景材料引用。
- Docker 已从 v1 移除（ADR 0003）；历史 plan/contract 中的 Docker 条目仅作为当时的实施记录保留。
