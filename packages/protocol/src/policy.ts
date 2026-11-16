import { z } from 'zod'
import { RiskLevel } from './enums.js'

const DEFAULT_ALLOW = [
  'Read',
  'Grep',
  'Glob',
  'Edit:src/**',
  'Edit:tests/**',
  'Bash:pnpm (test|lint|typecheck|build|install --frozen-lockfile)',
]

const DEFAULT_DENY = [
  'Bash:sudo *',
  'Bash:rm -rf *',
  'Bash:curl * | sh',
  'Bash:git push *',
  'Edit:**/.env*',
  'Edit:.git/**',
]

const VerifyPolicy = z.object({
  command: z.string().min(1).optional(),
  timeoutSec: z.number().int().positive().default(900),
  maxOutputBytes: z.number().int().positive().default(262144),
})

const ApprovalPolicy = z.object({
  default: z.literal('ask').default('ask'),
  allow: z.array(z.string().min(1)).default(DEFAULT_ALLOW),
  deny: z.array(z.string().min(1)).default(DEFAULT_DENY),
  autoApproveMaxRisk: RiskLevel.default('low'),
})

const AutopilotPolicy = z.object({
  enabled: z.boolean().default(false),
  retryMax: z.number().int().nonnegative().default(2),
  digestCron: z.string().min(1).default('0 9,21 * * *'),
})

export const PolicySchema = z.object({
  // 用函数默认值，避免多个 parse 共享同一份数组/对象默认值。
  verify: VerifyPolicy.default(() => VerifyPolicy.parse({})),
  approval: ApprovalPolicy.default(() => ApprovalPolicy.parse({})),
  autopilot: AutopilotPolicy.default(() => AutopilotPolicy.parse({})),
})
export type Policy = z.infer<typeof PolicySchema>
