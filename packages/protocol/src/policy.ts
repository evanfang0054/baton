import { z } from 'zod'

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
  autoApproveMaxRisk: z.enum(['low', 'medium', 'high']).default('low'),
})

const AutopilotPolicy = z.object({
  enabled: z.boolean().default(false),
  retryMax: z.number().int().nonnegative().default(2),
  digestCron: z.string().min(1).default('0 9,21 * * *'),
})

export const PolicySchema = z.object({
  verify: VerifyPolicy.default({ timeoutSec: 900, maxOutputBytes: 262144 }),
  approval: ApprovalPolicy.default({
    default: 'ask',
    allow: DEFAULT_ALLOW,
    deny: DEFAULT_DENY,
    autoApproveMaxRisk: 'low',
  }),
  autopilot: AutopilotPolicy.default({
    enabled: false,
    retryMax: 2,
    digestCron: '0 9,21 * * *',
  }),
})
export type Policy = z.infer<typeof PolicySchema>
