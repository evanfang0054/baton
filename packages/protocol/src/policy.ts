import { z } from 'zod'
import { RiskLevel } from './enums.js'

export const DEFAULT_APPROVAL_ALLOW = [
  'Read',
  'Grep',
  'Glob',
  'Edit:src/**',
  'Edit:tests/**',
  // 交付产物必须落在 .baton/deliveries；这是阶段 prompt 明确要求的路径。
  'Edit:.baton/deliveries/**',
  'Write:.baton/deliveries/**',
  'Bash:pnpm {test,lint,typecheck,build,install --frozen-lockfile}',
]

// .baton 下只有控制面（策略/skill/playbook）必须禁止 agent 改写；
// deliveries/uploads 是数据面，不能一起封死，否则真实交付无法产出。
export const DEFAULT_APPROVAL_DENY = [
  'Bash:sudo *',
  'Bash:rm -rf *',
  'Bash:curl * | sh',
  'Bash:git push *',
  'Bash:mkfs*',
  'Bash:dd *',
  'Edit:**/.env*',
  'Edit:.git/**',
  'Edit:**/.ssh/**',
  'Write:**/.ssh/**',
  'Edit:**/.aws/**',
  'Write:**/.aws/**',
  'Edit:**/.gnupg/**',
  'Write:**/.gnupg/**',
  'Edit:/etc/**',
  'Write:/etc/**',
  'Edit:/usr/**',
  'Write:/usr/**',
  'Edit:/bin/**',
  'Write:/bin/**',
  'Edit:/sbin/**',
  'Write:/sbin/**',
  'Edit:/var/**',
  'Write:/var/**',
  'Edit:.baton/policy.json',
  'Write:.baton/policy.json',
  'Edit:.baton/skills/**',
  'Write:.baton/skills/**',
  'Edit:.baton/playbooks/**',
  'Write:.baton/playbooks/**',
]

const VerifyPolicy = z.object({
  command: z.string().min(1).optional(),
  timeoutSec: z.number().int().positive().default(900),
  maxOutputBytes: z.number().int().positive().default(262144),
})

const ApprovalPolicy = z.object({
  default: z.literal('ask').default('ask'),
  allow: z.array(z.string().min(1)).default(DEFAULT_APPROVAL_ALLOW),
  deny: z.array(z.string().min(1)).default(DEFAULT_APPROVAL_DENY),
  autoApproveMaxRisk: RiskLevel.default('low'),
})

const AutopilotPolicy = z.object({
  enabled: z.boolean().default(false),
  retryMax: z.number().int().nonnegative().default(2),
  digestCron: z.string().min(1).default('0 9,21 * * *'),
  /**
   * 总管全权：仅对 supervisor-chat 创建的任务生效。
   * 除 deny 规则外，所有工具（含高风险 Bash）自动批准；仍受 trust 与 kill switch 约束。
   */
  delegatedAuthority: z.boolean().default(false),
  /** 单个任务累计自动批准次数上限；0 表示禁用自动批准。 */
  maxAutoApprovalsPerTask: z.number().int().nonnegative().default(10),
})

export const AutonomyMode = z.enum(['off', 'observe', 'auto'])
export type AutonomyMode = z.infer<typeof AutonomyMode>

export const AutonomyPolicy = z.object({
  mode: AutonomyMode.default('observe'),
  autoRetry: AutonomyMode.default('off'),
  attentionReminder: AutonomyMode.default('observe'),
})
export type AutonomyPolicy = z.infer<typeof AutonomyPolicy>

export const PolicySchema = z.object({
  // 用函数默认值，避免多个 parse 共享同一份数组/对象默认值。
  verify: VerifyPolicy.default(() => VerifyPolicy.parse({})),
  approval: ApprovalPolicy.default(() => ApprovalPolicy.parse({})),
  autopilot: AutopilotPolicy.default(() => AutopilotPolicy.parse({})),
  autonomy: AutonomyPolicy.default(() => AutonomyPolicy.parse({})),
})
export type Policy = z.infer<typeof PolicySchema>
